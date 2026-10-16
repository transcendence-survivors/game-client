import * as BABYLON from '@babylonjs/core';
import { lerp } from '@transcendence/game-shared';
import {
	BIOMES,
	groundBiomeWeights,
	groundPathFactor,
	type Biome,
} from './GroundFields';
import { fbm2d } from './NoiseMath';

const GROUND_TEXTURE_SIZE = 512;
export const GROUND_TEXTURE_WORLD_SIZE = 1024;

type Rgb = readonly [number, number, number];

const BIOME_COLORS: Readonly<
	Record<Biome, { base: Rgb; grass: Rgb; fine: Rgb }>
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

function writeGroundPixel(
	data: Uint8Array,
	index: number,
	x: number,
	z: number,
	seed: number,
): void {
	const biome = groundBiomeWeights(x, z, seed);
	const grass = fbm2d(x * 0.035, z * 0.035, seed ^ 0x6d2b79f5);
	const fine = fbm2d(x * 0.14 + 17, z * 0.14 - 9, seed ^ 0xa5a5a5a5);
	const path = groundPathFactor(x, z, seed);
	const pathNoise = fbm2d(x * 0.055 - 3, z * 0.055 + 11, seed ^ 0x3c6ef372);
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
		data[index + channel] = Math.round(lerp(ground, pathColor, path));
	}
	data[index + 3] = 255;
}

export function generateGroundTextureData(seed: number): Uint8Array {
	const size = GROUND_TEXTURE_SIZE;
	const worldScale = GROUND_TEXTURE_WORLD_SIZE / size;
	const toWorld = (pixel: number) => (pixel + 0.5 - size * 0.5) * worldScale;
	const data = new Uint8Array(size * size * 4);
	for (let py = 0, index = 0; py < size; py++)
		for (let px = 0; px < size; px++, index += 4)
			writeGroundPixel(data, index, toWorld(px), toWorld(py), seed);
	return data;
}

export function createTerrainMaterial(
	scene: BABYLON.Scene,
	seed: number,
): BABYLON.StandardMaterial {
	const size = GROUND_TEXTURE_SIZE;
	const texture = BABYLON.RawTexture.CreateRGBATexture(
		generateGroundTextureData(seed),
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
	const material = new BABYLON.StandardMaterial('terrain', scene);
	material.diffuseTexture = texture;
	material.diffuseColor = new BABYLON.Color3(1, 1, 1);
	material.specularColor = new BABYLON.Color3(0, 0, 0);
	material.emissiveColor = new BABYLON.Color3(0.08, 0.1, 0.05);
	return material;
}
