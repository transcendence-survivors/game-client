import type * as BABYLON from '@babylonjs/core';
import type { MonsterAnimState } from '@transcendence/game-shared';

/** Shared interpolation speed for every monster rendering backend. */
export const MONSTER_POSITION_LERP_SPEED = 10;

/** Shared terrain-height interpolation speed for every monster renderer. */
export const MONSTER_GROUND_LERP_SPEED = 20;

/** Shared duration of the visual damage flash. */
export const MONSTER_DAMAGE_FLASH_DURATION_S = 0.14;

/** Rotation needed to align imported monster models with gameplay headings. */
export const MONSTER_MODEL_YAW_OFFSET = Math.PI;

/** Terrain-height refresh cadence shared by monster rendering backends. */
export const MONSTER_GROUND_HEIGHT_INTERVAL_S = 1 / 20;

/** Static animation names supported by skeletal and baked renderers. */
export const MONSTER_PRESENTATION_ANIMATIONS = [
	'idle',
	'walk',
	'attack',
	'death',
] as const;

export type MonsterPresentationAnimation =
	(typeof MONSTER_PRESENTATION_ANIMATIONS)[number];

/** Animation state fields shared by monster presentation backends. */
export interface MonsterPresentationState {
	animationState: MonsterAnimState | 'death';
	animationStartedAtS: number;
}

export function animationFramesPerSecond(
	group: BABYLON.AnimationGroup,
): number {
	let framesPerSecond = 0;
	for (const targeted of group.targetedAnimations)
		framesPerSecond = Math.max(
			framesPerSecond,
			targeted.animation.framePerSecond,
		);
	return framesPerSecond;
}
