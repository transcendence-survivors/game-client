import type { TransformNode } from '@babylonjs/core';

export type Vector = readonly [number, number, number];

export interface Transform {
	position: Vector;
	rotation: Vector;
	scale: number | Vector;
}

export const IDENTITY: Transform = {
	position: [0, 0, 0],
	rotation: [0, 0, 0],
	scale: 1,
};

export function applyTransform(
	node: TransformNode,
	{ position, rotation, scale }: Transform = IDENTITY,
): void {
	node.rotationQuaternion = null;
	node.position.set(...position);
	node.rotation.set(...rotation);
	if (typeof scale === 'number') node.scaling.setAll(scale);
	else node.scaling.set(...scale);
}
