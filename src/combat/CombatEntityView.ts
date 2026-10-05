import * as BABYLON from '@babylonjs/core';
import type { CombatEntity } from '@transcendence/game-shared';

const SNAP_DISTANCE_SQUARED = 36;
const INTERPOLATION_SPEED = 20;

export function combatInterpolationFactor(deltaTimeS: number): number {
	if (!Number.isFinite(deltaTimeS) || deltaTimeS <= 0) return 0;
	return Math.min(1, deltaTimeS * INTERPOLATION_SPEED);
}

export function shouldSnapCombatEntity(distanceSquared: number): boolean {
	return (
		Number.isFinite(distanceSquared) &&
		distanceSquared > SNAP_DISTANCE_SQUARED
	);
}

type AnimateCallback = (deltaTimeS: number, combatTimeS: number) => void;

export class CombatEntityView {
	protected readonly entity: CombatEntity;
	protected readonly root: BABYLON.TransformNode;
	private readonly target = new BABYLON.Vector3();
	private readonly onAnimate?: AnimateCallback;

	constructor(
		entity: CombatEntity,
		root: BABYLON.TransformNode,
		onAnimate?: AnimateCallback,
	) {
		this.entity = entity;
		this.root = root;
		this.onAnimate = onAnimate;
		this.snap();
	}

	update(deltaTimeS: number, combatTimeS: number): void {
		this.target.set(this.entity.x, this.entity.y, this.entity.z);
		if (
			shouldSnapCombatEntity(
				BABYLON.Vector3.DistanceSquared(
					this.root.position,
					this.target,
				),
			)
		) {
			this.root.position.copyFrom(this.target);
		} else {
			BABYLON.Vector3.LerpToRef(
				this.root.position,
				this.target,
				combatInterpolationFactor(deltaTimeS),
				this.root.position,
			);
		}
		this.root.rotation.y = this.entity.rotationY;
		this.animate(deltaTimeS, combatTimeS);
		this.onAnimate?.(deltaTimeS, combatTimeS);
	}

	dispose(): void {
		this.root.dispose();
	}

	protected animate(_deltaTimeS: number, _combatTimeS: number): void {}

	private snap(): void {
		this.root.position.set(this.entity.x, this.entity.y, this.entity.z);
		this.root.rotation.y = this.entity.rotationY;
	}
}

export class ProjectileView extends CombatEntityView {
	protected animate(_deltaTimeS: number, _combatTimeS: number): void {
		const horizontal = Math.hypot(
			this.entity.directionX,
			this.entity.directionZ,
		);
		if (horizontal > 0.0001 || Math.abs(this.entity.directionY) > 0.0001) {
			this.root.rotation.x = -Math.atan2(
				this.entity.directionY,
				horizontal,
			);
		}
	}
}
