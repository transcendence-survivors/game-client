import { makeNoise2D, TAU, type Noise2D } from '@transcendence/game-shared';

export interface GroundBiomeWeights {
	meadow: number;
	forest: number;
	rocky: number;
}

const noises = new Map<number, Noise2D>();

export function smoothstep(
	edge0: number,
	edge1: number,
	value: number,
): number {
	const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
	return t * t * (3 - 2 * t);
}

export function fbm2d(x: number, z: number, seed: number): number {
	const key = seed >>> 0;
	let noise = noises.get(key);
	if (!noise) {
		if (noises.size > 64) noises.clear();
		noise = makeNoise2D(key);
		noises.set(key, noise);
	}
	let value = 0;
	let amplitude = 0.5;
	let frequency = 1;
	for (let octave = 0; octave < 4; octave++) {
		value +=
			noise(x * frequency + octave * 17.3, z * frequency - octave * 9.1) *
			amplitude;
		amplitude *= 0.5;
		frequency *= 2;
	}
	return value / 0.9375;
}

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

function pathBand(distance: number, inner: number, outer: number): number {
	return 1 - smoothstep(inner, outer, Math.abs(distance));
}

export function groundPathFactor(x: number, z: number, seed: number): number {
	const phase = ((seed >>> 0) / 4294967296) * TAU;
	const centerLine =
		0.12 * x +
		13 * (Math.sin(x * 0.028 + phase) - Math.sin(phase)) +
		5 * (Math.sin(x * 0.075 - phase * 0.5) - Math.sin(-phase * 0.5));
	const branchLine =
		-72 + 0.12 * z + 14 * (Math.sin(z * 0.035 + phase) - Math.sin(phase));
	return Math.max(
		pathBand(z - centerLine, 4.5, 10.5),
		pathBand(x - branchLine, 3.5, 8.5) * 0.88,
	);
}
