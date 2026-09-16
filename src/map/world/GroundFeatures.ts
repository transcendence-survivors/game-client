import { TAU } from '@transcendence/game-shared';
import { fbm2d, smoothstep } from './ProceduralNoise';

function pathBand(distance: number, innerRadius: number, outerRadius: number) {
	return 1 - smoothstep(innerRadius, outerRadius, Math.abs(distance));
}

function sharpenBiomeScore(score: number): number {
	return score ** 1.65;
}

export interface GroundBiomeWeights {
	meadow: number;
	forest: number;
	rocky: number;
}

export interface GroundPathParameters {
	readonly phase: number;
	readonly sinPhase: number;
	readonly sinNegativeHalfPhase: number;
}

export function createGroundPathParameters(seed: number): GroundPathParameters {
	const phase = ((seed >>> 0) / 4294967296) * TAU;
	return {
		phase,
		sinPhase: Math.sin(phase),
		sinNegativeHalfPhase: Math.sin(-phase * 0.5),
	};
}

export function groundBiomeWeights(
	x: number,
	z: number,
	seed: number,
	result: GroundBiomeWeights = { meadow: 0, forest: 0, rocky: 0 },
): GroundBiomeWeights {
	const climate =
		0.5 + 0.5 * fbm2d(x * 0.006 + 17, z * 0.006 - 11, seed ^ 0x68bc21eb);
	const elevation =
		0.5 + 0.5 * fbm2d(x * 0.009 - 23, z * 0.009 + 19, seed ^ 0x3c6ef372);
	const forestScore =
		0.15 +
		smoothstep(0.42, 0.68, climate) *
			(1 - smoothstep(0.68, 0.88, elevation)) *
			1.25;
	const rockyScore =
		0.1 +
		smoothstep(0.48, 0.72, elevation) * 1.35 +
		smoothstep(0.68, 0.9, climate) * 0.25;
	const meadowScore =
		0.2 +
		smoothstep(0.3, 0.62, 1 - climate) *
			(1 - smoothstep(0.66, 0.84, elevation) * 0.55) *
			0.95 +
		(1 - elevation) * 0.12;
	const sharpMeadow = sharpenBiomeScore(meadowScore);
	const sharpForest = sharpenBiomeScore(forestScore);
	const sharpRocky = sharpenBiomeScore(rockyScore);
	const total = sharpMeadow + sharpForest + sharpRocky;
	result.meadow = sharpMeadow / total;
	result.forest = sharpForest / total;
	result.rocky = sharpRocky / total;
	return result;
}

export function groundPathFactor(
	x: number,
	z: number,
	seed: number,
	parameters?: GroundPathParameters,
): number {
	const phase = parameters?.phase ?? ((seed >>> 0) / 4294967296) * TAU;
	const sinPhase = parameters?.sinPhase ?? Math.sin(phase);
	const sinNegativeHalfPhase =
		parameters?.sinNegativeHalfPhase ?? Math.sin(-phase * 0.5);
	const centerLine =
		0.12 * x +
		13 * (Math.sin(x * 0.028 + phase) - sinPhase) +
		5 * (Math.sin(x * 0.075 - phase * 0.5) - sinNegativeHalfPhase);
	const mainPath = pathBand(z - centerLine, 4.5, 10.5);

	const branchLine =
		-72 + 0.12 * z + 14 * (Math.sin(z * 0.035 + phase) - sinPhase);
	const branchPath = pathBand(x - branchLine, 3.5, 8.5) * 0.88;
	return Math.max(mainPath, branchPath);
}
