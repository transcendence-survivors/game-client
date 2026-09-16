import * as BABYLON from '@babylonjs/core';
import {
	BOSS_MODEL_SCALE,
	ELITE_MODEL_SCALE,
	getMonsterCompoundHitboxes,
	getMonsterDefinition,
	MONSTER_MODEL_SCALE,
	type MonsterAnimState,
	type MonsterHitboxPrimitive,
} from '@transcendence/game-shared';
import { MONSTER_HITBOX_RENDERING_GROUP } from '../combat/DebugRenderingGroups';
import { configureDebugMesh } from '../combat/DebugMaterial';
import {
	animationFramesPerSecond,
	applyStaticAnimationPose,
	type StaticAnimationPose,
	type StaticAnimationPoses,
} from './AnimationOptimization';
import { MONSTER_RENDER_CULLING_CONFIG } from './MonsterRenderCulling';
import {
	MONSTER_DAMAGE_FLASH_DURATION_S,
	MONSTER_GROUND_HEIGHT_INTERVAL_S,
	MONSTER_GROUND_LERP_SPEED,
	MONSTER_MODEL_YAW_OFFSET,
	MONSTER_POSITION_LERP_SPEED,
	type MonsterPresentationAnimation,
	type MonsterPresentationState,
} from './MonsterPresentation';

const BODY_HIDE_MARGIN = 0.4;
const BODY_SHOW_MARGIN = 1.6;

const ATTACK_EXIT_DELAY_S = 0.35;

export const MONSTER_ANIMATION_INTERVAL_S = 1 / 30;

const MONSTER_CAMERA_OCCLUSION_HZ = 15;
const MONSTER_CAMERA_OCCLUSION_INTERVAL_S = 1 / MONSTER_CAMERA_OCCLUSION_HZ;
const ANIMATION_PHASE_BUCKETS = 8;

export function normalizeAnimationName(name: string): string {
	return name.split(/[_:]/).pop()!.toLowerCase();
}

export function semanticAnimationName(name: string): string {
	const normalized = normalizeAnimationName(name);
	const lowerName = name.toLowerCase();
	if (lowerName.endsWith('bite_front') || normalized === 'punch')
		return 'attack';
	if (lowerName.endsWith('fast_flying') || normalized === 'run')
		return 'walk';
	if (lowerName.endsWith('flying_idle')) return 'idle';
	return normalized;
}

export function animationTransitionDelay(
	current: MonsterPresentationAnimation | null,
	next: MonsterPresentationAnimation,
): number {
	return current === 'attack' && next !== 'attack' ? ATTACK_EXIT_DELAY_S : 0;
}

export function loopedAnimationFrame(
	from: number,
	to: number,
	framesPerSecond: number,
	timeS: number,
): number {
	const duration = to - from;
	return duration > 0 ? from + ((timeS * framesPerSecond) % duration) : from;
}

function animationDurationS(group: BABYLON.AnimationGroup): number {
	const framesPerSecond = animationFramesPerSecond(group);
	const durationFrames = group.to - group.from;
	return framesPerSecond > 0 && durationFrames > 0
		? durationFrames / framesPerSecond
		: 0;
}

export class MonsterView {
	private root!: BABYLON.TransformNode;
	private animations = new Map<string, BABYLON.AnimationGroup>();
	private readonly staticAnimationPoses = new Map<
		string,
		StaticAnimationPose
	>();
	private currentAnimation: MonsterPresentationAnimation | null = null;
	private renderEnabled = true;
	private readonly target = { x: 0, z: 0, rotationY: 0 };
	private animationState: Exclude<
		MonsterPresentationState['animationState'],
		'death'
	> = 'idle';
	private animationStartedAtS: MonsterPresentationState['animationStartedAtS'] = 0;
	private animationStateAgeS = 0;
	private animationSampleAccumulatorS = 0;
	private groundHeightAccumulatorS = 0;
	private cameraOcclusionAccumulatorS = MONSTER_CAMERA_OCCLUSION_INTERVAL_S;
	private hitboxUpdateAccumulatorS = 0;
	private groundHeight = 0;
	private isBoss = false;
	private modelSizeMultiplier = 1;
	private readonly kind: string;
	private headAnchor: BABYLON.TransformNode | null = null;
	private childMeshes: BABYLON.AbstractMesh[] | null = null;
	private bodyMeasured = false;
	private bodyRadiusXZ = 0;
	private bodyMinY = 0;
	private bodyMaxY = 0;
	private bodyHidden = false;
	private damageFlashRemainingS = 0;
	private readonly damageFlashMaterial: BABYLON.Material;
	private readonly damageFlashOriginalMaterials = new Map<
		BABYLON.AbstractMesh,
		BABYLON.Material | null
	>();
	private deathStarted = false;
	private deathElapsedS = 0;
	private deathDurationS = 0;
	private readonly hitboxParts: readonly MonsterHitboxPrimitive[];
	private readonly posedHitboxParts: MonsterHitboxPrimitive[] = [];
	private readonly hitboxMaterial: BABYLON.Material;
	private readonly hitboxMeshes: BABYLON.Mesh[] = [];
	private hitboxesVisible = false;

	constructor(
		root: BABYLON.TransformNode,
		animationGroups: BABYLON.AnimationGroup[],
		staticAnimationPoses: StaticAnimationPoses,
		kind: string,
		isBoss: boolean,
		initialAnimationState: MonsterAnimState,
		initialAnimationStartedAtS: number,
		combatTimeS: number,
		hitboxMaterial: BABYLON.Material,
		damageFlashMaterial: BABYLON.Material,
		isElite = false,
	) {
		this.root = root;
		this.animationSampleAccumulatorS =
			(Math.abs(root.uniqueId) % ANIMATION_PHASE_BUCKETS) *
			(MONSTER_ANIMATION_INTERVAL_S / ANIMATION_PHASE_BUCKETS);
		this.kind = kind;
		this.isBoss = isBoss;
		this.modelSizeMultiplier =
			(getMonsterDefinition(kind)?.visualScale ?? 1) *
			(isElite ? ELITE_MODEL_SCALE : 1);
		this.animationState = initialAnimationState;
		this.animationStartedAtS = initialAnimationStartedAtS;
		this.hitboxParts = getMonsterCompoundHitboxes(
			kind,
			isBoss,
			'idle',
			0,
			[],
			this.modelSizeMultiplier,
		);
		this.hitboxMaterial = hitboxMaterial;
		this.damageFlashMaterial = damageFlashMaterial;
		this.root.rotationQuaternion = null;
		this.root.scaling = this.root.scaling.scale(
			MONSTER_MODEL_SCALE *
				(isBoss ? BOSS_MODEL_SCALE : 1) *
				this.modelSizeMultiplier,
		);
		if (MONSTER_RENDER_CULLING_CONFIG.forceActiveMeshes)
			for (const mesh of this.getMeshes()) {
				mesh.alwaysSelectAsActiveMesh = true;
				mesh.isPickable = false;
				mesh.checkCollisions = false;
			}
		for (const group of animationGroups) {
			const name = semanticAnimationName(group.name);
			this.animations.set(name, group);
			const pose = staticAnimationPoses.get(group);
			if (pose) this.staticAnimationPoses.set(name, pose);
		}
		this.play(
			initialAnimationState,
			true,
			this.animationTimeS(combatTimeS),
		);
	}

	getMeshes(): BABYLON.AbstractMesh[] {
		if (!this.childMeshes) this.childMeshes = this.root.getChildMeshes();
		return this.childMeshes;
	}

	private measureBody() {
		if (this.bodyMeasured) return;
		this.bodyMeasured = true;
		const bounds = this.root.getHierarchyBoundingVectors();
		const position = this.root.position;
		this.bodyRadiusXZ = Math.max(
			bounds.max.x - position.x,
			position.x - bounds.min.x,
			bounds.max.z - position.z,
			position.z - bounds.min.z,
		);
		this.bodyMinY = bounds.min.y - position.y;
		this.bodyMaxY = bounds.max.y - position.y;
	}

	private updateCameraOcclusion(cameraPosition: BABYLON.Vector3) {
		this.measureBody();
		const position = this.root.position;
		const distanceXZ = Math.hypot(
			cameraPosition.x - position.x,
			cameraPosition.z - position.z,
		);
		const margin = this.bodyHidden ? BODY_SHOW_MARGIN : BODY_HIDE_MARGIN;
		const inside =
			distanceXZ < this.bodyRadiusXZ + margin &&
			cameraPosition.y > position.y + this.bodyMinY - margin &&
			cameraPosition.y < position.y + this.bodyMaxY + margin;
		if (inside === this.bodyHidden) return;
		this.bodyHidden = inside;
		for (const mesh of this.getMeshes()) mesh.isVisible = !inside;
	}

	snapTo(x: number, z: number, y: number, rotationY: number) {
		this.setTarget(x, z, rotationY);
		this.groundHeight = y;
		this.root.position.set(x, y, z);
		this.root.rotation.y = rotationY + MONSTER_MODEL_YAW_OFFSET;
	}

	setTarget(x: number, z: number, rotationY: number) {
		if (
			this.target.x === x &&
			this.target.z === z &&
			this.target.rotationY === rotationY
		)
			return;
		this.target.x = x;
		this.target.z = z;
		this.target.rotationY = rotationY;
	}

	shouldRefreshGroundHeight(deltaTime: number): boolean {
		if (!Number.isFinite(deltaTime) || deltaTime <= 0) return false;
		this.groundHeightAccumulatorS += Math.min(deltaTime, 0.25);
		if (
			this.groundHeightAccumulatorS + Number.EPSILON <
			MONSTER_GROUND_HEIGHT_INTERVAL_S
		)
			return false;
		this.groundHeightAccumulatorS %= MONSTER_GROUND_HEIGHT_INTERVAL_S;
		return true;
	}

	setGroundHeight(height: number): void {
		if (Number.isFinite(height)) this.groundHeight = height;
	}

	setRenderEnabled(enabled: boolean): void {
		if (this.renderEnabled === enabled) return;
		this.renderEnabled = enabled;
		this.root.setEnabled(enabled);
		if (!enabled) return;
		this.root.position.x = this.target.x;
		this.root.position.z = this.target.z;
		this.root.rotation.y = this.target.rotationY + MONSTER_MODEL_YAW_OFFSET;
		this.groundHeightAccumulatorS = MONSTER_GROUND_HEIGHT_INTERVAL_S;
		this.animationSampleAccumulatorS = MONSTER_ANIMATION_INTERVAL_S;
		this.cameraOcclusionAccumulatorS = MONSTER_CAMERA_OCCLUSION_INTERVAL_S;
	}

	getTarget(): Readonly<typeof this.target> {
		return this.target;
	}

	setAnimationState(animationState: MonsterAnimState, startedAtS: number) {
		if (this.deathStarted) return;
		if (
			animationState === this.animationState &&
			startedAtS === this.animationStartedAtS
		)
			return;
		const stateChanged = animationState !== this.animationState;
		this.animationState = animationState;
		this.animationStartedAtS = Number.isFinite(startedAtS) ? startedAtS : 0;
		if (stateChanged) this.animationStateAgeS = 0;
	}

	setHitboxVisible(visible: boolean) {
		this.hitboxesVisible = visible;
		if (this.hitboxMeshes.length === 0 && visible) {
			this.hitboxParts.forEach((part, index) => {
				const name = `${this.root.name}_hitbox_${index}`;
				const mesh =
					part.shape === 'sphere'
						? BABYLON.MeshBuilder.CreateSphere(
								name,
								{ diameter: part.radius * 2, segments: 16 },
								this.root.getScene(),
							)
						: BABYLON.MeshBuilder.CreateCylinder(
								name,
								{
									diameter: part.radius * 2,
									height: part.height,
									tessellation: 24,
								},
								this.root.getScene(),
							);
				configureDebugMesh(
					mesh,
					this.hitboxMaterial,
					MONSTER_HITBOX_RENDERING_GROUP,
				);
				this.hitboxMeshes.push(mesh);
			});
			this.updateHitboxPosition(0, 0, true);
		}
		this.hitboxMeshes.forEach((mesh) => {
			mesh.isVisible = visible;
		});
	}

	private updateHitboxPosition(
		deltaTime: number,
		combatTimeS: number,
		force = false,
	) {
		if (!this.hitboxesVisible || this.hitboxMeshes.length === 0) return;
		if (!force) {
			this.hitboxUpdateAccumulatorS += Math.min(
				Math.max(0, deltaTime),
				0.25,
			);
			if (
				this.hitboxUpdateAccumulatorS + Number.EPSILON <
				MONSTER_ANIMATION_INTERVAL_S
			)
				return;
			this.hitboxUpdateAccumulatorS %= MONSTER_ANIMATION_INTERVAL_S;
		}
		const posedParts = getMonsterCompoundHitboxes(
			this.kind,
			this.isBoss,
			this.animationState,
			this.animationTimeS(combatTimeS),
			this.posedHitboxParts,
			this.modelSizeMultiplier,
		);
		const angle = this.root.rotation.y + Math.PI;
		const sin = Math.sin(angle);
		const cos = Math.cos(angle);
		this.hitboxMeshes.forEach((mesh, index) => {
			const part = posedParts[index];
			mesh.position.set(
				this.root.position.x + part.offsetX * cos + part.offsetZ * sin,
				this.root.position.y + part.offsetY,
				this.root.position.z + part.offsetZ * cos - part.offsetX * sin,
			);
		});
	}

	flashDamage() {
		if (this.deathStarted) return;
		this.damageFlashRemainingS = MONSTER_DAMAGE_FLASH_DURATION_S;
		for (const mesh of this.getMeshes()) {
			if (!this.damageFlashOriginalMaterials.has(mesh))
				this.damageFlashOriginalMaterials.set(mesh, mesh.material);
			mesh.material = this.damageFlashMaterial;
		}
	}

	private updateDamageFlash(deltaTime: number) {
		if (this.damageFlashRemainingS <= 0) return;
		this.damageFlashRemainingS = Math.max(
			0,
			this.damageFlashRemainingS - Math.max(0, deltaTime),
		);
		if (this.damageFlashRemainingS <= 0) {
			this.clearDamageFlash();
		}
	}

	private clearDamageFlash(): void {
		this.damageFlashRemainingS = 0;
		for (const [mesh, material] of this.damageFlashOriginalMaterials) {
			if (!mesh.isDisposed()) mesh.material = material;
		}
		this.damageFlashOriginalMaterials.clear();
	}

	startDeath(): number {
		if (this.deathStarted) return this.deathDurationS;
		this.deathStarted = true;
		this.deathElapsedS = 0;
		const group = this.animations.get('death');
		this.deathDurationS = group ? animationDurationS(group) : 0;
		this.animationStateAgeS = 0;
		this.animationSampleAccumulatorS = 0;
		if (group) this.play('death', false, 0);
		return this.deathDurationS;
	}

	isDeathComplete(): boolean {
		return (
			this.deathStarted &&
			this.deathElapsedS + Number.EPSILON >= this.deathDurationS
		);
	}

	private ensureHeadAnchor(): BABYLON.TransformNode {
		if (this.headAnchor) return this.headAnchor;
		this.measureBody();
		const scaleY = this.root.scaling.y || 1;
		this.headAnchor = new BABYLON.TransformNode(
			`${this.root.name}_headAnchor`,
			this.root.getScene(),
		);
		this.headAnchor.parent = this.root;
		this.headAnchor.position.y = this.bodyMaxY / scaleY;
		return this.headAnchor;
	}

	getHeadWorldPositionToRef(result: BABYLON.Vector3): void {
		result.copyFrom(this.ensureHeadAnchor().getAbsolutePosition());
	}

	getPosition(): BABYLON.Vector3 {
		return this.root.position;
	}

	play(
		animation: MonsterPresentationAnimation,
		loop: boolean = true,
		animationTimeS?: number,
	) {
		const group = this.animations.get(animation);
		if (!group) return;
		if (this.currentAnimation === animation) {
			if (animationTimeS !== undefined)
				this.sampleAnimation(animation, animationTimeS, loop);
			return;
		}
		this.animations.get(this.currentAnimation ?? '')?.stop(true);
		applyStaticAnimationPose(this.staticAnimationPoses.get(animation));
		this.sampleAnimation(animation, animationTimeS ?? 0, loop);
		this.currentAnimation = animation;
	}

	private sampleAnimation(
		animation: MonsterPresentationAnimation,
		timeS: number,
		loop = true,
	): void {
		const group = this.animations.get(animation);
		if (!group) return;
		if (!group.isStarted) {
			group.play(loop);
			group.pause();
		}
		this.seek(group, timeS, loop);
	}

	private updateAnimation(deltaTime: number, combatTimeS: number) {
		if (this.deathStarted) {
			this.advanceDeath(deltaTime, true);
			return;
		}
		this.animationStateAgeS += Math.max(0, deltaTime);
		this.animationSampleAccumulatorS += Math.min(
			Math.max(0, deltaTime),
			0.25,
		);
		const transitionDelay = animationTransitionDelay(
			this.currentAnimation,
			this.animationState,
		);
		if (
			this.currentAnimation !== this.animationState &&
			this.animationStateAgeS + Number.EPSILON >= transitionDelay
		) {
			this.play(
				this.animationState,
				true,
				this.animationTimeS(combatTimeS),
			);
			this.animationSampleAccumulatorS = 0;
			return;
		}
		if (
			!this.currentAnimation ||
			this.animationSampleAccumulatorS + Number.EPSILON <
				MONSTER_ANIMATION_INTERVAL_S
		)
			return;
		this.animationSampleAccumulatorS %= MONSTER_ANIMATION_INTERVAL_S;
		this.sampleAnimation(
			this.currentAnimation,
			this.animationTimeS(combatTimeS),
		);
	}

	private animationTimeS(combatTimeS: number): number {
		return Math.max(0, combatTimeS - this.animationStartedAtS);
	}

	private seek(
		group: BABYLON.AnimationGroup,
		timeS: number,
		loop = true,
	): void {
		const targeted = group.targetedAnimations[0];
		if (!targeted) return;
		group.goToFrame(
			!loop
				? Math.min(
						group.to,
						group.from +
							Math.max(0, timeS) *
								targeted.animation.framePerSecond,
					)
				: loopedAnimationFrame(
						group.from,
						group.to,
						targeted.animation.framePerSecond,
						timeS,
					),
		);
	}

	private advanceDeath(deltaTime: number, sample: boolean): void {
		if (!this.deathStarted) return;
		this.deathElapsedS = Math.min(
			this.deathDurationS,
			this.deathElapsedS + Math.max(0, deltaTime),
		);
		if (sample && this.animations.has('death'))
			this.sampleAnimation('death', this.deathElapsedS, false);
	}

	update(
		deltaTime: number,
		camera: BABYLON.Camera | null,
		animationTimeS: number,
	) {
		if (!this.renderEnabled) {
			this.updateOffscreen(deltaTime);
			return;
		}
		const lerpFactor = Math.min(1, deltaTime * MONSTER_POSITION_LERP_SPEED);
		const position = this.root.position;
		position.x = BABYLON.Scalar.Lerp(position.x, this.target.x, lerpFactor);
		position.z = BABYLON.Scalar.Lerp(position.z, this.target.z, lerpFactor);
		position.y = BABYLON.Scalar.Lerp(
			position.y,
			this.groundHeight,
			Math.min(1, deltaTime * MONSTER_GROUND_LERP_SPEED),
		);
		this.root.rotation.y = BABYLON.Scalar.LerpAngle(
			this.root.rotation.y,
			this.target.rotationY + MONSTER_MODEL_YAW_OFFSET,
			lerpFactor,
		);
		this.updateDamageFlash(deltaTime);
		this.updateAnimation(deltaTime, animationTimeS);
		this.updateHitboxPosition(deltaTime, animationTimeS);
		if (camera) {
			this.cameraOcclusionAccumulatorS += Math.min(
				Math.max(0, deltaTime),
				0.25,
			);
			if (
				this.cameraOcclusionAccumulatorS + Number.EPSILON >=
				MONSTER_CAMERA_OCCLUSION_INTERVAL_S
			) {
				this.cameraOcclusionAccumulatorS %=
					MONSTER_CAMERA_OCCLUSION_INTERVAL_S;
				this.updateCameraOcclusion(camera.globalPosition);
			}
		}
	}

	updateOffscreen(deltaTime: number): void {
		this.animationStateAgeS += Math.max(0, deltaTime);
		if (this.damageFlashRemainingS > 0) {
			this.damageFlashRemainingS = Math.max(
				0,
				this.damageFlashRemainingS - Math.max(0, deltaTime),
			);
			if (this.damageFlashRemainingS <= 0) this.clearDamageFlash();
		}
		this.advanceDeath(deltaTime, false);
	}

	dispose() {
		this.clearDamageFlash();
		this.headAnchor?.dispose();
		this.hitboxMeshes.forEach((mesh) => mesh.dispose());
		this.hitboxMeshes.length = 0;
		this.animations.forEach((group) => group.dispose());
		this.animations.clear();
		this.staticAnimationPoses.clear();
		this.root.dispose();
	}
}
