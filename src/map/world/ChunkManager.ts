import type { Mesh, Scene, StandardMaterial } from '@babylonjs/core';
import { CHUNK_DISPLAY_RADIUS, type World } from '@transcendence/game-shared';
import { createTerrainChunk } from './TerrainChunk';

export interface ChunkAttachment {
	setVisible(visible: boolean): void;
	dispose(): void;
}

export type ChunkAttachmentFactory = (x: number, z: number) => ChunkAttachment;

interface LoadedChunk {
	readonly x: number;
	readonly z: number;
	readonly mesh: Mesh;
	visible: boolean;
	readonly attachment: ChunkAttachment;
}

const MAX_CHUNKS_CREATED_PER_UPDATE = 2;
const LOAD_RADIUS_CHUNKS = 3;

const chunkKey = (x: number, z: number) => `${x},${z}`;

export class ChunkManager {
	private readonly scene: Scene;
	private readonly world: World;
	private readonly material: StandardMaterial;
	private readonly offsets: readonly (readonly [number, number])[];
	private readonly chunks = new Map<string, LoadedChunk>();
	private readonly createAttachment: ChunkAttachmentFactory;
	private loadedCenter: string | null = null;

	constructor(
		scene: Scene,
		world: World,
		material: StandardMaterial,
		createAttachment: ChunkAttachmentFactory,
	) {
		this.scene = scene;
		this.world = world;
		this.material = material;
		this.createAttachment = createAttachment;
		const range = Array.from(
			{ length: LOAD_RADIUS_CHUNKS * 2 + 1 },
			(_, i) => i - LOAD_RADIUS_CHUNKS,
		);
		this.offsets = range
			.flatMap((dz) => range.map((dx) => [dx, dz] as const))
			.sort(
				([ax, az], [bx, bz]) => ax * ax + az * az - bx * bx - bz * bz,
			);
	}

	update(centerX: number, centerZ: number): void {
		const cx = Math.floor(centerX / this.world.CHUNK_SIZE);
		const cz = Math.floor(centerZ / this.world.CHUNK_SIZE);
		if (this.loadedCenter !== chunkKey(cx, cz)) this.loadAround(cx, cz);
		const planes = this.scene.frustumPlanes;
		if (!planes) return;
		for (const chunk of this.chunks.values()) {
			const visible =
				this.intersectsDisplayCircle(chunk, centerX, centerZ) &&
				chunk.mesh.isInFrustum(planes);
			if (chunk.visible === visible) continue;
			chunk.visible = visible;
			chunk.mesh.setEnabled(visible);
			chunk.attachment.setVisible(visible);
		}
	}

	private loadAround(cx: number, cz: number): void {
		this.loadedCenter = null;
		for (const [key, chunk] of this.chunks)
			if (
				Math.abs(chunk.x - cx) > LOAD_RADIUS_CHUNKS + 1 ||
				Math.abs(chunk.z - cz) > LOAD_RADIUS_CHUNKS + 1
			)
				this.disposeChunk(key, chunk);

		let created = 0;
		for (const [dx, dz] of this.offsets) {
			const x = cx + dx;
			const z = cz + dz;
			const key = chunkKey(x, z);
			if (this.chunks.has(key)) continue;
			const mesh = createTerrainChunk(
				this.scene,
				this.world,
				x,
				z,
				this.material,
			);
			mesh.setEnabled(false);
			this.chunks.set(key, {
				x,
				z,
				mesh,
				visible: false,
				attachment: this.createAttachment(x, z),
			});
			if (++created >= MAX_CHUNKS_CREATED_PER_UPDATE) return;
		}
		this.loadedCenter = chunkKey(cx, cz);
	}

	dispose(): void {
		for (const [key, chunk] of this.chunks) this.disposeChunk(key, chunk);
	}

	private disposeChunk(key: string, chunk: LoadedChunk): void {
		chunk.mesh.dispose();
		this.chunks.delete(key);
		chunk.attachment.dispose();
	}

	private intersectsDisplayCircle(
		chunk: LoadedChunk,
		centerX: number,
		centerZ: number,
	): boolean {
		const minX = chunk.x * this.world.CHUNK_SIZE;
		const minZ = chunk.z * this.world.CHUNK_SIZE;
		const dx =
			Math.max(minX, Math.min(centerX, minX + this.world.CHUNK_SIZE)) -
			centerX;
		const dz =
			Math.max(minZ, Math.min(centerZ, minZ + this.world.CHUNK_SIZE)) -
			centerZ;
		return dx * dx + dz * dz <= CHUNK_DISPLAY_RADIUS * CHUNK_DISPLAY_RADIUS;
	}
}
