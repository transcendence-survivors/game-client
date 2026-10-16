import { clamp01, makeNoise2D, type Noise2D } from '@transcendence/game-shared';

const noises = new Map<number, Noise2D>();
const FBM_AMPLITUDE_SUM = 0.5 + 0.25 + 0.125 + 0.0625;

export function smoothstep(
	edge0: number,
	edge1: number,
	value: number,
): number {
	const t = clamp01((value - edge0) / (edge1 - edge0));
	return t * t * (3 - 2 * t);
}

export function fbm2d(x: number, z: number, seed: number): number {
	const key = seed >>> 0;
	let noise = noises.get(key);
	if (!noise) {
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
	return value / FBM_AMPLITUDE_SUM;
}
