export interface PlanarCameraView {
	cameraX: number;
	cameraZ: number;
	forwardX: number;
	forwardZ: number;
	halfFovTangent: number;
}

export const MONSTER_RENDER_CULLING_CONFIG = {
	enabled: true,
	margin: 5,
	fovMarginRadians: 0.18,
	forceActiveMeshes: true,
} as const;

export function isMonsterInCameraEnvelope(
	x: number,
	z: number,
	camera: PlanarCameraView,
	margin: number,
): boolean {
	const dx = x - camera.cameraX;
	const dz = z - camera.cameraZ;
	const forwardDistance = dx * camera.forwardX + dz * camera.forwardZ;
	if (forwardDistance < -margin) return false;
	const sideDistance = Math.abs(dx * -camera.forwardZ + dz * camera.forwardX);
	const halfWidth = Math.max(
		margin,
		forwardDistance * camera.halfFovTangent + margin,
	);
	return sideDistance <= halfWidth;
}
