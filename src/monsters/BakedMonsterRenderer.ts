import * as BABYLON from '@babylonjs/core';
import {
	ELITE_MODEL_SCALE,
	getMonsterDefinition,
	MONSTER_MODEL_SCALE,
	nextPowerOfTwoCapacity,
	type Monster,
	type Vec3d,
} from '@transcendence/game-shared';
import type {
	ModelAssetLibrary,
	ModelInstance,
} from '../assets/ModelAssetLibrary';
import type { MapGenerator } from '../map/MapGenerator';
import { getMonsterModelUrl } from '../assets/models';
import {
	isMonsterInCameraEnvelope,
	MONSTER_RENDER_CULLING_CONFIG,
	type PlanarCameraView,
} from './MonsterRenderCulling';
import { semanticAnimationName } from './MonsterView';
import {
	MONSTER_DAMAGE_FLASH_DURATION_S,
	MONSTER_GROUND_HEIGHT_INTERVAL_S,
	MONSTER_GROUND_LERP_SPEED,
	MONSTER_MODEL_YAW_OFFSET,
	MONSTER_POSITION_LERP_SPEED,
	MONSTER_PRESENTATION_ANIMATIONS,
	type MonsterPresentationAnimation,
	type MonsterPresentationState,
} from './MonsterPresentation';
import { animationFramesPerSecond } from './AnimationOptimization';

const DEFAULT_ANIMATION_FPS = 30;
const INITIAL_BATCH_CAPACITY = 32;

interface BakedClip {
	startFrame: number;
	endFrame: number;
	framesPerSecond: number;
}

interface ClipSource extends BakedClip {
	group: BABYLON.AnimationGroup;
	sourceFrom: number;
	sourceTo: number;
}

interface BakedMonster extends MonsterPresentationState, Vec3d {
	visualScale: number;
	targetY: number;
	rotationY: number;
	targetX: number;
	targetZ: number;
	targetRotationY: number;
	groundAccumulatorS: number;
	damageFlashRemainingS: number;
	deathStarted: boolean;
	batch: BakedBatch | null;
}

interface BakedMesh {
	mesh: BABYLON.Mesh;
	manager: BABYLON.BakedVertexAnimationManager;
}

interface BakedBatch {
	model: ModelInstance;
	members: Set<BakedMonster>;
	meshes: BakedMesh[];
	clips: Map<MonsterPresentationAnimation, BakedClip>;
	capacity: number;
	matrices: Float32Array;
	animationSettings: Float32Array;
	colors: Float32Array;
}

function createClipLayout(
	animationGroups: BABYLON.AnimationGroup[],
): Map<MonsterPresentationAnimation, ClipSource> {
	const groups = new Map<string, BABYLON.AnimationGroup>();
	for (const group of animationGroups)
		groups.set(semanticAnimationName(group.name), group);
	const fallback =
		groups.get('idle') ?? groups.get('walk') ?? animationGroups[0];
	if (!fallback) throw new Error('monster model has no animation');

	const layout = new Map<MonsterPresentationAnimation, ClipSource>();
	let textureFrame = 0;
	for (const state of MONSTER_PRESENTATION_ANIMATIONS) {
		const group = groups.get(state) ?? fallback;
		const sourceFrom = Math.ceil(group.from);
		const sourceTo = Math.max(sourceFrom, Math.floor(group.to));
		const frameCount = sourceTo - sourceFrom + 1;
		layout.set(state, {
			group,
			sourceFrom,
			sourceTo,
			startFrame: textureFrame,
			endFrame: textureFrame + frameCount - 1,
			framesPerSecond:
				animationFramesPerSecond(group) || DEFAULT_ANIMATION_FPS,
		});
		textureFrame += frameCount;
	}
	return layout;
}

function bakeMeshAnimation(
	scene: BABYLON.Scene,
	mesh: BABYLON.Mesh,
	layout: Map<MonsterPresentationAnimation, ClipSource>,
): BakedMesh {
	const skeleton = mesh.skeleton;
	if (!skeleton) throw new Error(`mesh '${mesh.name}' has no skeleton`);
	let frameCount = 0;
	for (const clip of layout.values())
		frameCount += clip.endFrame - clip.startFrame + 1;
	skeleton.prepare(true);
	const matrixCount = skeleton.getTransformMatrices(mesh).length;
	const bakedData = new Float32Array(frameCount * matrixCount);

	for (const clip of layout.values()) {
		clip.group.start(false, 1, clip.sourceFrom, clip.sourceTo, false);
		clip.group.pause();
		for (let frame = clip.sourceFrom; frame <= clip.sourceTo; frame++) {
			clip.group.goToFrame(frame);
			mesh.computeWorldMatrix(true);
			skeleton.prepare(true);
			const destinationFrame = clip.startFrame + frame - clip.sourceFrom;
			bakedData.set(
				skeleton.getTransformMatrices(mesh),
				destinationFrame * matrixCount,
			);
		}
		clip.group.stop(true);
	}

	const baker = new BABYLON.VertexAnimationBaker(scene, mesh);
	const manager = new BABYLON.BakedVertexAnimationManager(scene);
	manager.texture = baker.textureFromBakedVertexData(bakedData);
	mesh.bakedVertexAnimationManager = manager;
	return { mesh, manager };
}

export class BakedMonsterRenderer {
	private readonly monsters = new Map<string, BakedMonster>();
	private readonly batches = new Map<string, Promise<BakedBatch>>();
	private readonly readyBatches = new Set<BakedBatch>();
	private readonly scene: BABYLON.Scene;
	private readonly mapGen: MapGenerator;
	private readonly assets: ModelAssetLibrary;
	private readonly prepareModel: (url: string) => Promise<void>;
	private readonly instanceScale = BABYLON.Vector3.One();
	private readonly instanceRotation = BABYLON.Quaternion.Identity();
	private readonly instancePosition = BABYLON.Vector3.Zero();
	private readonly instanceMatrix = BABYLON.Matrix.Identity();
	private disposed = false;

	constructor(
		scene: BABYLON.Scene,
		mapGen: MapGenerator,
		assets: ModelAssetLibrary,
		prepareModel: (url: string) => Promise<void>,
	) {
		this.scene = scene;
		this.mapGen = mapGen;
		this.assets = assets;
		this.prepareModel = prepareModel;
	}

	async add(monster: Monster, id: string): Promise<void> {
		const url = getMonsterModelUrl(monster.kind);
		if (!url) throw new Error(`Unknown monster model '${monster.kind}'`);
		const groundHeight = this.mapGen.getGroundHeight(monster.x, monster.z);
		const record: BakedMonster = {
			visualScale:
				(getMonsterDefinition(monster.kind)?.visualScale ?? 1) *
				(monster.isElite ? ELITE_MODEL_SCALE : 1) *
				MONSTER_MODEL_SCALE,
			x: monster.x,
			z: monster.z,
			y: groundHeight,
			targetY: groundHeight,
			rotationY: monster.rotationY,
			targetX: monster.x,
			targetZ: monster.z,
			targetRotationY: monster.rotationY,
			animationState: monster.animState,
			animationStartedAtS: monster.animStartedAtS,
			groundAccumulatorS: MONSTER_GROUND_HEIGHT_INTERVAL_S,
			damageFlashRemainingS: 0,
			deathStarted: false,
			batch: null,
		};
		this.monsters.set(id, record);
		try {
			const batch = await this.getBatch(url, monster.kind);
			if (this.disposed || this.monsters.get(id) !== record) return;
			record.batch = batch;
			batch.members.add(record);
		} catch (error) {
			if (this.monsters.get(id) === record) this.monsters.delete(id);
			throw error;
		}
	}

	has(id: string): boolean {
		return this.monsters.has(id);
	}

	setTarget(id: string, monster: Monster): void {
		const record = this.monsters.get(id);
		if (!record) return;
		record.targetX = monster.x;
		record.targetZ = monster.z;
		record.targetRotationY = monster.rotationY;
		if (!record.deathStarted) {
			record.animationState = monster.animState;
			record.animationStartedAtS = monster.animStartedAtS;
		}
	}

	flashDamage(id: string): void {
		const record = this.monsters.get(id);
		if (record && !record.deathStarted)
			record.damageFlashRemainingS = MONSTER_DAMAGE_FLASH_DURATION_S;
	}

	startDeath(id: string, combatTimeS: number): number | null {
		const record = this.monsters.get(id);
		if (!record) return null;
		if (!record.deathStarted) {
			record.deathStarted = true;
			record.animationState = 'death';
			record.animationStartedAtS = combatTimeS;
		}
		const clip = record.batch?.clips.get('death');
		return clip
			? (clip.endFrame - clip.startFrame + 1) / clip.framesPerSecond
			: 1;
	}

	remove(id: string): void {
		const record = this.monsters.get(id);
		if (!record) return;
		record.batch?.members.delete(record);
		this.monsters.delete(id);
	}

	update(
		deltaTime: number,
		combatTimeS: number,
		cameraView: PlanarCameraView,
		cullingEnabled: boolean,
	): number {
		const elapsed = Math.min(0.25, Math.max(0, deltaTime));
		let renderedCount = 0;
		for (const batch of this.readyBatches) {
			let visibleCount = 0;
			this.ensureCapacity(batch, batch.members.size);
			for (const record of batch.members) {
				if (
					cullingEnabled &&
					!isMonsterInCameraEnvelope(
						record.targetX,
						record.targetZ,
						cameraView,
						MONSTER_RENDER_CULLING_CONFIG.margin,
					)
				)
					continue;
				renderedCount++;
				this.writeInstance(
					batch,
					record,
					visibleCount++,
					elapsed,
					combatTimeS,
				);
			}
			for (const { mesh, manager } of batch.meshes) {
				manager.time = combatTimeS;
				mesh.thinInstanceCount = visibleCount;
				mesh.isVisible = visibleCount > 0;
				mesh.thinInstanceBufferUpdated('matrix');
				mesh.thinInstanceBufferUpdated(
					'bakedVertexAnimationSettingsInstanced',
				);
				mesh.thinInstanceBufferUpdated('color');
			}
		}
		return renderedCount;
	}

	private async getBatch(url: string, kind: string): Promise<BakedBatch> {
		let pending = this.batches.get(url);
		if (!pending) {
			pending = this.createBatch(url, kind);
			this.batches.set(url, pending);
			void pending.then((batch) => {
				if (!this.disposed) this.readyBatches.add(batch);
			});
			void pending.catch(() => {
				if (this.batches.get(url) === pending) this.batches.delete(url);
			});
		}
		return pending;
	}

	private async createBatch(url: string, kind: string): Promise<BakedBatch> {
		await this.prepareModel(url);
		const model = await this.assets.instantiate(url, `vat:${kind}`, {
			doNotInstantiate: true,
		});
		try {
			const layout = createClipLayout(model.animationGroups);
			const skinnedMeshes = model.root
				.getChildMeshes(false)
				.filter(
					(mesh): mesh is BABYLON.Mesh =>
						mesh instanceof BABYLON.Mesh && mesh.skeleton !== null,
				);
			if (skinnedMeshes.length === 0)
				throw new Error(`monster model '${kind}' has no skinned mesh`);
			const meshes = skinnedMeshes.map((mesh) =>
				bakeMeshAnimation(this.scene, mesh, layout),
			);
			for (const animation of model.animationGroups) animation.dispose();
			model.animationGroups.length = 0;
			model.root.position.setAll(0);
			model.root.scaling.setAll(1);
			model.root.rotationQuaternion = null;
			model.root.rotation.setAll(0);
			this.mapGen.prepareRenderable(model.root, false);
			for (const { mesh } of meshes) {
				mesh.isPickable = false;
				mesh.checkCollisions = false;
				mesh.alwaysSelectAsActiveMesh = true;
				mesh.doNotSyncBoundingInfo = true;
				mesh.thinInstanceEnablePicking = false;
			}
			const clips = new Map<MonsterPresentationAnimation, BakedClip>();
			for (const [state, clip] of layout)
				clips.set(state, {
					startFrame: clip.startFrame,
					endFrame: clip.endFrame,
					framesPerSecond: clip.framesPerSecond,
				});
			const batch: BakedBatch = {
				model,
				members: new Set(),
				meshes,
				clips,
				capacity: 0,
				matrices: new Float32Array(),
				animationSettings: new Float32Array(),
				colors: new Float32Array(),
			};
			this.ensureCapacity(batch, INITIAL_BATCH_CAPACITY);
			return batch;
		} catch (error) {
			model.animationGroups.forEach((animation) => animation.dispose());
			model.root.dispose();
			throw error;
		}
	}

	private ensureCapacity(batch: BakedBatch, required: number): void {
		if (required <= batch.capacity) return;
		batch.capacity = nextPowerOfTwoCapacity(
			required,
			INITIAL_BATCH_CAPACITY,
		);
		batch.matrices = new Float32Array(batch.capacity * 16);
		batch.animationSettings = new Float32Array(batch.capacity * 4);
		batch.colors = new Float32Array(batch.capacity * 4);
		for (const { mesh } of batch.meshes) {
			mesh.thinInstanceSetBuffer('matrix', batch.matrices, 16, false);
			mesh.thinInstanceSetBuffer(
				'bakedVertexAnimationSettingsInstanced',
				batch.animationSettings,
				4,
				false,
			);
			mesh.thinInstanceSetBuffer('color', batch.colors, 4, false);
			mesh.thinInstanceCount = 0;
		}
	}

	private writeInstance(
		batch: BakedBatch,
		record: BakedMonster,
		index: number,
		deltaTime: number,
		combatTimeS: number,
	): void {
		const positionLerp = Math.min(
			1,
			MONSTER_POSITION_LERP_SPEED * deltaTime,
		);
		record.x = BABYLON.Scalar.Lerp(record.x, record.targetX, positionLerp);
		record.z = BABYLON.Scalar.Lerp(record.z, record.targetZ, positionLerp);
		record.rotationY = BABYLON.Scalar.LerpAngle(
			record.rotationY,
			record.targetRotationY,
			positionLerp,
		);
		record.groundAccumulatorS += deltaTime;
		if (record.groundAccumulatorS >= MONSTER_GROUND_HEIGHT_INTERVAL_S) {
			record.groundAccumulatorS %= MONSTER_GROUND_HEIGHT_INTERVAL_S;
			const height = this.mapGen.getGroundHeight(
				record.targetX,
				record.targetZ,
			);
			if (Number.isFinite(height)) record.targetY = height;
		}
		record.y = BABYLON.Scalar.Lerp(
			record.y,
			record.targetY,
			Math.min(1, MONSTER_GROUND_LERP_SPEED * deltaTime),
		);

		this.instanceScale.set(
			record.visualScale,
			record.visualScale,
			-record.visualScale,
		);
		BABYLON.Quaternion.RotationYawPitchRollToRef(
			record.rotationY + MONSTER_MODEL_YAW_OFFSET,
			0,
			0,
			this.instanceRotation,
		);
		this.instancePosition.set(record.x, record.y, record.z);
		BABYLON.Matrix.ComposeToRef(
			this.instanceScale,
			this.instanceRotation,
			this.instancePosition,
			this.instanceMatrix,
		);
		this.instanceMatrix.copyToArray(batch.matrices, index * 16);

		const clip =
			batch.clips.get(record.animationState) ?? batch.clips.get('idle')!;
		const animationOffset = record.deathStarted
			? Math.min(
					clip.endFrame - clip.startFrame,
					Math.max(0, combatTimeS - record.animationStartedAtS) *
						clip.framesPerSecond,
				)
			: -record.animationStartedAtS * clip.framesPerSecond;
		const settingOffset = index * 4;
		batch.animationSettings[settingOffset] = clip.startFrame;
		batch.animationSettings[settingOffset + 1] = clip.endFrame;
		batch.animationSettings[settingOffset + 2] = animationOffset;
		batch.animationSettings[settingOffset + 3] = record.deathStarted
			? 0
			: clip.framesPerSecond;

		record.damageFlashRemainingS = Math.max(
			0,
			record.damageFlashRemainingS - deltaTime,
		);
		const flash =
			record.damageFlashRemainingS / MONSTER_DAMAGE_FLASH_DURATION_S;
		const colorOffset = index * 4;
		batch.colors[colorOffset] = 1;
		batch.colors[colorOffset + 1] = 1 - flash;
		batch.colors[colorOffset + 2] = 1 - flash;
		batch.colors[colorOffset + 3] = 1;
	}

	dispose(): void {
		this.disposed = true;
		this.monsters.clear();
		this.readyBatches.clear();
		for (const pending of this.batches.values())
			void pending
				.then((batch) => {
					for (const { manager } of batch.meshes)
						manager.dispose(true);
					batch.model.root.dispose();
				})
				.catch(() => {});
		this.batches.clear();
	}
}
