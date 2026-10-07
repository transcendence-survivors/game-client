import {
	Mesh,
	Vector3,
	VertexData,
	type Scene,
	type StandardMaterial,
} from '@babylonjs/core';
import {
	TERRAIN_SUBDIVISIONS_PER_CELL,
	type World,
	type WorldSurfaceSample,
} from '@transcendence/game-shared';
import { GROUND_TEXTURE_WORLD_SIZE } from './ProceduralGroundTexture';

const NATURE_VISIBILITY_HEADROOM = new Vector3(0, 24, 0);
const gridIndices = new Map<number, Uint16Array>();

function indicesFor(segments: number): Uint16Array {
	let indices = gridIndices.get(segments);
	if (indices) return indices;
	const row = segments + 1;
	indices = new Uint16Array(segments * segments * 6);
	let offset = 0;
	for (let j = 0; j < segments; j++)
		for (let i = 0; i < segments; i++) {
			const a = j * row + i;
			indices.set(
				[a, a + row, a + 1, a + 1, a + row, a + row + 1],
				offset,
			);
			offset += 6;
		}
	gridIndices.set(segments, indices);
	return indices;
}

export function createTerrainChunk(
	scene: Scene,
	world: World,
	chunkX: number,
	chunkZ: number,
	material: StandardMaterial,
): Mesh {
	const segments = world.N * TERRAIN_SUBDIVISIONS_PER_CELL;
	const row = segments + 1;
	const spacing = world.CELL / TERRAIN_SUBDIVISIONS_PER_CELL;
	const originX = chunkX * world.CHUNK_SIZE;
	const originZ = chunkZ * world.CHUNK_SIZE;
	const textureOffset = GROUND_TEXTURE_WORLD_SIZE * 0.5;
	const positions = new Float32Array(row * row * 3);
	const normals = new Float32Array(row * row * 3);
	const uvs = new Float32Array(row * row * 2);
	const sample: WorldSurfaceSample = { height: 0, x: 0, y: 1, z: 0 };
	for (let j = 0; j <= segments; j++)
		for (let i = 0; i <= segments; i++) {
			const index = j * row + i;
			const x = i * spacing;
			const z = j * spacing;
			world.sampleSurfaceToRef(originX + x, originZ + z, sample);
			positions.set([x, sample.height, z], index * 3);
			normals.set([sample.x, sample.y, sample.z], index * 3);
			uvs[index * 2] =
				(originX + x + textureOffset) / GROUND_TEXTURE_WORLD_SIZE;
			uvs[index * 2 + 1] =
				(originZ + z + textureOffset) / GROUND_TEXTURE_WORLD_SIZE;
		}

	const mesh = new Mesh(`chunk_${chunkX}_${chunkZ}`, scene);
	Object.assign(new VertexData(), {
		positions,
		normals,
		uvs,
		indices: indicesFor(segments),
	}).applyToMesh(mesh);
	const bounds = mesh.getBoundingInfo();
	bounds.reConstruct(
		bounds.minimum,
		bounds.maximum.add(NATURE_VISIBILITY_HEADROOM),
	);
	mesh.sideOrientation = Mesh.FRONTSIDE;
	mesh.position.set(originX, 0, originZ);
	mesh.material = material;
	mesh.isPickable = false;
	mesh.freezeWorldMatrix();
	return mesh;
}
