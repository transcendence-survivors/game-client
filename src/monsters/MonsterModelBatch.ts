import * as BABYLON from '@babylonjs/core';
import { nextPowerOfTwoCapacity } from '@transcendence/game-shared';
import type { ModelAssetLibrary } from '../assets/ModelAssetLibrary';
import { applyTransform } from '../assets/Transform';
import type { MonsterView } from './MonsterView';

export const ANIMATION_STATES = ['idle', 'walk', 'attack', 'death'] as const;
export type AnimationState = (typeof ANIMATION_STATES)[number];

export interface AnimationClip {
	start: number;
	end: number;
	fps: number;
}

export interface MonsterAssets {
	id: string;
	model: string;
	animations: string;
}

interface BakedAnimationFile {
	meshes: { floats: number }[];
	clips: Record<AnimationState, [number, number, number]>;
	bodyRadius: number;
	bodyHeight: number;
}

const BAKED_ANIMATION_BUFFER = 'bakedVertexAnimationSettingsInstanced';
const INSTANCE_BUFFERS = ['matrix', BAKED_ANIMATION_BUFFER, 'color'];
const MIN_CAPACITY = 32;

export class MonsterModelBatch {
	readonly monsters = new Set<MonsterView>();
	readonly clips: Record<AnimationState, AnimationClip>;
	readonly bodyRadius: number;
	readonly bodyHeight: number;
	private readonly root: BABYLON.AbstractMesh;
	private readonly meshes: BABYLON.Mesh[];
	private capacity = 0;
	private matrices = new Float32Array();
	private animations = new Float32Array();
	private colors = new Float32Array();

	private constructor(
		root: BABYLON.AbstractMesh,
		meshes: BABYLON.Mesh[],
		baked: BakedAnimationFile,
	) {
		this.root = root;
		this.meshes = meshes;
		this.bodyRadius = baked.bodyRadius;
		this.bodyHeight = baked.bodyHeight;
		this.clips = {} as Record<AnimationState, AnimationClip>;
		for (const state of ANIMATION_STATES) {
			const [start, end, fps] = baked.clips[state];
			this.clips[state] = { start, end, fps };
		}
	}

	static async load(
		scene: BABYLON.Scene,
		modelLibrary: ModelAssetLibrary,
		{ id, model: modelUrl, animations: animationsUrl }: MonsterAssets,
	): Promise<MonsterModelBatch> {
		const [file] = await Promise.all([
			fetch(animationsUrl).then((response) => response.arrayBuffer()),
			modelLibrary.load(modelUrl),
		]);
		const model = await modelLibrary.instantiate(modelUrl, `vat:${id}`);
		model.animationGroups.forEach((group) => group.dispose());
		try {
			const headerLength = new DataView(file).getUint32(0, true);
			const baked: BakedAnimationFile = JSON.parse(
				new TextDecoder().decode(new Uint8Array(file, 4, headerLength)),
			);
			const meshes = model.root
				.getChildMeshes(false)
				.filter(
					(mesh): mesh is BABYLON.Mesh =>
						mesh instanceof BABYLON.Mesh && mesh.skeleton !== null,
				);
			if (meshes.length !== baked.meshes.length)
				throw new Error('baked animations do not match the model');
			let offset = 4 + headerLength;
			meshes.forEach((mesh, index) => {
				const floats = baked.meshes[index].floats;
				const data = new Float32Array(file, offset, floats);
				offset += floats * 4;
				const manager = new BABYLON.BakedVertexAnimationManager(scene);
				const baker = new BABYLON.VertexAnimationBaker(scene, mesh);
				manager.texture = baker.textureFromBakedVertexData(data);
				Object.assign(mesh, {
					bakedVertexAnimationManager: manager,
					isVisible: false,
					isPickable: false,
					alwaysSelectAsActiveMesh: true,
					doNotSyncBoundingInfo: true,
				});
			});
			applyTransform(model.root);
			return new MonsterModelBatch(model.root, meshes, baked);
		} catch (error) {
			model.root.dispose();
			throw new Error(`monster model '${id}': ${error}`);
		}
	}

	beginFrame(): void {
		const required = this.monsters.size;
		if (required <= this.capacity) return;
		this.capacity = nextPowerOfTwoCapacity(required, MIN_CAPACITY);
		this.matrices = new Float32Array(this.capacity * 16);
		this.animations = new Float32Array(this.capacity * 4);
		this.colors = new Float32Array(this.capacity * 4).fill(1);
		for (const mesh of this.meshes) {
			mesh.thinInstanceSetBuffer('matrix', this.matrices, 16, false);
			mesh.thinInstanceSetBuffer(
				BAKED_ANIMATION_BUFFER,
				this.animations,
				4,
				false,
			);
			mesh.thinInstanceSetBuffer('color', this.colors, 4, false);
		}
	}

	setInstance(
		index: number,
		matrix: BABYLON.Matrix,
		clip: AnimationClip,
		frameOffset: number,
		fps: number,
		flash: number,
	): void {
		matrix.copyToArray(this.matrices, index * 16);
		const offset = index * 4;
		this.animations[offset] = clip.start;
		this.animations[offset + 1] = clip.end;
		this.animations[offset + 2] = frameOffset;
		this.animations[offset + 3] = fps;
		this.colors[offset + 1] = flash;
		this.colors[offset + 2] = flash;
	}

	endFrame(instanceCount: number, timeS: number): void {
		for (const mesh of this.meshes) {
			mesh.bakedVertexAnimationManager!.time = timeS;
			mesh.thinInstanceCount = instanceCount;
			mesh.isVisible = instanceCount > 0;
			for (const buffer of INSTANCE_BUFFERS)
				mesh.thinInstanceBufferUpdated(buffer);
		}
	}

	dispose(): void {
		this.meshes.forEach((mesh) =>
			mesh.bakedVertexAnimationManager!.dispose(true),
		);
		this.root.dispose();
	}
}
