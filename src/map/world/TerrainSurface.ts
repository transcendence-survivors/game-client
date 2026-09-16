import {
	TERRAIN_SUBDIVISIONS_PER_CELL,
	type World,
} from '@transcendence/game-shared';

export interface TerrainSurfaceData {
	readonly segments: number;
	readonly heights: Float32Array;
	readonly normals: Float32Array;
	readonly release?: () => void;
}

export function terrainSurfaceSegments(world: World): number {
	return world.N * TERRAIN_SUBDIVISIONS_PER_CELL;
}

export function generateTerrainSurface(
	world: World,
	chunkX: number,
	chunkZ: number,
): TerrainSurfaceData {
	const segments = terrainSurfaceSegments(world);
	const row = segments + 1;
	const vertexCount = row * row;
	const heights = new Float32Array(vertexCount);
	const normals = new Float32Array(vertexCount * 3);
	writeTerrainSurface(world, chunkX, chunkZ, heights, normals);
	return { segments, heights, normals };
}

export function writeTerrainSurface(
	world: World,
	chunkX: number,
	chunkZ: number,
	heights: Float32Array,
	normals: Float32Array,
): void {
	const segments = terrainSurfaceSegments(world);
	const row = segments + 1;
	const vertexCount = row * row;
	if (heights.length < vertexCount || normals.length < vertexCount * 3)
		throw new Error('Terrain surface output buffers are too small');

	const cellSize = world.CELL;
	const spacing = cellSize / TERRAIN_SUBDIVISIONS_PER_CELL;
	const originX = chunkX * world.N * cellSize;
	const originZ = chunkZ * world.N * cellSize;
	const sample = { height: 0, x: 0, y: 1, z: 0 };

	for (let j = 0; j <= segments; j++) {
		for (let i = 0; i <= segments; i++) {
			const index = j * row + i;
			world.sampleSurfaceToRef(
				originX + i * spacing,
				originZ + j * spacing,
				sample,
			);
			heights[index] = sample.height;
			const normalIndex = index * 3;
			normals[normalIndex] = sample.x;
			normals[normalIndex + 1] = sample.y;
			normals[normalIndex + 2] = sample.z;
		}
	}
}
