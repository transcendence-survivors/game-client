import { Frustum, Plane } from '@babylonjs/core';
import type { Camera, Scene, StandardMaterial, Vector3 } from '@babylonjs/core';
import type { Vec2d, World } from '@transcendence/game-shared';
import { TerrainChunk } from './TerrainChunk';
import { WorldGenerationClient } from './WorldGenerationClient';
import type { TerrainSurfaceData } from './TerrainSurface';

interface LoadedChunk extends Vec2d {
	chunk: TerrainChunk;
}

interface PendingBuild extends Readonly<Vec2d> {
	readonly key: string;
	readonly generation: number;
}

interface ReadyChunk extends Readonly<Vec2d> {
	readonly key: string;
	readonly generation: number;
	readonly surface: TerrainSurfaceData;
}

const MAX_TERRAIN_GENERATIONS_IN_FLIGHT = 2;
const MAX_TERRAIN_PUBLICATIONS_PER_TASK = 1;
const TERRAIN_PUBLICATION_BUDGET_MS = 3;

export class ChunkManager {
	private readonly scene: Scene;
	private readonly world: World;
	private readonly mat: StandardMaterial;
	private readonly size: number;
	private readonly view: number;
	private readonly displayRadiusSquared: number;
	private readonly chunks = new Map<string, LoadedChunk>();
	private readonly pendingBuilds = new Map<string, PendingBuild>();
	private readonly readyChunks: ReadyChunk[] = [];
	private readyChunkHead = 0;
	private readonly generation: WorldGenerationClient;
	private readonly ownsGeneration: boolean;
	private readonly now: () => number;
	private queue: Array<[number, number, string]> = [];
	private queueIndex = 0;
	private queueGeneration = 0;
	private activeGenerations = 0;
	private publishScheduled = false;
	private readonly frustumPlanes: Plane[] = Array.from(
		{ length: 6 },
		() => new Plane(0, 0, 0, 0),
	);
	private readonly lastViewProjection = new Array<number>(16).fill(
		Number.NaN,
	);
	private lastVisibilityCamera: Camera | null = null;
	private lastVisibilityCenterX = Number.NaN;
	private lastVisibilityCenterZ = Number.NaN;
	private visibilityDirty = true;
	private lastCx = Number.NaN;
	private lastCz = Number.NaN;
	private disposed = false;

	constructor(
		scene: Scene,
		world: World,
		mat: StandardMaterial,
		viewDistance: number,
		now: () => number = performance.now.bind(performance),
		generation?: WorldGenerationClient,
		displayRadius = Number.POSITIVE_INFINITY,
	) {
		this.scene = scene;
		this.world = world;
		this.mat = mat;
		this.size = world.N * world.CELL;
		this.view = viewDistance;
		const safeDisplayRadius = Math.max(0, displayRadius);
		this.displayRadiusSquared = safeDisplayRadius * safeDisplayRadius;
		this.now = now;
		this.generation = generation ?? new WorldGenerationClient();
		this.ownsGeneration = !generation;
	}

	update(p: Vector3): void {
		if (this.disposed) return;
		const cx = Math.floor(p.x / this.size);
		const cz = Math.floor(p.z / this.size);
		const cellChanged = cx !== this.lastCx || cz !== this.lastCz;
		if (cellChanged) {
			this.lastCx = cx;
			this.lastCz = cz;
			this.queueGeneration++;
			this.queue.length = 0;
			this.queueIndex = 0;
			for (let dz = -this.view; dz <= this.view; dz++)
				for (let dx = -this.view; dx <= this.view; dx++) {
					const x = cx + dx;
					const z = cz + dz;
					const key = `${x},${z}`;
					if (this.chunks.has(key) || this.pendingBuilds.has(key))
						continue;
					this.queue.push([x, z, key]);
				}
			this.queue.sort(
				(a, b) =>
					(a[0] - cx) ** 2 +
					(a[1] - cz) ** 2 -
					((b[0] - cx) ** 2 + (b[1] - cz) ** 2),
			);
			for (const [key, loaded] of this.chunks) {
				if (
					Math.abs(loaded.x - cx) > this.view + 1 ||
					Math.abs(loaded.z - cz) > this.view + 1
				) {
					loaded.chunk.dispose();
					this.chunks.delete(key);
				}
			}
		}

		if (
			!cellChanged &&
			this.queueIndex >= this.queue.length &&
			this.activeGenerations === 0 &&
			this.readyChunkHead >= this.readyChunks.length
		) {
			this.updateVisibility(p.x, p.z);
			return;
		}
		this.startQueuedGenerations();
		this.schedulePublication();
		this.updateVisibility(p.x, p.z);
	}

	clear(): void {
		this.queueGeneration++;
		for (const loaded of this.chunks.values()) loaded.chunk.dispose();
		this.chunks.clear();
		this.pendingBuilds.clear();
		for (
			let index = this.readyChunkHead;
			index < this.readyChunks.length;
			index++
		)
			this.readyChunks[index]!.surface.release?.();
		this.readyChunks.length = 0;
		this.readyChunkHead = 0;
		this.queue.length = 0;
		this.queueIndex = 0;
		this.visibilityDirty = true;
		this.lastCx = Number.NaN;
		this.lastCz = Number.NaN;
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.clear();
		if (this.ownsGeneration) this.generation.dispose();
	}

	private startQueuedGenerations(): void {
		while (
			this.activeGenerations < MAX_TERRAIN_GENERATIONS_IN_FLIGHT &&
			this.queueIndex < this.queue.length
		) {
			const next = this.queue[this.queueIndex++]!;
			const [x, z, key] = next;
			if (this.chunks.has(key) || this.pendingBuilds.has(key)) continue;
			const pending: PendingBuild = {
				key,
				x,
				z,
				generation: this.queueGeneration,
			};
			this.pendingBuilds.set(key, pending);
			this.activeGenerations++;
			try {
				void this.generation.generateTerrain(this.world, x, z).then(
					(surface) => this.onGenerationReady(pending, surface),
					() => this.onGenerationFailed(pending),
				);
			} catch {
				this.onGenerationFailed(pending);
			}
		}
		if (this.queueIndex === this.queue.length) {
			this.queue.length = 0;
			this.queueIndex = 0;
		}
	}

	private onGenerationReady(
		pending: PendingBuild,
		surface: TerrainSurfaceData,
	): void {
		this.activeGenerations = Math.max(0, this.activeGenerations - 1);
		if (this.pendingBuilds.get(pending.key) !== pending) {
			surface.release?.();
			return;
		}
		this.pendingBuilds.delete(pending.key);
		if (!this.disposed && this.isWithinView(pending.x, pending.z))
			this.readyChunks.push({
				key: pending.key,
				x: pending.x,
				z: pending.z,
				generation: pending.generation,
				surface,
			});
		else surface.release?.();
		this.startQueuedGenerations();
		this.schedulePublication();
	}

	private onGenerationFailed(pending: PendingBuild): void {
		this.activeGenerations = Math.max(0, this.activeGenerations - 1);
		if (this.pendingBuilds.get(pending.key) !== pending) return;
		this.pendingBuilds.delete(pending.key);
		if (this.disposed) return;
		this.startQueuedGenerations();
	}

	private isWithinView(x: number, z: number): boolean {
		return (
			Number.isFinite(this.lastCx) &&
			Math.abs(x - this.lastCx) <= this.view &&
			Math.abs(z - this.lastCz) <= this.view
		);
	}

	private schedulePublication(): void {
		if (
			this.publishScheduled ||
			this.disposed ||
			this.readyChunkHead >= this.readyChunks.length
		)
			return;
		this.publishScheduled = true;
		globalThis.setTimeout(() => {
			this.publishScheduled = false;
			this.publishReadyChunks();
		}, 0);
	}

	private publishReadyChunks(): void {
		if (this.disposed) return;
		const startedAt = this.now();
		let published = 0;
		while (
			published < MAX_TERRAIN_PUBLICATIONS_PER_TASK &&
			this.readyChunkHead < this.readyChunks.length
		) {
			if (this.now() - startedAt >= TERRAIN_PUBLICATION_BUDGET_MS) break;
			const ready = this.readyChunks[this.readyChunkHead++]!;
			if (
				ready.generation !== this.queueGeneration &&
				!this.isWithinView(ready.x, ready.z)
			) {
				ready.surface.release?.();
				continue;
			}
			if (
				this.chunks.has(ready.key) ||
				!this.isWithinView(ready.x, ready.z)
			) {
				ready.surface.release?.();
				continue;
			}
			let chunk: TerrainChunk;
			try {
				chunk = new TerrainChunk(
					this.scene,
					this.world,
					ready.x,
					ready.z,
					this.mat,
					ready.surface,
				);
			} finally {
				ready.surface.release?.();
			}
			this.chunks.set(ready.key, {
				x: ready.x,
				z: ready.z,
				chunk,
			});
			this.visibilityDirty = true;
			if (
				Number.isFinite(this.lastVisibilityCenterX) &&
				Number.isFinite(this.lastVisibilityCenterZ)
			)
				this.updateVisibility(
					this.lastVisibilityCenterX,
					this.lastVisibilityCenterZ,
				);
			published++;
		}
		if (this.readyChunkHead >= this.readyChunks.length) {
			this.readyChunks.length = 0;
			this.readyChunkHead = 0;
		}
		if (this.readyChunkHead < this.readyChunks.length)
			this.schedulePublication();
	}

	private updateVisibility(centerX: number, centerZ: number): void {
		const camera = this.scene.activeCamera;
		if (!camera) return;
		const transformation = camera.getTransformationMatrix();
		const viewProjection = transformation.m;
		let cameraChanged =
			this.visibilityDirty || this.lastVisibilityCamera !== camera;
		if (!cameraChanged)
			for (let index = 0; index < 16; index++)
				if (viewProjection[index] !== this.lastViewProjection[index]) {
					cameraChanged = true;
					break;
				}
		const centerChanged =
			centerX !== this.lastVisibilityCenterX ||
			centerZ !== this.lastVisibilityCenterZ;
		if (!cameraChanged && !centerChanged) return;

		if (cameraChanged)
			Frustum.GetPlanesToRef(transformation, this.frustumPlanes);
		for (const loaded of this.chunks.values()) {
			const visible =
				this.intersectsDisplayCircle(
					loaded.x,
					loaded.z,
					centerX,
					centerZ,
				) && loaded.chunk.mesh.isInFrustum(this.frustumPlanes);
			if (loaded.chunk.mesh.isEnabled() !== visible)
				loaded.chunk.mesh.setEnabled(visible);
		}

		this.lastVisibilityCamera = camera;
		this.lastVisibilityCenterX = centerX;
		this.lastVisibilityCenterZ = centerZ;
		for (let index = 0; index < 16; index++)
			this.lastViewProjection[index] = viewProjection[index]!;
		this.visibilityDirty = false;
	}

	private intersectsDisplayCircle(
		chunkX: number,
		chunkZ: number,
		centerX: number,
		centerZ: number,
	): boolean {
		const minX = chunkX * this.size;
		const maxX = minX + this.size;
		const minZ = chunkZ * this.size;
		const maxZ = minZ + this.size;
		const closestX =
			centerX < minX ? minX : centerX > maxX ? maxX : centerX;
		const closestZ =
			centerZ < minZ ? minZ : centerZ > maxZ ? maxZ : centerZ;
		const dx = closestX - centerX;
		const dz = closestZ - centerZ;
		return dx * dx + dz * dz <= this.displayRadiusSquared;
	}
}
