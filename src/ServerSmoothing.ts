import type { Vector3 } from '@babylonjs/core';

export function smoothingFactor(speedPerS: number, deltaS: number): number {
	return Math.min(1, speedPerS * deltaS);
}

export function smoothTowards(
	position: Vector3,
	x: number,
	y: number,
	z: number,
	factor: number,
): void {
	position.x += (x - position.x) * factor;
	position.y += (y - position.y) * factor;
	position.z += (z - position.z) * factor;
}
