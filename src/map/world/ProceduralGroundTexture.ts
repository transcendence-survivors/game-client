import * as BABYLON from '@babylonjs/core';
import { lerp } from '@transcendence/game-shared';
import {
	fbm2d,
	groundBiomeWeights,
	groundPathFactor,
	smoothstep,
} from './GroundFeatures';

const GROUND_TEXTURE_SIZE = 512;
export const GROUND_TEXTURE_WORLD_SIZE = 1024;

type Rgb = readonly [number, number, number];

const BIOMES = ['meadow', 'forest', 'rocky'] as const;

const BIOME_COLORS: Readonly<
	Record<(typeof BIOMES)[number], { base: Rgb; grass: Rgb; fine: Rgb }>
> = {
	meadow: { base: [82, 172, 58], grass: [20, 29, 15], fine: [8, 13, 7] },
	forest: { base: [34, 108, 36], grass: [11, 24, 10], fine: [5, 10, 5] },
	rocky: { base: [124, 137, 88], grass: [18, 20, 14], fine: [6, 8, 6] },
};
const PATH_COLOR = {
	base: [171, 133, 55],
	path: [26, 23, 15],
	fine: [5, 8, 5],
};

function crack(value: number, width: number): number {
	return 1 - smoothstep(0, width, Math.abs(Math.sin(value)));
}

export function createProceduralGroundTexture(
	scene: BABYLON.Scene,
	seed: number,
): BABYLON.RawTexture {
	const size = GROUND_TEXTURE_SIZE;
	const worldScale = GROUND_TEXTURE_WORLD_SIZE / size;
	const data = new Uint8Array(size * size * 4);
	for (let py = 0, index = 0; py < size; py++)
		for (let px = 0; px < size; px++, index += 4) {
			const x = (px + 0.5 - size * 0.5) * worldScale;
			const z = (py + 0.5 - size * 0.5) * worldScale;
			const biome = groundBiomeWeights(x, z, seed);
			const grass = fbm2d(x * 0.035, z * 0.035, seed ^ 0x6d2b79f5);
			const fine = fbm2d(x * 0.14 + 17, z * 0.14 - 9, seed ^ 0xa5a5a5a5);
			const path = groundPathFactor(x, z, seed);
			const pathNoise = fbm2d(
				x * 0.055 - 3,
				z * 0.055 + 11,
				seed ^ 0x3c6ef372,
			);
			const warp = fbm2d(x * 0.045 + 29, z * 0.045 - 7, seed);
			const cracks =
				Math.max(
					crack(x * 0.31 + z * 0.035 + warp * 3.5, 0.075),
					crack(z * 0.37 - x * 0.045 - warp * 2.5, 0.065),
				) *
				smoothstep(0.3, 0.82, path) *
				(0.55 + 0.45 * (fine * 0.5 + 0.5));
			const shade = 1 - cracks * 0.42;
			for (let channel = 0; channel < 3; channel++) {
				let ground = 0;
				for (const name of BIOMES) {
					const color = BIOME_COLORS[name];
					ground +=
						(color.base[channel]! +
							grass * color.grass[channel]! +
							fine * color.fine[channel]!) *
						biome[name];
				}
				const pathColor =
					PATH_COLOR.base[channel]! +
					pathNoise * PATH_COLOR.path[channel]! +
					fine * PATH_COLOR.fine[channel]!;
				data[index + channel] = Math.max(
					0,
					Math.min(
						255,
						Math.round(lerp(ground, pathColor, path) * shade),
					),
				);
			}
			data[index + 3] = 255;
		}
	const texture = BABYLON.RawTexture.CreateRGBATexture(
		data,
		size,
		size,
		scene,
		false,
		false,
		BABYLON.Texture.BILINEAR_SAMPLINGMODE,
		BABYLON.Constants.TEXTURETYPE_UNSIGNED_BYTE,
		0,
		true,
	);
	texture.name = 'procedural-ground';
	texture.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
	texture.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
	return texture;
}
