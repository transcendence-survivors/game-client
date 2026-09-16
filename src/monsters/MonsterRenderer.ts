import * as BABYLON from '@babylonjs/core';
import * as GUI from '@babylonjs/gui';
import * as COLYSEUS from '@colyseus/sdk';
import {
	ServerMessage,
	type GameState,
	type Monster,
	type MonsterDamageEvent,
} from '@transcendence/game-shared';
import { MapGenerator } from '../map/MapGenerator';
import {
	ModelAssetLibrary,
	type ModelInstance,
} from '../assets/ModelAssetLibrary';
import { MonsterView } from './MonsterView';
import { DamageNumbers } from './DamageNumbers';
import { getMonsterModelUrl } from '../assets/models';
import { preserveWorldDepthForDebug } from '../combat/DebugRenderingGroups';
import { AsyncViewRegistry } from '../combat/AsyncViewRegistry';
import { createDebugMaterial } from '../combat/DebugMaterial';
import { CleanupBag } from '../CleanupBag';
import {
	extractStaticAnimationPoses,
	removeGloballyRedundantTransformAnimations,
	type StaticAnimationPoses,
} from './AnimationOptimization';
import {
	isMonsterInCameraEnvelope,
	MONSTER_RENDER_CULLING_CONFIG,
	type PlanarCameraView,
} from './MonsterRenderCulling';
import { BakedMonsterRenderer } from './BakedMonsterRenderer';
import { createFullscreenUi } from '../assets/ui';

const FATAL_HEAD_OFFSET = 4;
const FATAL_BOSS_HEAD_OFFSET = 9;
const MONSTER_REMOVE_GRACE_S = 0.25;
const DEATH_VIEW_LOAD_GRACE_S = 1;
const NEXT_BOSS_PREWARM_DELAY_MS = 2_000;

interface PrewarmedBossModel {
	model: ModelInstance;
	staticPoses: StaticAnimationPoses;
}

export interface MonsterRendererStats {
	total: number;
	elites: number;
	bosses: number;
	rendered: number;
}

export class MonsterRenderer {
	private readonly scene: BABYLON.Scene;
	private readonly room: COLYSEUS.Room<GameState>;
	private readonly mapGen: MapGenerator;
	private readonly assets: ModelAssetLibrary;
	private readonly bakedMonsters: BakedMonsterRenderer;
	private readonly overlayUi: GUI.AdvancedDynamicTexture;
	private readonly damageNumbers: DamageNumbers;
	private readonly hitboxMaterial: BABYLON.StandardMaterial;
	private readonly damageFlashMaterial: BABYLON.StandardMaterial;
	private hitboxesVisible = false;
	private readonly views = new AsyncViewRegistry<MonsterView>();
	private readonly subscriptions = new CleanupBag();
	private readonly monsterChangeSubscriptions = new Map<string, () => void>();
	private readonly pendingMonsterRemovals = new Map<string, number>();
	private readonly dyingMonsterIds = new Set<string>();
	private readonly damagePosition = BABYLON.Vector3.Zero();
	private readonly cameraForward = BABYLON.Vector3.Zero();
	private readonly cameraView: PlanarCameraView = {
		cameraX: 0,
		cameraZ: 0,
		forwardX: 0,
		forwardZ: 1,
		halfFovTangent: 1,
	};
	private readonly prewarmedBosses = new Map<
		string,
		Promise<PrewarmedBossModel>
	>();
	private readonly bossPrewarmTimers = new Map<string, number>();
	private prewarmSequence = 0;
	private disposed = false;
	private renderedMonsterCount = 0;
	private eliteMonsterCount = 0;
	private bossMonsterCount = 0;
	private lastCameraFov = Number.NaN;
	private lastCameraAspect = Number.NaN;
	private readonly debugStats: MonsterRendererStats = {
		total: 0,
		elites: 0,
		bosses: 0,
		rendered: 0,
	};

	constructor(
		scene: BABYLON.Scene,
		room: COLYSEUS.Room<GameState>,
		mapGen: MapGenerator,
	) {
		this.scene = scene;
		this.room = room;
		this.mapGen = mapGen;
		this.assets = new ModelAssetLibrary(scene);
		this.bakedMonsters = new BakedMonsterRenderer(
			scene,
			mapGen,
			this.assets,
			(url) => this.prepareModel(url),
		);
		preserveWorldDepthForDebug(scene);
		this.hitboxMaterial = createDebugMaterial(
			scene,
			'monsterHitboxMaterial',
			new BABYLON.Color3(1, 0.04, 0.02),
			0.9,
		);
		this.damageFlashMaterial = new BABYLON.StandardMaterial(
			'monsterDamageFlashMaterial',
			scene,
		);
		this.damageFlashMaterial.disableLighting = true;
		this.damageFlashMaterial.diffuseColor.set(1, 0, 0);
		this.damageFlashMaterial.emissiveColor.set(1, 0, 0);
		this.damageFlashMaterial.specularColor.set(0, 0, 0);
		this.damageFlashMaterial.backFaceCulling = false;
		this.overlayUi = createFullscreenUi('monsterOverlay', scene);
		this.overlayUi.useInvalidateRectOptimization = true;
		this.damageNumbers = new DamageNumbers(scene, this.overlayUi);
	}

	setHitboxesVisible(visible: boolean): void {
		this.hitboxesVisible = visible;
		this.views.forEach((view) => view.setHitboxVisible(visible));
	}

	listen(): void {
		const callbacks = COLYSEUS.Callbacks.get(this.room);
		let activeBoss = false;
		this.room.state.monsters.forEach((monster) => {
			if (!monster.isBoss) return;
			activeBoss = true;
			this.scheduleBossPreload(monster.kind, true);
		});
		this.scheduleBossPreload(this.room.state.nextBossKind, !activeBoss);
		this.subscriptions.add(
			callbacks.listen(
				'nextBossKind',
				(kind) => this.scheduleBossPreload(kind),
				true,
			),
		);
		this.subscriptions.add(
			callbacks.onAdd('monsters', (monster, monsterId) => {
				if (monster.isElite) this.eliteMonsterCount++;
				if (monster.isBoss) this.bossMonsterCount++;
				this.monsterChangeSubscriptions.set(
					monsterId,
					callbacks.onChange(monster, () =>
						this.updateMonsterView(monsterId, monster),
					),
				);
				if (monster.isBoss) void this.addMonster(monster, monsterId);
				else void this.addBakedMonster(monster, monsterId);
			}),
		);
		this.subscriptions.add(
			callbacks.onRemove('monsters', (monster, monsterId) => {
				if (monster.isElite) this.eliteMonsterCount--;
				if (monster.isBoss) this.bossMonsterCount--;
				this.queueMonsterRemoval(monsterId);
			}),
		);
		this.subscriptions.add(
			this.room.onMessage(
				ServerMessage.MonsterDamage,
				(events: MonsterDamageEvent[]) => this.onDamage(events),
			),
		);
	}

	private scheduleBossPreload(kind: string, immediate = false): void {
		const url = getMonsterModelUrl(kind);
		if (
			!url ||
			this.prewarmedBosses.has(kind) ||
			this.bossPrewarmTimers.has(kind)
		)
			return;
		if (!immediate) {
			const handle = window.setTimeout(() => {
				this.bossPrewarmTimers.delete(kind);
				this.scheduleBossPreload(kind, true);
			}, NEXT_BOSS_PREWARM_DELAY_MS);
			this.bossPrewarmTimers.set(kind, handle);
			this.subscriptions.add(() => window.clearTimeout(handle));
			return;
		}
		const pending = this.createPrewarmedBoss(kind, url);
		this.prewarmedBosses.set(kind, pending);
		void pending.catch((error) => {
			if (this.prewarmedBosses.get(kind) === pending)
				this.prewarmedBosses.delete(kind);
			if (!this.disposed)
				console.error(`failed to preload boss '${kind}'`, error);
		});
	}

	private async createPrewarmedBoss(
		kind: string,
		url: string,
	): Promise<PrewarmedBossModel> {
		await this.prepareModel(url);
		const model = await this.assets.instantiate(
			url,
			`boss-prewarm:${kind}:${this.prewarmSequence++}`,
			{ doNotInstantiate: true },
		);
		if (this.disposed) {
			this.disposeModel(model);
			throw new Error('monster renderer disposed during boss prewarm');
		}
		const staticPoses = this.prepareModelInstance(model);
		model.root.setEnabled(false);
		return { model, staticPoses };
	}

	private async acquireBossModel(
		kind: string,
		url: string,
	): Promise<PrewarmedBossModel> {
		const pending = this.prewarmedBosses.get(kind);
		if (pending) {
			this.prewarmedBosses.delete(kind);
			return pending;
		}
		return this.createPrewarmedBoss(kind, url);
	}

	private prepareModel(url: string): Promise<void> {
		return this.assets.prepare(url, (container) => {
			removeGloballyRedundantTransformAnimations(
				container.animationGroups,
			);
		});
	}

	update(deltaTime: number): void {
		const camera = this.scene.activeCamera;
		const cullingEnabled =
			MONSTER_RENDER_CULLING_CONFIG.enabled && camera !== null;
		if (camera && cullingEnabled) this.updateCameraView(camera);
		let renderedCount = 0;
		this.views.forEach((view) => {
			const { x, z } = view.getTarget();
			const renderEnabled =
				!cullingEnabled ||
				isMonsterInCameraEnvelope(
					x,
					z,
					this.cameraView,
					MONSTER_RENDER_CULLING_CONFIG.margin,
				);
			view.setRenderEnabled(renderEnabled);
			if (renderEnabled && view.shouldRefreshGroundHeight(deltaTime))
				view.setGroundHeight(this.mapGen.getGroundHeight(x, z));
			if (!renderEnabled) {
				view.updateOffscreen(deltaTime);
				return;
			}
			renderedCount++;
			view.update(deltaTime, camera, this.room.state.combatTimeS);
		});
		renderedCount += this.bakedMonsters.update(
			deltaTime,
			this.room.state.combatTimeS,
			this.cameraView,
			cullingEnabled,
		);
		this.flushPendingMonsterRemovals(deltaTime);
		this.renderedMonsterCount = renderedCount;
		this.damageNumbers.update(deltaTime);
	}

	getDebugStats(): Readonly<MonsterRendererStats> {
		this.debugStats.total = this.room.state.monsters.size;
		this.debugStats.elites = this.eliteMonsterCount;
		this.debugStats.bosses = this.bossMonsterCount;
		this.debugStats.rendered = this.renderedMonsterCount;
		return this.debugStats;
	}

	private updateCameraView(camera: BABYLON.Camera): void {
		camera.getDirectionToRef(BABYLON.Axis.Z, this.cameraForward);
		const horizontalLength = Math.hypot(
			this.cameraForward.x,
			this.cameraForward.z,
		);
		if (horizontalLength <= Number.EPSILON) return;
		this.cameraView.cameraX = camera.globalPosition.x;
		this.cameraView.cameraZ = camera.globalPosition.z;
		this.cameraView.forwardX = this.cameraForward.x / horizontalLength;
		this.cameraView.forwardZ = this.cameraForward.z / horizontalLength;
		const aspect = camera.getEngine().getAspectRatio(camera);
		if (
			camera.fov === this.lastCameraFov &&
			aspect === this.lastCameraAspect
		)
			return;
		this.lastCameraFov = camera.fov;
		this.lastCameraAspect = aspect;
		const horizontalHalfFov = Math.atan(
			Math.tan(camera.fov * 0.5) * Math.max(1, aspect),
		);
		this.cameraView.halfFovTangent = Math.tan(
			Math.min(
				Math.PI * 0.49,
				horizontalHalfFov +
					MONSTER_RENDER_CULLING_CONFIG.fovMarginRadians,
			),
		);
	}

	private onDamage(events: MonsterDamageEvent[]): void {
		for (const event of events) {
			const view = this.views.get(event.id);
			view?.flashDamage();
			if (!view) this.bakedMonsters.flashDamage(event.id);
			if (event.fatal) {
				this.dyingMonsterIds.add(event.id);
				this.startMonsterDeath(event.id, view);
			}
			const position = this.damagePosition;
			if (view) view.getHeadWorldPositionToRef(position);
			else
				position.set(
					event.x,
					event.y +
						(event.isBoss
							? FATAL_BOSS_HEAD_OFFSET
							: FATAL_HEAD_OFFSET),
					event.z,
				);
			this.damageNumbers.spawn(
				position,
				event.amount,
				event.isBoss,
				event.fatal,
				event.isElite,
			);
		}
	}

	private startMonsterDeath(
		monsterId: string,
		view = this.views.get(monsterId),
	): void {
		if (view) {
			this.pendingMonsterRemovals.set(monsterId, view.startDeath());
			return;
		}
		const bakedDuration = this.bakedMonsters.startDeath(
			monsterId,
			this.room.state.combatTimeS,
		);
		if (bakedDuration !== null) {
			this.pendingMonsterRemovals.set(monsterId, bakedDuration);
			return;
		}
		const remaining = this.pendingMonsterRemovals.get(monsterId) ?? 0;
		this.pendingMonsterRemovals.set(
			monsterId,
			Math.max(remaining, DEATH_VIEW_LOAD_GRACE_S),
		);
	}

	private queueMonsterRemoval(monsterId: string): void {
		if (this.dyingMonsterIds.has(monsterId)) {
			this.startMonsterDeath(monsterId);
			return;
		}
		if (!this.pendingMonsterRemovals.has(monsterId))
			this.pendingMonsterRemovals.set(monsterId, MONSTER_REMOVE_GRACE_S);
	}

	private flushPendingMonsterRemovals(deltaTime: number): void {
		const elapsed = Math.max(0, deltaTime);
		for (const [monsterId, remaining] of this.pendingMonsterRemovals) {
			const view = this.views.get(monsterId);
			if (this.dyingMonsterIds.has(monsterId) && view) {
				if (view.isDeathComplete()) this.removeMonsterNow(monsterId);
				continue;
			}
			const nextRemaining = remaining - elapsed;
			if (nextRemaining <= 0) this.removeMonsterNow(monsterId);
			else this.pendingMonsterRemovals.set(monsterId, nextRemaining);
		}
	}

	private updateMonsterView(monsterId: string, monster: Monster): void {
		const view = this.views.get(monsterId);
		if (!view) {
			this.bakedMonsters.setTarget(monsterId, monster);
			return;
		}
		view.setTarget(monster.x, monster.z, monster.rotationY);
		view.setAnimationState(monster.animState, monster.animStartedAtS);
	}

	private async addBakedMonster(
		monster: Monster,
		monsterId: string,
	): Promise<void> {
		try {
			await this.bakedMonsters.add(monster, monsterId);
			if (this.dyingMonsterIds.has(monsterId))
				this.startMonsterDeath(monsterId);
		} catch (error) {
			console.warn(
				`VAT unavailable for monster '${monster.kind}', using fallback`,
				error,
			);
			void this.addMonster(monster, monsterId);
		}
	}

	private async addMonster(
		monster: Monster,
		monsterId: string,
	): Promise<void> {
		try {
			await this.views.add(monsterId, async () => {
				const url = getMonsterModelUrl(monster.kind);
				if (!url)
					throw new Error(`Unknown monster model '${monster.kind}'`);
				let model: ModelInstance;
				let staticPoses: StaticAnimationPoses;
				if (monster.isBoss) {
					const prewarmed = await this.acquireBossModel(
						monster.kind,
						url,
					);
					model = prewarmed.model;
					staticPoses = prewarmed.staticPoses;
					model.root.setEnabled(true);
				} else {
					await this.prepareModel(url);
					model = await this.assets.instantiate(
						url,
						`${monster.kind}_${monster.isElite ? 'elite' : 'normal'}`,
						{ doNotInstantiate: true },
					);
					staticPoses = this.prepareModelInstance(model);
				}
				const view = new MonsterView(
					model.root,
					model.animationGroups,
					staticPoses,
					monster.kind,
					monster.isBoss,
					monster.animState,
					monster.animStartedAtS,
					this.room.state.combatTimeS,
					this.hitboxMaterial,
					this.damageFlashMaterial,
					monster.isElite,
				);
				view.snapTo(
					monster.x,
					monster.z,
					this.mapGen.getGroundHeight(monster.x, monster.z),
					monster.rotationY,
				);
				view.setHitboxVisible(this.hitboxesVisible);
				return view;
			});
			const view = this.views.get(monsterId);
			if (!view) return;
			if (this.dyingMonsterIds.has(monsterId))
				this.startMonsterDeath(monsterId, view);
		} catch (error) {
			console.error(`failed to render monster '${monster.kind}'`, error);
		}
	}

	private prepareModelInstance(model: ModelInstance): StaticAnimationPoses {
		const staticPoses = extractStaticAnimationPoses(model.animationGroups);
		model.animationGroups.forEach((animation) => animation.stop());
		this.mapGen.prepareRenderable(model.root, false);
		return staticPoses;
	}

	private disposeModel(model: ModelInstance): void {
		model.animationGroups.forEach((group) => group.dispose());
		model.root.dispose();
	}

	private removeMonsterNow(monsterId: string): void {
		this.monsterChangeSubscriptions.get(monsterId)?.();
		this.monsterChangeSubscriptions.delete(monsterId);
		this.pendingMonsterRemovals.delete(monsterId);
		this.dyingMonsterIds.delete(monsterId);
		this.bakedMonsters.remove(monsterId);
		this.views.remove(monsterId);
	}

	dispose(): void {
		this.disposed = true;
		this.subscriptions.dispose();
		for (const detach of this.monsterChangeSubscriptions.values()) detach();
		this.monsterChangeSubscriptions.clear();
		this.pendingMonsterRemovals.clear();
		this.dyingMonsterIds.clear();
		this.bossPrewarmTimers.clear();
		for (const pending of this.prewarmedBosses.values())
			void pending
				.then(({ model }) => this.disposeModel(model))
				.catch(() => {});
		this.prewarmedBosses.clear();
		this.bakedMonsters.dispose();
		this.views.dispose();
		this.damageNumbers.dispose();
		this.assets.dispose();
		this.hitboxMaterial.dispose();
		this.damageFlashMaterial.dispose();
		this.overlayUi.dispose();
	}
}
