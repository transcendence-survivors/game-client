import type * as BABYLON from '@babylonjs/core';
import * as COLYSEUS from '@colyseus/sdk';
import {
	getMonsterDefinition,
	ServerMessage,
	type GameState,
	type Monster,
	type MonsterDamageEvent,
	type World,
} from '@transcendence/game-shared';
import type { ModelAssetLibrary } from '../assets/ModelAssetLibrary';
import { getAllMonsterAssets } from '../assets/models';
import { CleanupBag } from '../CleanupBag';
import { DamageNumbers } from './DamageNumbers';
import { MonsterModelBatch } from './MonsterModelBatch';
import { MonsterView } from './MonsterView';

export class MonsterRenderer {
	private readonly scene: BABYLON.Scene;
	private readonly room: COLYSEUS.Room<GameState>;
	private readonly world: World;
	private readonly modelLibrary: ModelAssetLibrary;
	private readonly damageNumbers: DamageNumbers;
	private readonly subscriptions = new CleanupBag();
	private readonly monsterViews = new Map<string, MonsterView>();
	private readonly modelBatches = new Map<string, MonsterModelBatch>();
	private readonly removalDelaysS = new Map<MonsterView, number>();
	private renderedCount = 0;
	private disposed = false;

	constructor(
		scene: BABYLON.Scene,
		room: COLYSEUS.Room<GameState>,
		world: World,
		modelLibrary: ModelAssetLibrary,
	) {
		this.scene = scene;
		this.room = room;
		this.world = world;
		this.modelLibrary = modelLibrary;
		this.damageNumbers = new DamageNumbers(scene);
		for (const assets of getAllMonsterAssets())
			MonsterModelBatch.load(this.scene, this.modelLibrary, assets).then(
				(batch) => {
					if (this.disposed) return batch.dispose();
					this.modelBatches.set(assets.id, batch);
					this.monsterViews.forEach((view) => this.attachModel(view));
				},
				(error) => console.error(`monster model '${assets.id}'`, error),
			);
		const callbacks = COLYSEUS.Callbacks.get(room);
		this.subscriptions.add(
			callbacks.onAdd('monsters', (monster, id) =>
				this.addMonster(monster, id),
			),
			callbacks.onRemove('monsters', (_monster, id) => {
				const view = this.monsterViews.get(id);
				if (view) this.startDeath(view);
			}),
			this.room.onMessage(
				ServerMessage.MonsterDamage,
				(events: MonsterDamageEvent[]) => this.onMonsterDamage(events),
			),
		);
	}

	getRenderedCount(): number {
		return this.renderedCount;
	}

	update(deltaTime: number): void {
		const elapsedS = Math.min(0.25, deltaTime);
		const combatTimeS = this.room.state.combatTimeS;
		const camera = this.scene.activeCamera;
		const planes = this.scene.frustumPlanes;
		this.renderedCount = 0;
		for (const batch of this.modelBatches.values()) {
			batch.beginFrame();
			let visibleCount = 0;
			for (const view of batch.monsters) {
				if (camera && planes && !view.isVisible(planes, camera))
					continue;
				view.update(elapsedS, combatTimeS, this.world);
				view.writeTo(visibleCount++, combatTimeS);
			}
			this.renderedCount += visibleCount;
			batch.endFrame(visibleCount, combatTimeS);
		}
		for (const [view, remainingS] of this.removalDelaysS)
			if (remainingS <= elapsedS) this.removeMonster(view);
			else this.removalDelaysS.set(view, remainingS - elapsedS);
		this.damageNumbers.update(deltaTime);
	}

	dispose(): void {
		this.disposed = true;
		this.subscriptions.dispose();
		this.monsterViews.clear();
		this.modelBatches.forEach((batch) => batch.dispose());
		this.modelBatches.clear();
		this.damageNumbers.dispose();
	}

	private addMonster(monster: Monster, id: string): void {
		const view = new MonsterView(
			id,
			monster,
			this.world,
			this.room.state.combatTimeS,
		);
		this.monsterViews.set(id, view);
		if (!getMonsterDefinition(monster.kind))
			return console.error(`unknown monster model '${monster.kind}'`);
		this.attachModel(view);
	}

	private attachModel(view: MonsterView): void {
		const modelId = getMonsterDefinition(view.monster.kind)!.modelId;
		const batch = this.modelBatches.get(modelId);
		if (view.modelBatch || !batch) return;
		view.modelBatch = batch;
		batch.monsters.add(view);
	}

	private onMonsterDamage(events: MonsterDamageEvent[]): void {
		for (const event of events) {
			const view = this.monsterViews.get(event.id);
			view?.flash();
			this.damageNumbers.spawn(event, view?.headHeight ?? 0);
		}
	}

	private startDeath(view: MonsterView): void {
		const deathDurationS = view.startDeath(this.room.state.combatTimeS);
		if (deathDurationS === null) this.removeMonster(view);
		else this.removalDelaysS.set(view, deathDurationS);
	}

	private removeMonster(view: MonsterView): void {
		view.modelBatch?.monsters.delete(view);
		this.monsterViews.delete(view.id);
		this.removalDelaysS.delete(view);
	}
}
