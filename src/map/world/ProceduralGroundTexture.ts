import * as BABYLON from '@babylonjs/core';
import { lerp } from '@transcendence/game-shared';
import {
	createGroundPathParameters,
	groundBiomeWeights,
	groundPathFactor,
} from './GroundFeatures';
import { fbm2d, smoothstep } from './ProceduralNoise';

const GROUND_TEXTURE_SIZE = 512;
export const GROUND_TEXTURE_WORLD_SIZE = 1024;
// One row per RGB channel: meadow, forest, rocky, path as [base, a, b].
// prettier-ignore
const GROUND_COLORS = [
	82, 20, 8,   34, 11, 5,   124, 18, 6,   171, 26, 5,
	172, 29, 13,   108, 24, 10,   137, 20, 8,   133, 23, 8,
	58, 15, 7,   36, 10, 5,   88, 14, 6,   55, 15, 5,
];

function tint(offset: number, a: number, b: number): number {
	const k = GROUND_COLORS;
	return k[offset] + a * k[offset + 1] + b * k[offset + 2];
}

function channel(value: number): number {
	return Math.max(0, Math.min(255, Math.round(value)));
}

export function createProceduralGroundTextureData(seed: number): Uint8Array {
	const size = GROUND_TEXTURE_SIZE;
	const worldScale = GROUND_TEXTURE_WORLD_SIZE / size;
	const data = new Uint8Array(size * size * 4);
	const biomeScratch = { meadow: 0, forest: 0, rocky: 0 };
	const pathParameters = createGroundPathParameters(seed);
	let index = 0;

	for (let py = 0; py < size; py++) {
		for (let px = 0; px < size; px++) {
			const x = (px + 0.5 - size * 0.5) * worldScale;
			const z = (py + 0.5 - size * 0.5) * worldScale;
			const biome = groundBiomeWeights(x, z, seed, biomeScratch);
			const grassVariation = fbm2d(
				x * 0.035,
				z * 0.035,
				seed ^ 0x6d2b79f5,
			);
			const fineVariation = fbm2d(
				x * 0.14 + 17,
				z * 0.14 - 9,
				seed ^ 0xa5a5a5a5,
			);
			const path = groundPathFactor(x, z, pathParameters);
			const pathVariation = fbm2d(
				x * 0.055 - 3,
				z * 0.055 + 11,
				seed ^ 0x3c6ef372,
			);

			const crackWarp = fbm2d(x * 0.045 + 29, z * 0.045 - 7, seed);
			const crackA =
				1 -
				smoothstep(
					0,
					0.075,
					Math.abs(Math.sin(x * 0.31 + z * 0.035 + crackWarp * 3.5)),
				);
			const crackB =
				1 -
				smoothstep(
					0,
					0.065,
					Math.abs(Math.sin(z * 0.37 - x * 0.045 - crackWarp * 2.5)),
				);
			const cracks =
				Math.max(crackA, crackB) *
				smoothstep(0.3, 0.82, path) *
				(0.55 + 0.45 * (fineVariation * 0.5 + 0.5));

			const shade = 1 - cracks * 0.42;
			for (let c = 0, k = 0; c < 3; c++, k += 12) {
				const ground =
					tint(k, grassVariation, fineVariation) * biome.meadow +
					tint(k + 3, grassVariation, fineVariation) * biome.forest +
					tint(k + 6, grassVariation, fineVariation) * biome.rocky;
				const pathColor = tint(k + 9, pathVariation, fineVariation);
				data[index + c] = channel(
					lerp(ground, pathColor, path) * shade,
				);
			}
			data[index + 3] = 255;
			index += 4;
		}
	}
	return data;
}

export function createProceduralGroundTexture(
	scene: BABYLON.Scene,
	seed: number,
): BABYLON.RawTexture {
	const size = GROUND_TEXTURE_SIZE;
	const data = createProceduralGroundTextureData(seed);
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
