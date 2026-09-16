import {
	Mesh,
	VertexData,
	type Scene,
	type StandardMaterial,
} from '@babylonjs/core';
import {
	TERRAIN_SUBDIVISIONS_PER_CELL,
	type World,
} from '@transcendence/game-shared';
import { GROUND_TEXTURE_WORLD_SIZE } from './ProceduralGroundTexture';
import {
	generateTerrainSurface,
	terrainSurfaceSegments,
	type TerrainSurfaceData,
} from './TerrainSurface';

interface StaticTerrainGrid {
	readonly vertexCount: number;
	readonly localCoordinates: Float32Array;
	readonly indices: Uint16Array | Uint32Array;
}

const staticGridCache = new Map<string, StaticTerrainGrid>();

interface TerrainGeometryBuffers {
	readonly positions: Float32Array;
	readonly normals: Float32Array;
	readonly uvs: Float32Array;
}

const terrainGeometryPools = new Map<number, TerrainGeometryBuffers[]>();
const MAX_POOLED_TERRAIN_GEOMETRIES = 4;

function acquireTerrainGeometryBuffers(
	vertexCount: number,
): TerrainGeometryBuffers {
	const pooled = terrainGeometryPools.get(vertexCount)?.pop();
	if (pooled) return pooled;
	return {
		positions: new Float32Array(vertexCount * 3),
		normals: new Float32Array(vertexCount * 3),
		uvs: new Float32Array(vertexCount * 2),
	};
}

function releaseTerrainGeometryBuffers(
	vertexCount: number,
	buffers: TerrainGeometryBuffers,
): void {
	let pooled = terrainGeometryPools.get(vertexCount);
	if (!pooled) {
		pooled = [];
		terrainGeometryPools.set(vertexCount, pooled);
	}
	if (pooled.length < MAX_POOLED_TERRAIN_GEOMETRIES) pooled.push(buffers);
}

function getStaticTerrainGrid(
	segments: number,
	spacing: number,
): StaticTerrainGrid {
	const key = `${segments}:${spacing}`;
	const cached = staticGridCache.get(key);
	if (cached) return cached;

	const row = segments + 1;
	const vertexCount = row * row;
	const localCoordinates = new Float32Array(vertexCount * 2);
	for (let j = 0; j <= segments; j++)
		for (let i = 0; i <= segments; i++) {
			const index = (j * row + i) * 2;
			localCoordinates[index] = i * spacing;
			localCoordinates[index + 1] = j * spacing;
		}

	const indexCount = segments * segments * 6;
	const indices =
		vertexCount > 65_535
			? new Uint32Array(indexCount)
			: new Uint16Array(indexCount);
	let offset = 0;
	for (let j = 0; j < segments; j++)
		for (let i = 0; i < segments; i++) {
			const a = j * row + i;
			const b = a + 1;
			const d = a + row;
			const c = d + 1;
			indices[offset++] = a;
			indices[offset++] = d;
			indices[offset++] = b;
			indices[offset++] = b;
			indices[offset++] = d;
			indices[offset++] = c;
		}

	const grid = { vertexCount, localCoordinates, indices };
	staticGridCache.set(key, grid);
	return grid;
}

export function buildChunkMesh(
	scene: Scene,
	world: World,
	chunkX: number,
	chunkZ: number,
	mat: StandardMaterial,
	surfaceData: TerrainSurfaceData = generateTerrainSurface(
		world,
		chunkX,
		chunkZ,
	),
): Mesh {
	const cellSize = world.CELL;
	const segments = terrainSurfaceSegments(world);
	if (surfaceData.segments !== segments)
		throw new Error('Terrain surface resolution does not match the world');
	const spacing = cellSize / TERRAIN_SUBDIVISIONS_PER_CELL;
	const originX = chunkX * world.N * cellSize;
	const originZ = chunkZ * world.N * cellSize;
	const grid = getStaticTerrainGrid(segments, spacing);
	const buffers = acquireTerrainGeometryBuffers(grid.vertexCount);
	const { positions, normals, uvs } = buffers;
	let mesh: Mesh | null = null;
	let buffersReleased = false;
	const releaseBuffers = (): void => {
		if (buffersReleased) return;
		buffersReleased = true;
		releaseTerrainGeometryBuffers(grid.vertexCount, buffers);
	};
	try {
		const textureOffset = GROUND_TEXTURE_WORLD_SIZE * 0.5;
		for (let index = 0; index < grid.vertexCount; index++) {
			const localIndex = index * 2;
			const positionIndex = index * 3;
			const x = grid.localCoordinates[localIndex]!;
			const z = grid.localCoordinates[localIndex + 1]!;
			positions[positionIndex] = x;
			positions[positionIndex + 1] = surfaceData.heights[index]!;
			positions[positionIndex + 2] = z;
			normals[positionIndex] = surfaceData.normals[positionIndex]!;
			normals[positionIndex + 1] =
				surfaceData.normals[positionIndex + 1]!;
			normals[positionIndex + 2] =
				surfaceData.normals[positionIndex + 2]!;
			uvs[localIndex] =
				(originX + x + textureOffset) / GROUND_TEXTURE_WORLD_SIZE;
			uvs[localIndex + 1] =
				(originZ + z + textureOffset) / GROUND_TEXTURE_WORLD_SIZE;
		}

		mesh = new Mesh(`chunk_${chunkX}_${chunkZ}`, scene);
		const vd = new VertexData();
		vd.positions = positions;
		vd.indices = grid.indices;
		vd.normals = normals;
		vd.uvs = uvs;
		vd.applyToMesh(mesh);
		mesh.onDisposeObservable.addOnce(releaseBuffers);
		mesh.sideOrientation = Mesh.FRONTSIDE;
		mesh.position.set(originX, 0, originZ);
		mesh.material = mat;
		mesh.isPickable = false;
		mesh.freezeWorldMatrix();
		return mesh;
	} catch (error) {
		releaseBuffers();
		mesh?.dispose();
		throw error;
	}
}

export class TerrainChunk {
	readonly mesh: Mesh;

	constructor(
		scene: Scene,
		world: World,
		cx: number,
		cz: number,
		mat: StandardMaterial,
		surfaceData?: TerrainSurfaceData,
	) {
		this.mesh = buildChunkMesh(scene, world, cx, cz, mat, surfaceData);
	}

	dispose(): void {
		this.mesh.dispose();
	}
}
