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
			const path = groundPathFactor(x, z, seed, pathParameters);
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
			const groundR =
				(82 + grassVariation * 20 + fineVariation * 8) * biome.meadow +
				(34 + grassVariation * 11 + fineVariation * 5) * biome.forest +
				(124 + grassVariation * 18 + fineVariation * 6) * biome.rocky;
			const groundG =
				(172 + grassVariation * 29 + fineVariation * 13) *
					biome.meadow +
				(108 + grassVariation * 24 + fineVariation * 10) *
					biome.forest +
				(137 + grassVariation * 20 + fineVariation * 8) * biome.rocky;
			const groundB =
				(58 + grassVariation * 15 + fineVariation * 7) * biome.meadow +
				(36 + grassVariation * 10 + fineVariation * 5) * biome.forest +
				(88 + grassVariation * 14 + fineVariation * 6) * biome.rocky;
			data[index] = channel(
				lerp(
					groundR,
					171 + pathVariation * 26 + fineVariation * 5,
					path,
				) * shade,
			);
			data[index + 1] = channel(
				lerp(
					groundG,
					133 + pathVariation * 23 + fineVariation * 8,
					path,
				) * shade,
			);
			data[index + 2] = channel(
				lerp(
					groundB,
					55 + pathVariation * 15 + fineVariation * 5,
					path,
				) * shade,
			);
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
