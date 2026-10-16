import {
	Mesh,
	Vector3,
	VertexData,
	type IndicesArray,
	type Scene,
	type StandardMaterial,
} from '@babylonjs/core';
import { createSurfaceSample, type World } from '@transcendence/game-shared';
import { GROUND_TEXTURE_WORLD_SIZE } from './TerrainMaterial';

const NATURE_VISIBILITY_HEADROOM = new Vector3(0, 24, 0);
let gridIndices: IndicesArray | null = null;

export function createTerrainChunk(
	scene: Scene,
	world: World,
	chunkX: number,
	chunkZ: number,
	material: StandardMaterial,
): Mesh {
	const segments = world.CHUNK_SIZE / world.SURFACE_STEP;
	const row = segments + 1;
	const spacing = world.SURFACE_STEP;
	const originX = chunkX * world.CHUNK_SIZE;
	const originZ = chunkZ * world.CHUNK_SIZE;
	const textureOffset = GROUND_TEXTURE_WORLD_SIZE * 0.5;
	const positions = new Float32Array(row * row * 3);
	const normals = new Float32Array(row * row * 3);
	const uvs = new Float32Array(row * row * 2);
	const sample = createSurfaceSample();
	for (let j = 0; j <= segments; j++)
		for (let i = 0; i <= segments; i++) {
			const index = (segments - j) * row + i;
			const x = i * spacing;
			const z = j * spacing;
			world.sampleSurfaceToRef(originX + x, originZ + z, sample);
			positions[index * 3] = x;
			positions[index * 3 + 1] = sample.height;
			positions[index * 3 + 2] = z;
			normals[index * 3] = sample.x;
			normals[index * 3 + 1] = sample.y;
			normals[index * 3 + 2] = sample.z;
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
		indices: (gridIndices ??= VertexData.CreateGround({
			subdivisions: segments,
		}).indices!),
	}).applyToMesh(mesh);
	const bounds = mesh.getBoundingInfo();
	bounds.reConstruct(
		bounds.minimum,
		bounds.maximum.add(NATURE_VISIBILITY_HEADROOM),
	);
	mesh.position.set(originX, 0, originZ);
	mesh.material = material;
	mesh.isPickable = false;
	mesh.freezeWorldMatrix();
	return mesh;
}
