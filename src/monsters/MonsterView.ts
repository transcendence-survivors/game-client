import * as BABYLON from '@babylonjs/core';
import type { Monster, World } from '@transcendence/game-shared';
import { smoothingFactor, smoothTowards } from '../ServerSmoothing';
import type { AnimationState, MonsterModelBatch } from './MonsterModelBatch';

const POSITION_SMOOTHING_SPEED = 10;
const GROUND_SMOOTHING_SPEED = 20;
const DAMAGE_FLASH_S = 0.14;
const ATTACK_EXIT_DELAY_S = 0.35;
const MODEL_YAW_OFFSET = Math.PI;
const CULL_MARGIN = 5;
const CAMERA_HIDE_MIN_HEIGHT = 5;
const CAMERA_HIDE_MARGIN = 0.4;
const CAMERA_SHOW_MARGIN = 1.6;

const instanceRotation = BABYLON.Quaternion.Identity();
const instanceMatrix = BABYLON.Matrix.Identity();
const cullCenter = BABYLON.Vector3.Zero();

export class MonsterView {
	readonly id: string;
	readonly monster: Monster;
	modelBatch: MonsterModelBatch | null = null;
	private readonly scale: number;
	private readonly scaling: BABYLON.Vector3;
	private readonly position: BABYLON.Vector3;
	private rotationY: number;
	private serverState: AnimationState;
	private serverStateChangedAtS: number;
	private shownState: AnimationState;
	private shownStateStartedAtS: number;
	private flashRemainingS = 0;
	private hiddenByCamera = false;
	private snapOnNextUpdate = false;

	constructor(
		id: string,
		monster: Monster,
		world: World,
		combatTimeS: number,
	) {
		this.id = id;
		this.monster = monster;
		this.scale = monster.modelScale;
		this.scaling = new BABYLON.Vector3(this.scale, this.scale, -this.scale);
		const groundY = world.height(monster.x, monster.z);
		this.position = new BABYLON.Vector3(monster.x, groundY, monster.z);
		this.rotationY = monster.rotationY;
		this.serverState = monster.animState;
		this.serverStateChangedAtS = combatTimeS;
		this.shownState = monster.animState;
		this.shownStateStartedAtS = monster.animStartedAtS;
	}

	get headHeight(): number {
		return this.modelBatch ? this.modelBatch.bodyHeight * this.scale : 0;
	}

	get isDying(): boolean {
		return this.shownState === 'death';
	}

	flash(): void {
		if (!this.isDying) this.flashRemainingS = DAMAGE_FLASH_S;
	}

	startDeath(combatTimeS: number): number | null {
		const deathClip = this.modelBatch?.clips.death;
		if (!deathClip) return null;
		this.shownState = 'death';
		this.shownStateStartedAtS = combatTimeS;
		const { start, end, fps } = deathClip;
		return (end - start + 1) / fps;
	}

	isVisible(
		planes: readonly BABYLON.Plane[],
		camera: BABYLON.Camera,
	): boolean {
		const visible =
			this.isInCameraView(planes) && !this.isHiddenByCamera(camera);
		if (!visible) this.snapOnNextUpdate = true;
		return visible;
	}

	update(elapsedS: number, combatTimeS: number, world: World): void {
		this.updateMotion(elapsedS, world);
		this.updateShownAnimation(combatTimeS);
		this.flashRemainingS = Math.max(0, this.flashRemainingS - elapsedS);
	}

	writeTo(index: number, combatTimeS: number): void {
		const batch = this.modelBatch!;
		BABYLON.Quaternion.RotationYawPitchRollToRef(
			this.rotationY + MODEL_YAW_OFFSET,
			0,
			0,
			instanceRotation,
		);
		BABYLON.Matrix.ComposeToRef(
			this.scaling,
			instanceRotation,
			this.position,
			instanceMatrix,
		);
		const clip = batch.clips[this.shownState];
		const deathFrame = (combatTimeS - this.shownStateStartedAtS) * clip.fps;
		batch.setInstance(
			index,
			instanceMatrix,
			clip,
			this.isDying
				? Math.min(clip.end - clip.start, Math.max(0, deathFrame))
				: -this.shownStateStartedAtS * clip.fps,
			this.isDying ? 0 : clip.fps,
			1 - this.flashRemainingS / DAMAGE_FLASH_S,
		);
	}

	private isInCameraView(planes: readonly BABYLON.Plane[]): boolean {
		const { bodyRadius, bodyHeight } = this.modelBatch!;
		const radius =
			Math.max(bodyRadius, bodyHeight) * this.scale + CULL_MARGIN;
		cullCenter.set(
			this.monster.x,
			this.position.y + bodyHeight * this.scale * 0.5,
			this.monster.z,
		);
		for (const plane of planes)
			if (plane.dotCoordinate(cullCenter) < -radius) return false;
		return true;
	}

	private isHiddenByCamera(camera: BABYLON.Camera): boolean {
		const { bodyRadius, bodyHeight } = this.modelBatch!;
		if (bodyHeight * this.scale < CAMERA_HIDE_MIN_HEIGHT) return false;
		const eye = camera.globalPosition;
		const body = this.position;
		const margin = this.hiddenByCamera
			? CAMERA_SHOW_MARGIN
			: CAMERA_HIDE_MARGIN;
		this.hiddenByCamera =
			Math.hypot(eye.x - body.x, eye.z - body.z) <
				bodyRadius * this.scale + margin &&
			eye.y > body.y - margin &&
			eye.y < body.y + bodyHeight * this.scale + margin;
		return this.hiddenByCamera;
	}

	private updateMotion(elapsedS: number, world: World): void {
		const { position, monster } = this;
		if (this.snapOnNextUpdate) {
			this.snapOnNextUpdate = false;
			position.set(
				monster.x,
				world.height(monster.x, monster.z),
				monster.z,
			);
			this.rotationY = monster.rotationY;
			return;
		}
		const factor = smoothingFactor(POSITION_SMOOTHING_SPEED, elapsedS);
		const groundY = world.height(monster.x, monster.z);
		smoothTowards(position, monster.x, position.y, monster.z, factor);
		position.y +=
			(groundY - position.y) *
			smoothingFactor(GROUND_SMOOTHING_SPEED, elapsedS);
		this.rotationY = BABYLON.Scalar.LerpAngle(
			this.rotationY,
			monster.rotationY,
			factor,
		);
	}

	private updateShownAnimation(combatTimeS: number): void {
		const serverState = this.monster.animState;
		if (serverState !== this.serverState) {
			this.serverState = serverState;
			this.serverStateChangedAtS = combatTimeS;
		}
		const isLeavingAttack =
			this.shownState === 'attack' &&
			serverState !== 'attack' &&
			combatTimeS - this.serverStateChangedAtS < ATTACK_EXIT_DELAY_S;
		if (!this.isDying && !isLeavingAttack) {
			this.shownState = serverState;
			this.shownStateStartedAtS = this.monster.animStartedAtS;
		}
	}
}
