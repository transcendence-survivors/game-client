import * as BABYLON from '@babylonjs/core';
import { World } from '@transcendence/game-shared';
import { ChunkManager } from './world/ChunkManager';
import { RayLighting } from '../effects/RayLighting';
import type { ModelAssetLibrary } from '../assets/ModelAssetLibrary';
import { NatureRenderer } from './nature/NatureRenderer';
import { createTerrainMaterial } from './world/TerrainMaterial';

export class MapRenderer {
	readonly world: World;
	readonly terrainMaterial: BABYLON.StandardMaterial;
	private readonly terrainLight: BABYLON.HemisphericLight;
	private readonly chunkManager: ChunkManager;
	private readonly nature: NatureRenderer;
	private readonly rayLighting: RayLighting;

	constructor(scene: BABYLON.Scene, seed: number, assets: ModelAssetLibrary) {
		this.world = new World(seed);
		scene.clearColor = new BABYLON.Color4(0, 0, 0, 1);
		scene.ambientColor = new BABYLON.Color3(0, 0, 0);
		scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
		scene.fogColor = new BABYLON.Color3(0, 0, 0);
		scene.fogDensity = 0.004;

		this.terrainMaterial = createTerrainMaterial(scene, this.world.seed);
		this.terrainLight = new BABYLON.HemisphericLight(
			'terrainSun',
			new BABYLON.Vector3(-0.45, 1, 0.25),
			scene,
		);
		this.terrainLight.diffuse = BABYLON.Color3.FromHexString('#fff1c7');
		this.terrainLight.groundColor = BABYLON.Color3.FromHexString('#26351e');
		this.terrainLight.intensity = 0.9;

		this.nature = new NatureRenderer(this.world, assets);
		this.chunkManager = new ChunkManager(
			scene,
			this.world,
			this.terrainMaterial,
			(x, z) => this.nature.createChunkAttachment(x, z),
		);
		this.chunkManager.update(0, 0);
		this.rayLighting = new RayLighting(scene, this.world.height(0, 0));
	}

	followRay(rayX: number, rayY: number, rayZ: number) {
		this.rayLighting.setPosition(rayX, rayY, rayZ);
		this.chunkManager.update(rayX, rayZ);
		this.nature.update();
	}

	dispose() {
		this.chunkManager.dispose();
		this.nature.dispose();
		this.rayLighting.dispose();
		this.terrainLight.dispose();
		this.terrainMaterial.dispose(false, true);
	}
}
