import {
	clamp01,
	createSurfaceSample,
	hashCell,
	mulberry32,
	TAU,
	type World,
	type WorldSurfaceSample,
} from '@transcendence/game-shared';
import { models } from '../../assets/models';
import {
	dominantBiome,
	groundBiomeWeights,
	groundPathFactor,
	type Biome,
} from '../world/GroundFields';
import { fbm2d } from '../world/NoiseMath';

type NatureKind = keyof typeof models.nature;

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
	biome: Biome;
	slope: number;
}

interface NatureRule {
	readonly kind: NatureKind;
	readonly cell: number;
	readonly radius: number;
	readonly scale: readonly [number, number];
	readonly maxPath: number;
	readonly allowsRough?: boolean;
	readonly density: Readonly<Record<Biome, number>>;
	readonly slopeBonus?: number;
	readonly variants: Readonly<Record<Biome, readonly number[]>>;
}

const START_CLEAR_RADIUS = 11;
const CELL_JITTER = 0.7;
const ROUGH_SLOPE = 0.42;

const RULES: readonly NatureRule[] = [
	{
		kind: 'tree',
		cell: 16,
		radius: 2.7,
		scale: [0.7, 1.3],
		maxPath: 0.12,
		density: { meadow: 0.048, forest: 0.73, rocky: 0.062 },
		variants: { meadow: [0, 1], forest: [3], rocky: [2] },
	},
	{
		kind: 'rock',
		cell: 10,
		radius: 1.2,
		scale: [0.7, 1.8],
		maxPath: 0.28,
		allowsRough: true,
		density: { meadow: 0.08, forest: 0.088, rocky: 0.74 },
		slopeBonus: 0.3,
		variants: { meadow: [2, 3], forest: [0, 1], rocky: [0, 1] },
	},
	{
		kind: 'bush',
		cell: 13,
		radius: 0.9,
		scale: [0.6, 0.95],
		maxPath: 0.22,
		density: { meadow: 0.38, forest: 0.62, rocky: 0.23 },
		variants: { meadow: [1], forest: [0], rocky: [0] },
	},
	{
		kind: 'flower',
		cell: 7,
		radius: 0,
		scale: [0.45, 0.85],
		maxPath: 0.72,
		density: { meadow: 0.68, forest: 0.36, rocky: 0.17 },
		variants: { meadow: [1, 2, 4, 5], forest: [0, 3], rocky: [0, 3, 5] },
	},
	{
		kind: 'grass',
		cell: 6,
		radius: 0,
		scale: [0.45, 0.8],
		maxPath: 0.92,
		allowsRough: true,
		density: { meadow: 0.78, forest: 0.67, rocky: 0.53 },
		variants: { meadow: [0, 1], forest: [2, 3], rocky: [2, 3] },
	},
];

function sampleFields(
	world: World,
	x: number,
	z: number,
	surface: WorldSurfaceSample,
): TerrainFields {
	world.sampleSurfaceToRef(x, z, surface);
	return {
		path: groundPathFactor(x, z, world.seed),
		biome: dominantBiome(groundBiomeWeights(x, z, world.seed)),
		slope: clamp01((1 - surface.y) * 4.5),
	};
}

type Obstacle = { x: number; z: number; radius: number };

function densityPatch(
	ruleIndex: number,
	x: number,
	z: number,
	seed: number,
): number {
	const patch =
		0.5 +
		0.5 *
			fbm2d(
				x * 0.075 + ruleIndex * 17,
				z * 0.075 - ruleIndex * 11,
				seed ^ (0x3c6ef372 + ruleIndex * 0x101),
			);
	return 0.72 + patch * 0.48;
}

function overlapsObstacle(
	obstacles: readonly Obstacle[],
	x: number,
	z: number,
	radius: number,
): boolean {
	return obstacles.some(
		(other) =>
			(other.x - x) ** 2 + (other.z - z) ** 2 <
			(other.radius + radius) ** 2,
	);
}

function createPlacement(
	rule: NatureRule,
	fields: TerrainFields,
	x: number,
	z: number,
	surface: WorldSurfaceSample,
	random: () => number,
): NaturePlacement {
	const variants = rule.variants[fields.biome];
	const urls = models.nature[rule.kind];
	const variant = variants[Math.floor(random() * variants.length)]!;
	return {
		url: urls[variant]!,
		x,
		y: surface.height,
		z,
		normalX: surface.x,
		normalY: surface.y,
		normalZ: surface.z,
		rotationY: random() * TAU,
		scale: rule.scale[0] + (rule.scale[1] - rule.scale[0]) * random(),
		tilt: rule.kind !== 'tree',
	};
}

export function generateNaturePlacements(
	world: World,
	chunkX: number,
	chunkZ: number,
): NaturePlacement[] {
	const chunkSize = world.CHUNK_SIZE;
	const surface = createSurfaceSample();
	const placements: NaturePlacement[] = [];
	const obstacles: Obstacle[] = [];

	RULES.forEach((rule, ruleIndex) => {
		const random = mulberry32(
			hashCell(world.seed + ruleIndex + 1, chunkX, chunkZ),
		);
		const cells = Math.round(chunkSize / rule.cell);
		const cellSize = chunkSize / cells;
		const cellCenter = (chunk: number, cell: number) =>
			chunk * chunkSize +
			(cell + 0.5 + (random() - 0.5) * CELL_JITTER) * cellSize;
		for (let cz = 0; cz < cells; cz++)
			for (let cx = 0; cx < cells; cx++) {
				const x = cellCenter(chunkX, cx);
				const z = cellCenter(chunkZ, cz);
				const roll = random();
				if (x * x + z * z < START_CLEAR_RADIUS * START_CLEAR_RADIUS)
					continue;
				const fields = sampleFields(world, x, z, surface);
				if (fields.path > rule.maxPath) continue;
				if (fields.slope > ROUGH_SLOPE && !rule.allowsRough) continue;
				const density =
					rule.density[fields.biome] +
					fields.slope * (rule.slopeBonus ?? 0);
				if (
					roll >
					clamp01(density * densityPatch(ruleIndex, x, z, world.seed))
				)
					continue;
				const radius = rule.radius || 0.5;
				if (overlapsObstacle(obstacles, x, z, radius)) continue;
				if (rule.radius > 0) obstacles.push({ x, z, radius });
				placements.push(
					createPlacement(rule, fields, x, z, surface, random),
				);
			}
	});
	return placements;
}
