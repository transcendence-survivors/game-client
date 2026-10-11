import * as BABYLON from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import * as COLYSEUS from '@colyseus/sdk';
import {
	WEAPON_KINDS,
	type CombatEntity,
	type GameState,
	type WeaponKind,
} from '@transcendence/game-shared';
import type { ModelAssetLibrary } from '../assets/ModelAssetLibrary';
import { applyTransform, type Transform } from '../assets/Transform';
import { CleanupBag } from '../CleanupBag';
import { AsyncViewRegistry } from '../AsyncViewRegistry';
import { smoothingFactor, smoothTowards } from '../ServerSmoothing';
import {
	WEAPON_VISUALS,
	type AttackAnimationConfig,
	type ProjectileVisual,
} from './WeaponVisuals';

const PROJECTILE_SMOOTHING_SPEED = 20;

interface ProjectileView {
	entity: CombatEntity;
	motionNode: BABYLON.TransformNode;
	spinSpeed: number;
	dispose(): void;
}

const heldWeaponKey = (playerId: string, weapon: WeaponKind) =>
	`${playerId}:${weapon}`;

export class CombatRenderer {
	private readonly scene: BABYLON.Scene;
	private readonly modelLibrary: ModelAssetLibrary;
	private readonly projectileViews = new AsyncViewRegistry<ProjectileView>();
	private readonly heldWeapons =
		new AsyncViewRegistry<BABYLON.TransformNode>();
	private readonly subscriptions = new CleanupBag();

	constructor(
		scene: BABYLON.Scene,
		room: COLYSEUS.Room<GameState>,
		modelLibrary: ModelAssetLibrary,
	) {
		this.scene = scene;
		this.modelLibrary = modelLibrary;
		const observer = scene.onBeforeRenderObservable.add(() =>
			this.updateProjectileViews(),
		);
		const callbacks = COLYSEUS.Callbacks.get(room);
		this.subscriptions.add(
			() => scene.onBeforeRenderObservable.remove(observer),
			callbacks.onAdd('combatEntities', (entity, id) =>
				this.onCombatEntityAdded(entity, id),
			),
			callbacks.onRemove('combatEntities', (_entity, id) =>
				this.projectileViews.remove(id),
			),
		);
	}

	removePlayer(playerId: string): void {
		for (const weapon of WEAPON_KINDS)
			this.heldWeapons.remove(heldWeaponKey(playerId, weapon));
	}

	attachHeldWeapon(
		playerId: string,
		playerMesh: BABYLON.AbstractMesh,
		weapon: WeaponKind,
	): void {
		const heldVisual = WEAPON_VISUALS[weapon].held;
		if (!heldVisual) return;
		this.heldWeapons
			.add(heldWeaponKey(playerId, weapon), async () => {
				const model = await this.loadWeaponModel(
					heldVisual.url,
					`${weapon}:${playerId}`,
				);
				const motionNode = this.insertMotionNode(
					model,
					heldVisual.modelCorrection,
					playerMesh,
				);
				applyTransform(motionNode, heldVisual.handPlacement);
				return motionNode;
			})
			.catch((error) => console.error(`weapon '${weapon}'`, error));
	}

	dispose(): void {
		this.subscriptions.dispose();
		this.projectileViews.dispose();
		this.heldWeapons.dispose();
	}

	private onCombatEntityAdded(entity: CombatEntity, id: string): void {
		this.playAttackAnimation(entity.ownerSessionId, entity.weaponKind);
		const projectileVisual = WEAPON_VISUALS[entity.weaponKind].projectile;
		if (!projectileVisual) return;
		this.projectileViews
			.add(id, () =>
				this.createProjectileView(entity, id, projectileVisual),
			)
			.catch((error) =>
				console.error(`projectile '${entity.kind}'`, error),
			);
	}

	private playAttackAnimation(playerId: string, weapon: WeaponKind): void {
		const heldVisual = WEAPON_VISUALS[weapon].held;
		const motionNode = this.heldWeapons.get(
			heldWeaponKey(playerId, weapon),
		);
		if (!heldVisual || !motionNode) return;
		const config = heldVisual.attackAnimation;
		this.scene.stopAnimation(motionNode);
		this.scene.beginDirectAnimation(
			motionNode,
			[this.createAttackAnimation(weapon, config)],
			0,
			config.frames[config.frames.length - 1],
			false,
			1,
			() => (motionNode[config.property][config.axis] = config.values[0]),
		);
	}

	private createAttackAnimation(
		weapon: WeaponKind,
		config: AttackAnimationConfig,
	): BABYLON.Animation {
		const animation = new BABYLON.Animation(
			`${weapon}Attack`,
			`${config.property}.${config.axis}`,
			60,
			BABYLON.Animation.ANIMATIONTYPE_FLOAT,
			BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT,
		);
		animation.setKeys(
			config.frames.map((frame, i) => ({
				frame,
				value: config.values[i],
			})),
		);
		const easing = new BABYLON.QuadraticEase();
		easing.setEasingMode(config.easing);
		animation.setEasingFunction(easing);
		return animation;
	}

	private async createProjectileView(
		entity: CombatEntity,
		id: string,
		visual: ProjectileVisual,
	): Promise<ProjectileView> {
		const model = await this.loadWeaponModel(
			visual.url,
			`${entity.kind}:${id}`,
		);
		const motionNode = this.insertMotionNode(
			model,
			visual.modelCorrection,
			null,
		);
		motionNode.position.set(entity.x, entity.y, entity.z);
		motionNode.rotation.y = entity.rotationY;
		motionNode.scaling.setAll(entity.scale);
		return {
			entity,
			motionNode,
			spinSpeed: visual.spinSpeed,
			dispose: () => motionNode.dispose(),
		};
	}

	private updateProjectileViews(): void {
		const deltaS = this.scene.getEngine().getDeltaTime() / 1000;
		const factor = smoothingFactor(PROJECTILE_SMOOTHING_SPEED, deltaS);
		this.projectileViews.forEach(({ entity, motionNode, spinSpeed }) => {
			const { x, y, z } = entity;
			smoothTowards(motionNode.position, x, y, z, factor);
			motionNode.rotation.y += deltaS * spinSpeed;
		});
	}

	private insertMotionNode(
		model: BABYLON.TransformNode,
		modelCorrection: Transform,
		parent: BABYLON.Node | null,
	): BABYLON.TransformNode {
		const motionNode = new BABYLON.TransformNode(
			`${model.name}:motion`,
			this.scene,
		);
		motionNode.parent = parent;
		model.parent = motionNode;
		applyTransform(model, modelCorrection);
		return motionNode;
	}

	private async loadWeaponModel(
		url: string,
		name: string,
	): Promise<BABYLON.TransformNode> {
		const { root } = await this.modelLibrary.instantiate(url, name);
		root.getChildMeshes().forEach((mesh) => (mesh.isPickable = false));
		return root;
	}
}
