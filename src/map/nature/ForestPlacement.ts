import {
	clamp01,
	TAU,
	type Vec2d,
	type World,
	type WorldSurfaceSample,
} from '@transcendence/game-shared';
import {
	createGroundPathParameters,
	groundBiomeWeights,
	groundPathFactor,
	type GroundBiomeWeights,
	type GroundPathParameters,
} from '../world/GroundFeatures';
import { fbm2d, smoothstep } from '../world/ProceduralNoise';
import {
	FOREST_PLACEMENT_CAPACITY,
	FOREST_PLACEMENT_STRIDE,
} from '../world/WorldGenerationProtocol';

export const FOREST_PLACEMENT_KINDS = [
	'tree',
	'rock',
	'bush',
	'grass',
	'flower',
] as const;

export type ForestPlacementKind = (typeof FOREST_PLACEMENT_KINDS)[number];

export interface ForestPlacement extends Vec2d {
	kind: ForestPlacementKind;
	biome: ForestBiome;
	y: number;
	normalX: number;
	normalY: number;
	normalZ: number;
	rotationY: number;
	scale: number;
	variant: number;
}

export interface ForestPlacementBuffer {
	readonly data: Float64Array;
	readonly count: number;
	readonly release: () => void;
}

export function readForestPlacement(
	data: Float64Array,
	index: number,
	result: ForestPlacement,
): ForestPlacement {
	const offset = index * FOREST_PLACEMENT_STRIDE;
	const kind = FOREST_PLACEMENT_KINDS[Math.trunc(data[offset]!)];
	const biome = FOREST_BIOMES[Math.trunc(data[offset + 1]!)];
	if (!kind || !biome) throw new Error('Invalid forest placement payload');
	result.kind = kind;
	result.biome = biome;
	result.x = data[offset + 2]!;
	result.z = data[offset + 3]!;
	result.y = data[offset + 4]!;
	result.normalX = data[offset + 5]!;
	result.normalY = data[offset + 6]!;
	result.normalZ = data[offset + 7]!;
	result.rotationY = data[offset + 8]!;
	result.scale = data[offset + 9]!;
	result.variant = Math.trunc(data[offset + 10]!);
	return result;
}

export function validateForestPlacementBuffer(
	data: Float64Array,
	count: number,
): void {
	for (let index = 0; index < count; index++) {
		const offset = index * FOREST_PLACEMENT_STRIDE;
		if (
			!FOREST_PLACEMENT_KINDS[Math.trunc(data[offset]!)] ||
			!FOREST_BIOMES[Math.trunc(data[offset + 1]!)]
		)
			throw new Error('Invalid forest placement payload');
	}
}

export type ForestBiome = 'meadow' | 'forest' | 'rocky';

interface PlacementRule {
	readonly kind: ForestPlacementKind;
	readonly minCount: number;
	readonly maxCount: number;
	readonly minDistance: number;
	readonly margin: number;
	readonly minScale: number;
	readonly maxScale: number;
}

interface RandomSource {
	next(): number;
}

interface TerrainFields {
	path: number;
	grove: number;
	meadow: number;
	rocky: number;
	slope: number;
	height: number;
	normalX: number;
	normalY: number;
	normalZ: number;
}

interface GroundFeatureScratch {
	readonly biome: GroundBiomeWeights;
	readonly path: GroundPathParameters;
}

const START_CLEAR_RADIUS = 11;
const RULE_ATTEMPTS = 80;
const PLACEMENT_GRID_CELL_SIZE = 4;
const PLACEMENT_GRID_RADIUS = 3;
const MIN_PLACEMENTS_PER_CHUNK = 70;
const MAX_PLACEMENTS_PER_CHUNK = 80;
const FILL_ATTEMPTS = 6400;

const RULES: readonly PlacementRule[] = [
	{
		kind: 'tree',
		minCount: 3,
		maxCount: 6,
		minDistance: 8.5,
		margin: 5,
		minScale: 1,
		maxScale: 2,
	},
	{
		kind: 'rock',
		minCount: 4,
		maxCount: 7,
		minDistance: 4.2,
		margin: 3,
		minScale: 1,
		maxScale: 3,
	},
	{
		kind: 'bush',
		minCount: 5,
		maxCount: 9,
		minDistance: 3.4,
		margin: 3,
		minScale: 0.72,
		maxScale: 1.15,
	},
	{
		kind: 'grass',
		minCount: 30,
		maxCount: 44,
		minDistance: 1.25,
		margin: 1.5,
		minScale: 0.55,
		maxScale: 0.95,
	},
	{
		kind: 'flower',
		minCount: 15,
		maxCount: 24,
		minDistance: 1.55,
		margin: 2,
		minScale: 0.55,
		maxScale: 1.05,
	},
];
const RULE_BY_KIND = Object.fromEntries(
	RULES.map((rule) => [rule.kind, rule]),
) as Readonly<Record<ForestPlacementKind, PlacementRule>>;

export const FOREST_BIOMES = ['meadow', 'forest', 'rocky'] as const;
const FOREST_KIND_INDEX: Readonly<Record<ForestPlacementKind, number>> = {
	tree: 0,
	rock: 1,
	bush: 2,
	grass: 3,
	flower: 4,
};
const FOREST_BIOME_INDEX: Readonly<Record<ForestBiome, number>> = {
	meadow: 0,
	forest: 1,
	rocky: 2,
};
const REMOVABLE_PLACEMENT_KINDS: readonly ForestPlacementKind[] = [
	'flower',
	'grass',
	'bush',
	'rock',
];
const ROCKY_FILLERS = [
	['rock', 'grass', 'flower', 'bush'],
	['grass', 'rock', 'flower', 'bush'],
] as const satisfies readonly (readonly ForestPlacementKind[])[];
const FOREST_FILLERS = [
	['bush', 'grass', 'flower', 'rock'],
	['grass', 'flower', 'bush', 'rock'],
] as const satisfies readonly (readonly ForestPlacementKind[])[];
const MEADOW_FILLERS = [
	['grass', 'flower', 'bush', 'rock'],
	['flower', 'grass', 'bush', 'rock'],
] as const satisfies readonly (readonly ForestPlacementKind[])[];

function hash(
	seed: number,
	chunkX: number,
	chunkZ: number,
	salt: number,
): number {
	let value = seed >>> 0;
	value = Math.imul(value ^ Math.imul(chunkX | 0, 0x45d9f3b), 0x27d4eb2d);
	value = Math.imul(value ^ Math.imul(chunkZ | 0, 0x119de1f3), 0x27d4eb2d);
	value = Math.imul(value ^ salt, 0x27d4eb2d);
	return (value ^ (value >>> 15)) >>> 0;
}

function ruleFor(kind: ForestPlacementKind): PlacementRule {
	return RULE_BY_KIND[kind];
}

function randomBetween(random: RandomSource, min: number, max: number): number {
	return min + (max - min) * random.next();
}

function terrainFields(
	world: World,
	x: number,
	z: number,
	surface: WorldSurfaceSample,
	featureScratch: GroundFeatureScratch,
	result: TerrainFields,
): TerrainFields {
	const gx = Math.floor(x / world.CELL);
	const gz = Math.floor(z / world.CELL);
	const tierFactor =
		world.TIERS <= 1 ? 0 : world.tier(gx, gz) / (world.TIERS - 1);
	world.sampleSurfaceToRef(x, z, surface);
	const slope = clamp01((1 - surface.y) * 4.5);
	const biome = groundBiomeWeights(x, z, world.seed, featureScratch.biome);
	const grove = clamp01(
		biome.forest *
			(1 - smoothstep(0.28, 0.7, slope) * 0.55) *
			(1 - smoothstep(0.65, 1, tierFactor) * 0.35),
	);
	const meadow = clamp01(biome.meadow * (1 - slope * 0.18));
	const rocky = clamp01(
		biome.rocky * 0.88 +
			smoothstep(0.18, 0.5, slope) * 0.42 +
			smoothstep(0.55, 0.85, tierFactor) * 0.22,
	);
	result.path = groundPathFactor(x, z, world.seed, featureScratch.path);
	result.grove = grove;
	result.meadow = meadow;
	result.rocky = rocky;
	result.slope = slope;
	result.height = surface.height;
	result.normalX = surface.x;
	result.normalY = surface.y;
	result.normalZ = surface.z;
	return result;
}

function biomeFor(fields: TerrainFields): ForestBiome {
	if (fields.rocky >= fields.meadow && fields.rocky >= fields.grove)
		return 'rocky';
	if (fields.grove >= fields.meadow) return 'forest';
	return 'meadow';
}

function isValidGround(
	world: World,
	kind: ForestPlacementKind,
	x: number,
	z: number,
	fields: TerrainFields,
): boolean {
	const gx = Math.floor(x / world.CELL);
	const gz = Math.floor(z / world.CELL);
	const tier = world.tier(gx, gz);

	if (
		tier >= world.TIERS - 1 &&
		(kind === 'tree' || kind === 'bush' || kind === 'flower')
	)
		return false;
	if (
		(kind === 'tree' || kind === 'bush') &&
		(world.rampDir(gx, gz) || fields.slope > 0.42)
	)
		return false;
	if (kind === 'tree' && (fields.grove < 0.32 || fields.rocky > 0.5))
		return false;
	if (kind === 'bush' && fields.rocky > 0.62 && fields.grove < 0.35)
		return false;
	if (kind === 'rock' && fields.rocky < 0.3) return false;
	if (
		kind === 'flower' &&
		((fields.meadow < 0.3 && fields.grove < 0.3) ||
			(fields.rocky > 0.78 && fields.meadow < 0.42))
	)
		return false;

	if (kind === 'tree' && fields.path > 0.12) return false;
	if (kind === 'bush' && fields.path > 0.22) return false;
	if (kind === 'rock' && fields.path > 0.28) return false;
	if (kind === 'flower' && fields.path > 0.72) return false;
	if (kind === 'grass' && fields.path > 0.92) return false;
	return true;
}

function placementProbability(
	kind: ForestPlacementKind,
	fields: TerrainFields,
	patch: number,
): number {
	const zoneWeight =
		kind === 'tree'
			? 0.45 + fields.grove * 0.55
			: kind === 'rock'
				? 0.35 + fields.rocky * 0.65 + fields.slope * 0.1
				: kind === 'bush'
					? 0.3 + fields.grove * 0.55 + fields.meadow * 0.1
					: kind === 'flower'
						? 0.24 +
							fields.meadow * 0.62 +
							fields.grove * 0.1 -
							fields.rocky * 0.28
						: 0.58 +
							fields.meadow * 0.28 +
							fields.grove * 0.12 -
							fields.rocky * 0.2;
	return clamp01(zoneWeight * (0.72 + patch * 0.48));
}

function isFinePlacement(kind: ForestPlacementKind): boolean {
	return kind === 'grass' || kind === 'flower';
}

function isFarEnough(
	placements: PackedForestPlacements,
	grid: PlacementGrid,
	kind: ForestPlacementKind,
	x: number,
	z: number,
	minimumDistance: number,
): boolean {
	const cellX = Math.floor(x / PLACEMENT_GRID_CELL_SIZE);
	const cellZ = Math.floor(z / PLACEMENT_GRID_CELL_SIZE);
	const finePlacement = isFinePlacement(kind);
	for (
		let dzCell = -PLACEMENT_GRID_RADIUS;
		dzCell <= PLACEMENT_GRID_RADIUS;
		dzCell++
	) {
		for (
			let dxCell = -PLACEMENT_GRID_RADIUS;
			dxCell <= PLACEMENT_GRID_RADIUS;
			dxCell++
		) {
			const nearby = grid.get(cellX + dxCell, cellZ + dzCell);
			if (!nearby) continue;
			for (const index of nearby) {
				if (index >= placements.length) continue;
				const otherKind = placements.kindAt(index);
				const otherRule = ruleFor(otherKind);
				const otherFinePlacement = isFinePlacement(otherKind);
				const bothFine = finePlacement && otherFinePlacement;
				const oneFine = finePlacement || otherFinePlacement;
				const spacingFactor = bothFine ? 0.68 : oneFine ? 0.38 : 0.55;
				const required =
					Math.max(minimumDistance, otherRule.minDistance) *
					spacingFactor;
				const dx = x - placements.xAt(index);
				const dz = z - placements.zAt(index);
				if (dx * dx + dz * dz < required * required) return false;
			}
		}
	}
	return true;
}

class PlacementGrid {
	private readonly cells = new Map<number, number[]>();

	clear(): void {
		this.cells.clear();
	}

	get(x: number, z: number): readonly number[] | undefined {
		return this.cells.get(placementCellKey(x, z));
	}

	add(x: number, z: number, placementIndex: number): void {
		const key = placementCellKey(
			Math.floor(x / PLACEMENT_GRID_CELL_SIZE),
			Math.floor(z / PLACEMENT_GRID_CELL_SIZE),
		);
		let cell = this.cells.get(key);
		if (!cell) {
			cell = [];
			this.cells.set(key, cell);
		}
		cell.push(placementIndex);
	}
}

function placementCellKey(cellX: number, cellZ: number): number {
	return (cellX + 0x800000) * 0x1000000 + (cellZ + 0x800000);
}

class PackedForestPlacements {
	readonly data: Float64Array;
	length = 0;

	constructor(data: Float64Array) {
		if (data.length < FOREST_PLACEMENT_CAPACITY * FOREST_PLACEMENT_STRIDE)
			throw new Error('Forest placement output buffer is too small');
		this.data = data;
	}

	kindAt(index: number): ForestPlacementKind {
		return FOREST_PLACEMENT_KINDS[
			Math.trunc(this.data[index * FOREST_PLACEMENT_STRIDE]!)
		]!;
	}

	biomeAt(index: number): ForestBiome {
		return FOREST_BIOMES[
			Math.trunc(this.data[index * FOREST_PLACEMENT_STRIDE + 1]!)
		]!;
	}

	xAt(index: number): number {
		return this.data[index * FOREST_PLACEMENT_STRIDE + 2]!;
	}

	zAt(index: number): number {
		return this.data[index * FOREST_PLACEMENT_STRIDE + 3]!;
	}

	add(
		kind: ForestPlacementKind,
		biome: ForestBiome,
		x: number,
		z: number,
		y: number,
		normalX: number,
		normalY: number,
		normalZ: number,
		rotationY: number,
		scale: number,
		variant: number,
	): void {
		if (this.length >= FOREST_PLACEMENT_CAPACITY)
			throw new Error(
				`Forest chunk generated more than ${FOREST_PLACEMENT_CAPACITY} placements`,
			);
		const offset = this.length * FOREST_PLACEMENT_STRIDE;
		this.data[offset] = FOREST_KIND_INDEX[kind];
		this.data[offset + 1] = FOREST_BIOME_INDEX[biome];
		this.data[offset + 2] = x;
		this.data[offset + 3] = z;
		this.data[offset + 4] = y;
		this.data[offset + 5] = normalX;
		this.data[offset + 6] = normalY;
		this.data[offset + 7] = normalZ;
		this.data[offset + 8] = rotationY;
		this.data[offset + 9] = scale;
		this.data[offset + 10] = variant;
		this.length++;
	}

	remove(index: number): void {
		const offset = index * FOREST_PLACEMENT_STRIDE;
		this.data.copyWithin(
			offset,
			offset + FOREST_PLACEMENT_STRIDE,
			this.length * FOREST_PLACEMENT_STRIDE,
		);
		this.length--;
	}
}

export function generateForestPlacementsInto(
	world: World,
	chunkX: number,
	chunkZ: number,
	output: Float64Array,
): number {
	const placements = new PackedForestPlacements(output);
	generateForestPlacementsInternal(world, chunkX, chunkZ, placements);
	return placements.length;
}

function generateForestPlacementsInternal(
	world: World,
	chunkX: number,
	chunkZ: number,
	placements: PackedForestPlacements,
): void {
	const chunkSize = world.N * world.CELL;
	const originX = chunkX * chunkSize;
	const originZ = chunkZ * chunkSize;
	const placementGrid = new PlacementGrid();
	const surfaceScratch: WorldSurfaceSample = {
		height: 0,
		x: 0,
		y: 1,
		z: 0,
	};
	const featureScratch: GroundFeatureScratch = {
		biome: { meadow: 0, forest: 0, rocky: 0 },
		path: createGroundPathParameters(world.seed),
	};
	const fieldsScratch: TerrainFields = {
		path: 0,
		grove: 0,
		meadow: 0,
		rocky: 0,
		slope: 0,
		height: 0,
		normalX: 0,
		normalY: 1,
		normalZ: 0,
	};
	const densityRandom = createRandom(
		hash(world.seed, chunkX, chunkZ, 0x7f4a7c15),
	);
	const targetCount =
		MIN_PLACEMENTS_PER_CHUNK +
		Math.floor(
			densityRandom.next() *
				(MAX_PLACEMENTS_PER_CHUNK - MIN_PLACEMENTS_PER_CHUNK + 1),
		);

	for (let ruleIndex = 0; ruleIndex < RULES.length; ruleIndex++) {
		const rule = RULES[ruleIndex];
		const random = createRandom(
			hash(world.seed, chunkX, chunkZ, ruleIndex + 1),
		);
		const count =
			rule.minCount +
			Math.floor(random.next() * (rule.maxCount - rule.minCount + 1));
		let accepted = 0;

		for (
			let attempt = 0;
			accepted < count && attempt < count * RULE_ATTEMPTS;
			attempt++
		) {
			const x = randomBetween(
				random,
				originX + rule.margin,
				originX + chunkSize - rule.margin,
			);
			const z = randomBetween(
				random,
				originZ + rule.margin,
				originZ + chunkSize - rule.margin,
			);
			if (x * x + z * z < START_CLEAR_RADIUS * START_CLEAR_RADIUS)
				continue;

			const fields = terrainFields(
				world,
				x,
				z,
				surfaceScratch,
				featureScratch,
				fieldsScratch,
			);
			if (!isValidGround(world, rule.kind, x, z, fields)) continue;
			const patch =
				0.5 +
				0.5 *
					fbm2d(
						x * 0.075 + ruleIndex * 17,
						z * 0.075 - ruleIndex * 11,
						world.seed ^ (0x3c6ef372 + ruleIndex * 0x101),
					);
			if (random.next() > placementProbability(rule.kind, fields, patch))
				continue;

			const biome = biomeFor(fields);
			const rotationY = random.next() * TAU;
			const scale = randomBetween(random, rule.minScale, rule.maxScale);
			const variant = Math.floor(random.next() * 100_000);
			if (
				!isFarEnough(
					placements,
					placementGrid,
					rule.kind,
					x,
					z,
					rule.minDistance,
				)
			)
				continue;

			placements.add(
				rule.kind,
				biome,
				x,
				z,
				fields.height,
				fields.normalX,
				fields.normalY,
				fields.normalZ,
				rotationY,
				scale,
				variant,
			);
			placementGrid.add(x, z, placements.length - 1);
			accepted++;
		}
	}
	trimPlacementBudget(placements, placementGrid, targetCount);
	fillPlacementBudget(
		world,
		originX,
		originZ,
		chunkSize,
		placements,
		placementGrid,
		targetCount,
		densityRandom,
		surfaceScratch,
		featureScratch,
		fieldsScratch,
	);
}

function trimPlacementBudget(
	placements: PackedForestPlacements,
	placementGrid: PlacementGrid,
	targetCount: number,
): void {
	if (placements.length > targetCount) {
		for (const kind of REMOVABLE_PLACEMENT_KINDS) {
			for (
				let index = placements.length - 1;
				placements.length > targetCount && index >= 0;
				index--
			) {
				if (placements.kindAt(index) === kind) placements.remove(index);
			}
		}
	}
	placementGrid.clear();
	for (let index = 0; index < placements.length; index++)
		placementGrid.add(placements.xAt(index), placements.zAt(index), index);
}

function fillPlacementBudget(
	world: World,
	originX: number,
	originZ: number,
	chunkSize: number,
	placements: PackedForestPlacements,
	placementGrid: PlacementGrid,
	targetCount: number,
	random: RandomSource,
	surfaceScratch: WorldSurfaceSample,
	featureScratch: GroundFeatureScratch,
	fieldsScratch: TerrainFields,
): void {
	for (
		let attempt = 0;
		placements.length < targetCount && attempt < FILL_ATTEMPTS;
		attempt++
	) {
		const x = randomBetween(
			random,
			originX + 1.5,
			originX + chunkSize - 1.5,
		);
		const z = randomBetween(
			random,
			originZ + 1.5,
			originZ + chunkSize - 1.5,
		);
		if (x * x + z * z < START_CLEAR_RADIUS * START_CLEAR_RADIUS) continue;
		const fields = terrainFields(
			world,
			x,
			z,
			surfaceScratch,
			featureScratch,
			fieldsScratch,
		);
		const biome = biomeFor(fields);
		const candidates = fillerKinds(biome, random);
		let kind: ForestPlacementKind | undefined;
		for (const candidate of candidates) {
			if (isValidGround(world, candidate, x, z, fields)) {
				kind = candidate;
				break;
			}
		}
		if (!kind) continue;
		const rule = ruleFor(kind);
		const rotationY = random.next() * TAU;
		const scale = randomBetween(random, rule.minScale, rule.maxScale);
		const variant = Math.floor(random.next() * 100_000);
		if (
			!isFarEnough(
				placements,
				placementGrid,
				kind,
				x,
				z,
				rule.minDistance,
			)
		)
			continue;
		placements.add(
			kind,
			biome,
			x,
			z,
			fields.height,
			fields.normalX,
			fields.normalY,
			fields.normalZ,
			rotationY,
			scale,
			variant,
		);
		placementGrid.add(x, z, placements.length - 1);
	}
}

function fillerKinds(
	biome: ForestBiome,
	random: RandomSource,
): readonly ForestPlacementKind[] {
	if (biome === 'rocky')
		return random.next() < 0.58 ? ROCKY_FILLERS[0] : ROCKY_FILLERS[1];
	if (biome === 'forest')
		return random.next() < 0.42 ? FOREST_FILLERS[0] : FOREST_FILLERS[1];
	return random.next() < 0.6 ? MEADOW_FILLERS[0] : MEADOW_FILLERS[1];
}

function createRandom(seed: number): RandomSource {
	let state = seed >>> 0;
	return {
		next(): number {
			state = (state + 0x6d2b79f5) | 0;
			let value = Math.imul(state ^ (state >>> 15), 1 | state);
			value =
				(value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
			return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
		},
	};
}
