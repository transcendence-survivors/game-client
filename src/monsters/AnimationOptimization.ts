import type * as BABYLON from '@babylonjs/core';
import type { Vec3d } from '@transcendence/game-shared';

type TransformProperty = 'position' | 'rotationQuaternion' | 'scaling';

interface TransformValue extends Vec3d {
	w?: number;
	clone?: () => unknown;
	copyFrom?: (value: unknown) => void;
}

export interface StaticTransform {
	target: Record<string, unknown>;
	property: TransformProperty;
	value: unknown;
}

export type StaticAnimationPose = readonly StaticTransform[];
export type StaticAnimationPoses = ReadonlyMap<
	BABYLON.AnimationGroup,
	StaticAnimationPose
>;

const EPSILON = 1e-6;
const TRANSFORM_PROPERTIES = new Set<TransformProperty>([
	'position',
	'rotationQuaternion',
	'scaling',
]);

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

function matches(a: unknown, b: unknown): boolean {
	if (typeof a === 'number' || typeof b === 'number')
		return (
			typeof a === 'number' &&
			typeof b === 'number' &&
			Math.abs(a - b) <= EPSILON
		);
	if (!a || !b || typeof a !== 'object' || typeof b !== 'object')
		return false;
	const left = a as TransformValue;
	const right = b as TransformValue;
	return (
		Math.abs(left.x - right.x) <= EPSILON &&
		Math.abs(left.y - right.y) <= EPSILON &&
		Math.abs(left.z - right.z) <= EPSILON &&
		(left.w === undefined && right.w === undefined
			? true
			: left.w !== undefined &&
				right.w !== undefined &&
				Math.abs(left.w - right.w) <= EPSILON)
	);
}

function constantValue(animation: BABYLON.Animation): unknown | undefined {
	const keys = animation.getKeys();
	if (!keys.length) return undefined;
	const value = keys[0].value;
	return keys.every((key) => matches(value, key.value)) ? value : undefined;
}

function cloneValue(value: unknown): unknown {
	return value && typeof value === 'object'
		? ((value as TransformValue).clone?.() ?? value)
		: value;
}

export function removeGloballyRedundantTransformAnimations(
	groups: readonly BABYLON.AnimationGroup[],
): number {
	const targets = new Map<
		object,
		Map<
			TransformProperty,
			{
				removable: Array<{
					group: BABYLON.AnimationGroup;
					animation: BABYLON.Animation;
				}>;
				required: boolean;
			}
		>
	>();
	for (const group of groups)
		for (const targeted of group.targetedAnimations) {
			const property = targeted.animation.targetProperty;
			if (!TRANSFORM_PROPERTIES.has(property as TransformProperty))
				continue;
			const transformProperty = property as TransformProperty;
			const target = targeted.target as Record<string, unknown>;
			let properties = targets.get(target);
			if (!properties) targets.set(target, (properties = new Map()));
			let usage = properties.get(transformProperty);
			if (!usage)
				properties.set(
					transformProperty,
					(usage = { removable: [], required: false }),
				);
			const value = constantValue(targeted.animation);
			if (
				value !== undefined &&
				matches(target[transformProperty], value)
			)
				usage.removable.push({
					group,
					animation: targeted.animation,
				});
			else usage.required = true;
		}

	let removed = 0;
	for (const properties of targets.values())
		for (const usage of properties.values()) {
			if (usage.required) continue;
			for (const { group, animation } of usage.removable) {
				group.removeTargetedAnimation(animation);
				removed++;
			}
		}
	return removed;
}

export function extractStaticAnimationPoses(
	groups: readonly BABYLON.AnimationGroup[],
): StaticAnimationPoses {
	const poses = new Map<BABYLON.AnimationGroup, StaticTransform[]>();
	for (const group of groups)
		for (const targeted of [...group.targetedAnimations]) {
			const property = targeted.animation.targetProperty;
			if (!TRANSFORM_PROPERTIES.has(property as TransformProperty))
				continue;
			const value = constantValue(targeted.animation);
			if (value === undefined) continue;
			let pose = poses.get(group);
			if (!pose) poses.set(group, (pose = []));
			pose.push({
				target: targeted.target as Record<string, unknown>,
				property: property as TransformProperty,
				value: cloneValue(value),
			});
			group.removeTargetedAnimation(targeted.animation);
		}
	return poses;
}

export function applyStaticAnimationPose(
	pose: readonly StaticTransform[] | undefined,
): void {
	if (!pose) return;
	for (const { target, property, value } of pose) {
		const current = target[property];
		if (current && typeof current === 'object') {
			const copyFrom = (current as TransformValue).copyFrom;
			if (copyFrom) {
				copyFrom.call(current, value);
				continue;
			}
		}
		target[property] = cloneValue(value);
	}
}
