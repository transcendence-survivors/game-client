import { Frustum, Plane } from '@babylonjs/core';
import type { Mesh, Scene, StandardMaterial, Vector3 } from '@babylonjs/core';
import type { World } from '@transcendence/game-shared';
import { createTerrainChunk } from './TerrainChunk';

export interface ChunkVisibilityListener {
	onChunkVisibilityChanged(x: number, z: number, visible: boolean): void;
	onChunkDisposed(x: number, z: number): void;
}

interface LoadedChunk {
	readonly x: number;
	readonly z: number;
	readonly mesh: Mesh;
	visible: boolean;
}

const MAX_CHUNKS_CREATED_PER_UPDATE = 2;

export class ChunkManager {
	private readonly scene: Scene;
	private readonly world: World;
	private readonly material: StandardMaterial;
	private readonly view: number;
	private readonly offsets: readonly (readonly [number, number])[];
	private readonly size: number;
	private readonly displayRadius: number;
	private readonly chunks = new Map<string, LoadedChunk>();
	private readonly frustumPlanes = Array.from(
		{ length: 6 },
		() => new Plane(0, 0, 0, 0),
	);
	private listener: ChunkVisibilityListener | null = null;

	constructor(
		scene: Scene,
		world: World,
		material: StandardMaterial,
		view: number,
		displayRadius: number,
	) {
		this.scene = scene;
		this.world = world;
		this.material = material;
		this.view = view;
		const range = Array.from({ length: view * 2 + 1 }, (_, i) => i - view);
		this.offsets = range
			.flatMap((dz) => range.map((dx) => [dx, dz] as const))
			.sort(
				([ax, az], [bx, bz]) => ax * ax + az * az - bx * bx - bz * bz,
			);
		this.size = world.N * world.CELL;
		this.displayRadius = displayRadius;
	}

	setListener(listener: ChunkVisibilityListener | null): void {
		this.listener = listener;
		for (const chunk of this.chunks.values())
			if (chunk.visible)
				listener?.onChunkVisibilityChanged(chunk.x, chunk.z, true);
	}

	update(center: Vector3): void {
		const cx = Math.floor(center.x / this.size);
		const cz = Math.floor(center.z / this.size);
		for (const [key, chunk] of this.chunks)
			if (
				Math.abs(chunk.x - cx) > this.view + 1 ||
				Math.abs(chunk.z - cz) > this.view + 1
			)
				this.disposeChunk(key, chunk);

		let created = 0;
		for (const [dx, dz] of this.offsets) {
			const x = cx + dx;
			const z = cz + dz;
			if (this.chunks.has(`${x},${z}`)) continue;
			const mesh = createTerrainChunk(
				this.scene,
				this.world,
				x,
				z,
				this.material,
			);
			mesh.setEnabled(false);
			this.chunks.set(`${x},${z}`, { x, z, mesh, visible: false });
			if (++created >= MAX_CHUNKS_CREATED_PER_UPDATE) break;
		}

		const camera = this.scene.activeCamera;
		if (!camera) return;
		Frustum.GetPlanesToRef(
			camera.getTransformationMatrix(),
			this.frustumPlanes,
		);
		for (const chunk of this.chunks.values()) {
			const visible =
				this.intersectsDisplayCircle(chunk, center) &&
				chunk.mesh.isInFrustum(this.frustumPlanes);
			if (chunk.visible === visible) continue;
			chunk.visible = visible;
			chunk.mesh.setEnabled(visible);
			this.listener?.onChunkVisibilityChanged(chunk.x, chunk.z, visible);
		}
	}

	dispose(): void {
		for (const [key, chunk] of this.chunks) this.disposeChunk(key, chunk);
	}

	private disposeChunk(key: string, chunk: LoadedChunk): void {
		chunk.mesh.dispose();
		this.chunks.delete(key);
		this.listener?.onChunkDisposed(chunk.x, chunk.z);
	}

	private intersectsDisplayCircle(
		chunk: LoadedChunk,
		center: Vector3,
	): boolean {
		const minX = chunk.x * this.size;
		const minZ = chunk.z * this.size;
		const dx =
			Math.max(minX, Math.min(center.x, minX + this.size)) - center.x;
		const dz =
			Math.max(minZ, Math.min(center.z, minZ + this.size)) - center.z;
		return dx * dx + dz * dz <= this.displayRadius * this.displayRadius;
	}
}
