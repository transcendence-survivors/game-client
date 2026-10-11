import * as BABYLON from '@babylonjs/core';
import type { WeaponKind } from '@transcendence/game-shared';
import { models } from '../assets/models';
import { IDENTITY, type Transform, type Vector } from '../assets/Transform';

const SWORD_SWEEP_ANGLE = Math.PI * 0.42;
const GLTF_Z_FLIP: Vector = [1, 1, -1];
const { EASINGMODE_EASEINOUT, EASINGMODE_EASEOUT } = BABYLON.EasingFunction;

interface WeaponModelSource {
	url: string;
	modelCorrection: Transform;
}

export interface AttackAnimationConfig {
	property: 'position' | 'rotation';
	axis: 'x' | 'y' | 'z';
	frames: readonly number[];
	values: readonly number[];
	easing: number;
}

export interface HeldWeaponVisual extends WeaponModelSource {
	handPlacement: Transform;
	attackAnimation: AttackAnimationConfig;
}

export interface ProjectileVisual extends WeaponModelSource {
	spinSpeed: number;
}

export interface WeaponVisual {
	held?: HeldWeaponVisual;
	projectile?: ProjectileVisual;
}

export const WEAPON_VISUALS: Record<WeaponKind, WeaponVisual> = {
	aura: {},
	sword: {
		held: {
			url: models.sword,
			modelCorrection: {
				position: [0, 0, 0.38],
				rotation: [Math.PI / 2, 0, 0],
				scale: GLTF_Z_FLIP,
			},
			handPlacement: {
				position: [0, 1.05, 0.9],
				rotation: [0, -Math.PI * 0.42, 0],
				scale: 1.875,
			},
			attackAnimation: {
				property: 'rotation',
				axis: 'y',
				frames: [0, 10, 20],
				values: [-SWORD_SWEEP_ANGLE, 0, SWORD_SWEEP_ANGLE],
				easing: EASINGMODE_EASEINOUT,
			},
		},
	},
	axe: {
		projectile: {
			url: models.axe,
			modelCorrection: {
				position: [0, 0, 0],
				rotation: [Math.PI / 2, 0, 0],
				scale: 2,
			},
			spinSpeed: 12,
		},
	},
	staff: {
		held: {
			url: models.staff,
			modelCorrection: IDENTITY,
			handPlacement: {
				position: [-0.55, 0.95, 0.15],
				rotation: [0, 0, Math.PI / 14],
				scale: 0.65,
			},
			attackAnimation: {
				property: 'rotation',
				axis: 'x',
				frames: [0, 7, 16],
				values: [0, -Math.PI / 5, 0],
				easing: EASINGMODE_EASEINOUT,
			},
		},
		projectile: {
			url: models.fireball,
			modelCorrection: IDENTITY,
			spinSpeed: 0,
		},
	},
	bow: {
		held: {
			url: models.bow,
			modelCorrection: {
				position: [0, 0, 0],
				rotation: [-Math.PI / 2, 0, Math.PI / 2],
				scale: GLTF_Z_FLIP,
			},
			handPlacement: {
				position: [0, 1.05, 0.95],
				rotation: [0, 0, 0],
				scale: 1,
			},
			attackAnimation: {
				property: 'position',
				axis: 'z',
				frames: [0, 4, 11],
				values: [0.95, 0.72, 0.95],
				easing: EASINGMODE_EASEOUT,
			},
		},
		projectile: {
			url: models.arrow,
			modelCorrection: {
				position: [0, 0, 0],
				rotation: [Math.PI / 2, 0, 0],
				scale: 0.82,
			},
			spinSpeed: 0,
		},
	},
};
