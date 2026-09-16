import type { Scene } from '@babylonjs/core';
import * as BABYLON from '@babylonjs/core';
import {
	World,
	ACCESS_RADIUS,
	CHUNK_DISPLAY_RADIUS as SHARED_CHUNK_DISPLAY_RADIUS,
} from '@transcendence/game-shared';
import { ChunkManager } from './world/ChunkManager';
import { SunRayVolumetric } from './effects/SunRayVolumetric';
import { RadialLightingPostProcess } from './effects/RadialLightingPostProcess';
import {
	PlayerAuraPlugin,
	type AuraInstance,
} from './effects/PlayerAuraPlugin';
import { createProceduralGroundTexture } from './world/ProceduralGroundTexture';
import { WorldGenerationClient } from './world/WorldGenerationClient';

export class MapGenerator {
	readonly ZONE_RADIUS = ACCESS_RADIUS;
	readonly CHUNK_DISPLAY_RADIUS = SHARED_CHUNK_DISPLAY_RADIUS;

	private readonly scene: Scene;
	private readonly world: World;
	private readonly generation: WorldGenerationClient;
	private terrainMaterial!: BABYLON.StandardMaterial;
	private terrainTexture!: BABYLON.RawTexture;
	private terrainLight!: BABYLON.HemisphericLight;
	private auraPlugin!: PlayerAuraPlugin;
	private chunkManager!: ChunkManager;
	private sunRay!: SunRayVolumetric;
	private radialLighting!: RadialLightingPostProcess;
	private rayPos!: BABYLON.Vector3;
	private raySynchronized = false;

	constructor(scene: Scene, seed: number) {
		this.scene = scene;
		this.world = new World(seed);
		this.generation = new WorldGenerationClient();
		this.init();
	}

	private init() {
		this.scene.clearColor = new BABYLON.Color4(0, 0, 0, 1);
		this.scene.ambientColor = new BABYLON.Color3(0, 0, 0);
		this.scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
		this.scene.fogColor = new BABYLON.Color3(0, 0, 0);
		this.scene.fogDensity = 0.004;

		this.terrainMaterial = new BABYLON.StandardMaterial(
			'terrain',
			this.scene,
		);
		this.terrainTexture = createProceduralGroundTexture(
			this.scene,
			this.world.seed,
		);
		this.terrainMaterial.diffuseTexture = this.terrainTexture;
		this.terrainMaterial.diffuseColor = new BABYLON.Color3(1, 1, 1);
		this.terrainMaterial.specularColor = new BABYLON.Color3(0, 0, 0);
		this.terrainMaterial.disableLighting = false;
		this.terrainMaterial.emissiveColor = new BABYLON.Color3(
			0.08,
			0.1,
			0.05,
		);
		this.terrainLight = new BABYLON.HemisphericLight(
			'terrainSun',
			new BABYLON.Vector3(-0.45, 1, 0.25),
			this.scene,
		);
		this.terrainLight.diffuse = BABYLON.Color3.FromHexString('#fff1c7');
		this.terrainLight.groundColor = BABYLON.Color3.FromHexString('#26351e');
		this.terrainLight.intensity = 0.9;
		this.auraPlugin = new PlayerAuraPlugin(this.terrainMaterial);

		const beamColor = new BABYLON.Color3(1.0, 0.9, 0.62);
		const strikeY = this.world.height(0, 0);
		this.rayPos = new BABYLON.Vector3(0, strikeY, 0);

		this.chunkManager = new ChunkManager(
			this.scene,
			this.world,
			this.terrainMaterial,
			3,
			performance.now.bind(performance),
			this.generation,
			this.CHUNK_DISPLAY_RADIUS,
		);
		this.chunkManager.update(BABYLON.Vector3.Zero());
		this.radialLighting = new RadialLightingPostProcess(this.scene, {
			innerRadius: this.ZONE_RADIUS * 0.45,
			outerRadius: this.ZONE_RADIUS,
			penumbra: 0,
			lightColor: beamColor,
		});

		this.sunRay = new SunRayVolumetric(this.scene, {
			color: beamColor,
			strikeY,
			radius: 8,
			height: 140,
			intensity: 1.0,
		});

		if (this.scene.activeCamera) {
			new BABYLON.FxaaPostProcess('fxaa', 1.0, this.scene.activeCamera);
		}

		this.scene.blockMaterialDirtyMechanism = true;
	}

	syncFromRoom(rayX: number, rayY: number, rayZ: number) {
		if (
			!this.raySynchronized ||
			rayX !== this.rayPos.x ||
			rayY !== this.rayPos.y ||
			rayZ !== this.rayPos.z
		) {
			this.raySynchronized = true;
			this.rayPos.set(rayX, rayY, rayZ);
			this.sunRay.setStrike(rayX, rayY, rayZ);
			this.radialLighting.setRayPosition(rayX, rayY, rayZ);
		}
		this.chunkManager.update(this.rayPos);
	}

	updateAuras(auras: readonly AuraInstance[], dtSeconds: number) {
		this.auraPlugin.update(auras, dtSeconds);
	}

	getGroundHeight(x: number, z: number): number {
		return this.world.height(x, z);
	}

	getWorld() {
		return this.world;
	}

	getZoneCenter(): BABYLON.Vector3 {
		return this.rayPos;
	}

	getGenerationClient(): WorldGenerationClient {
		return this.generation;
	}

	prepareRenderable(root: BABYLON.TransformNode, includeRoot = true) {
		const children = root.getChildMeshes();
		const first =
			includeRoot && root instanceof BABYLON.AbstractMesh ? -1 : 0;
		for (let index = first; index < children.length; index++) {
			const child =
				index < 0 ? (root as BABYLON.AbstractMesh) : children[index];
			const material = child.material;
			if (material instanceof BABYLON.StandardMaterial)
				material.disableLighting = true;
			if (material instanceof BABYLON.PBRMaterial) material.unlit = true;
		}
	}

	dispose() {
		this.chunkManager.dispose();
		this.generation.dispose();
		this.radialLighting.dispose();
		this.sunRay.dispose();
		this.terrainLight.dispose();
		this.terrainTexture.dispose();
		this.terrainMaterial.dispose();
	}
}
