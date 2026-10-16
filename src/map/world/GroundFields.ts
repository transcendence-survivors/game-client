import { TAU } from '@transcendence/game-shared';
import { fbm2d, smoothstep } from './NoiseMath';

export const BIOMES = ['meadow', 'forest', 'rocky'] as const;
export type Biome = (typeof BIOMES)[number];
export type GroundBiomeWeights = Record<Biome, number>;

export function groundBiomeWeights(
	x: number,
	z: number,
	seed: number,
): GroundBiomeWeights {
	const climate =
		0.5 + 0.5 * fbm2d(x * 0.006 + 17, z * 0.006 - 11, seed ^ 0x68bc21eb);
	const elevation =
		0.5 + 0.5 * fbm2d(x * 0.009 - 23, z * 0.009 + 19, seed ^ 0x3c6ef372);
	const forest =
		(0.15 +
			smoothstep(0.42, 0.68, climate) *
				(1 - smoothstep(0.68, 0.88, elevation)) *
				1.25) **
		1.65;
	const rocky =
		(0.1 +
			smoothstep(0.48, 0.72, elevation) * 1.35 +
			smoothstep(0.68, 0.9, climate) * 0.25) **
		1.65;
	const meadow =
		(0.2 +
			smoothstep(0.3, 0.62, 1 - climate) *
				(1 - smoothstep(0.66, 0.84, elevation) * 0.55) *
				0.95 +
			(1 - elevation) * 0.12) **
		1.65;
	const total = meadow + forest + rocky;
	return {
		meadow: meadow / total,
		forest: forest / total,
		rocky: rocky / total,
	};
}

export function dominantBiome({
	meadow,
	forest,
	rocky,
}: GroundBiomeWeights): Biome {
	if (rocky >= meadow && rocky >= forest) return 'rocky';
	return forest >= meadow ? 'forest' : 'meadow';
}

function pathBand(distance: number, inner: number, outer: number): number {
	return 1 - smoothstep(inner, outer, Math.abs(distance));
}

export function groundPathFactor(x: number, z: number, seed: number): number {
	const phase = ((seed >>> 0) / 4294967296) * TAU;
	const centerLine =
		0.12 * x +
		13 * (Math.sin(x * 0.028 + phase) - Math.sin(phase)) +
		5 * (Math.sin(x * 0.075 - phase * 0.5) - Math.sin(-phase * 0.5));
	return pathBand(z - centerLine, 4.5, 10.5);
}
