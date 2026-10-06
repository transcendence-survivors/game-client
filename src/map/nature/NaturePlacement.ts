import {
	clamp01,
	TAU,
	type World,
	type WorldSurfaceSample,
} from '@transcendence/game-shared';
import { models } from '../../assets/models';
import {
	createGroundPathParameters,
	groundBiomeWeights,
	groundPathFactor,
} from '../world/GroundFeatures';
import { fbm2d, smoothstep } from '../world/ProceduralNoise';

type NatureKind = keyof typeof models.environment.forest;
type NatureBiome = 'meadow' | 'forest' | 'rocky';

export interface NaturePlacement {
	readonly url: string;
	readonly x: number;
	readonly y: number;
	readonly z: number;
	readonly normalX: number;
	readonly normalY: number;
	readonly normalZ: number;
	readonly rotationY: number;
	readonly scale: number;
	readonly tilt: boolean;
}

interface TerrainFields {
	path: number;
	grove: number;
	meadow: number;
	rocky: number;
	slope: number;
	tier: number;
	ramp: boolean;
}

interface NatureRule {
	readonly kind: NatureKind;
	readonly cell: number;
	readonly radius: number;
	readonly scale: readonly [number, number];
	readonly maxPath: number;
	readonly density: (fields: TerrainFields, world: World) => number;
	readonly variants: Readonly<Record<NatureBiome, readonly number[]>>;
}

const START_CLEAR_RADIUS = 11;
const CELL_JITTER = 0.7;

const RULES: readonly NatureRule[] = [
	{
		kind: 'tree',
		cell: 16,
		radius: 2.7,
		scale: [0.7, 1.3],
		maxPath: 0.12,
		density: (f, world) =>
			f.tier >= world.TIERS - 1 ||
			f.ramp ||
			f.slope > 0.42 ||
			f.grove < 0.32 ||
			f.rocky > 0.5
				? 0
				: 0.45 + f.grove * 0.55,
		variants: { meadow: [0, 1], forest: [3], rocky: [2] },
	},
	{
		kind: 'rock',
		cell: 10,
		radius: 1.2,
		scale: [0.7, 1.8],
		maxPath: 0.28,
		density: (f) =>
			f.rocky < 0.3 ? 0 : 0.35 + f.rocky * 0.65 + f.slope * 0.1,
		variants: { meadow: [2, 3], forest: [0, 1], rocky: [0, 1] },
	},
	{
		kind: 'bush',
		cell: 13,
		radius: 0.9,
		scale: [0.6, 0.95],
		maxPath: 0.22,
		density: (f, world) =>
			f.tier >= world.TIERS - 1 ||
			f.ramp ||
			f.slope > 0.42 ||
			(f.rocky > 0.62 && f.grove < 0.35)
				? 0
				: 0.3 + f.grove * 0.55 + f.meadow * 0.1,
		variants: { meadow: [1], forest: [0], rocky: [0] },
	},
	{
		kind: 'flower',
		cell: 7,
		radius: 0,
		scale: [0.45, 0.85],
		maxPath: 0.72,
		density: (f, world) =>
			f.tier >= world.TIERS - 1 ||
			(f.meadow < 0.3 && f.grove < 0.3) ||
			(f.rocky > 0.78 && f.meadow < 0.42)
				? 0
				: 0.24 + f.meadow * 0.62 + f.grove * 0.1 - f.rocky * 0.28,
		variants: {
			meadow: [1, 2, 4, 5],
			forest: [0, 3],
			rocky: [0, 3, 5],
		},
	},
	{
		kind: 'grass',
		cell: 6,
		radius: 0,
		scale: [0.45, 0.8],
		maxPath: 0.92,
		density: (f) => 0.58 + f.meadow * 0.28 + f.grove * 0.12 - f.rocky * 0.2,
		variants: { meadow: [0, 1], forest: [2, 3], rocky: [2, 3] },
	},
];

function hash(seed: number, x: number, z: number, salt: number): number {
	let value = seed >>> 0;
	value = Math.imul(value ^ Math.imul(x | 0, 0x45d9f3b), 0x27d4eb2d);
	value = Math.imul(value ^ Math.imul(z | 0, 0x119de1f3), 0x27d4eb2d);
	value = Math.imul(value ^ salt, 0x27d4eb2d);
	return (value ^ (value >>> 15)) >>> 0;
}

function createRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let value = Math.imul(state ^ (state >>> 15), 1 | state);
		value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
		return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
	};
}

function sampleFields(
	world: World,
	x: number,
	z: number,
	surface: WorldSurfaceSample,
	path: ReturnType<typeof createGroundPathParameters>,
): TerrainFields {
	const gx = Math.floor(x / world.CELL);
	const gz = Math.floor(z / world.CELL);
	const tier = world.tier(gx, gz);
	const tierFactor = world.TIERS <= 1 ? 0 : tier / (world.TIERS - 1);
	world.sampleSurfaceToRef(x, z, surface);
	const slope = clamp01((1 - surface.y) * 4.5);
	const biome = groundBiomeWeights(x, z, world.seed);
	return {
		path: groundPathFactor(x, z, world.seed, path),
		grove: clamp01(
			biome.forest *
				(1 - smoothstep(0.28, 0.7, slope) * 0.55) *
				(1 - smoothstep(0.65, 1, tierFactor) * 0.35),
		),
		meadow: clamp01(biome.meadow * (1 - slope * 0.18)),
		rocky: clamp01(
			biome.rocky * 0.88 +
				smoothstep(0.18, 0.5, slope) * 0.42 +
				smoothstep(0.55, 0.85, tierFactor) * 0.22,
		),
		slope,
		tier,
		ramp: world.rampDir(gx, gz) !== null,
	};
}

function biomeOf(fields: TerrainFields): NatureBiome {
	if (fields.rocky >= fields.meadow && fields.rocky >= fields.grove)
		return 'rocky';
	return fields.grove >= fields.meadow ? 'forest' : 'meadow';
}

export function generateNaturePlacements(
	world: World,
	chunkX: number,
	chunkZ: number,
): NaturePlacement[] {
	const chunkSize = world.N * world.CELL;
	const surface: WorldSurfaceSample = { height: 0, x: 0, y: 1, z: 0 };
	const path = createGroundPathParameters(world.seed);
	const placements: NaturePlacement[] = [];
	const obstacles: { x: number; z: number; radius: number }[] = [];

	RULES.forEach((rule, ruleIndex) => {
		const random = createRandom(
			hash(world.seed, chunkX, chunkZ, ruleIndex + 1),
		);
		const cells = Math.max(1, Math.round(chunkSize / rule.cell));
		const cell = chunkSize / cells;
		for (let cz = 0; cz < cells; cz++)
			for (let cx = 0; cx < cells; cx++) {
				const x =
					chunkX * chunkSize +
					(cx + 0.5 + (random() - 0.5) * CELL_JITTER) * cell;
				const z =
					chunkZ * chunkSize +
					(cz + 0.5 + (random() - 0.5) * CELL_JITTER) * cell;
				const roll = random();
				if (x * x + z * z < START_CLEAR_RADIUS * START_CLEAR_RADIUS)
					continue;
				const fields = sampleFields(world, x, z, surface, path);
				if (fields.path > rule.maxPath) continue;
				const patch =
					0.5 +
					0.5 *
						fbm2d(
							x * 0.075 + ruleIndex * 17,
							z * 0.075 - ruleIndex * 11,
							world.seed ^ (0x3c6ef372 + ruleIndex * 0x101),
						);
				const density = rule.density(fields, world);
				if (roll > clamp01(density * (0.72 + patch * 0.48))) continue;
				const radius = rule.radius || 0.5;
				if (
					obstacles.some(
						(other) =>
							(other.x - x) ** 2 + (other.z - z) ** 2 <
							(other.radius + radius) ** 2,
					)
				)
					continue;
				if (rule.radius > 0) obstacles.push({ x, z, radius });

				const variants = rule.variants[biomeOf(fields)];
				const urls = models.environment.forest[rule.kind];
				const variant =
					variants[Math.floor(random() * variants.length)]!;
				placements.push({
					url: urls[variant % urls.length]!,
					x,
					y: surface.height,
					z,
					normalX: surface.x,
					normalY: surface.y,
					normalZ: surface.z,
					rotationY: random() * TAU,
					scale:
						rule.scale[0] +
						(rule.scale[1] - rule.scale[0]) * random(),
					tilt: rule.kind !== 'tree',
				});
			}
	});
	return placements;
}
