import * as BABYLON from '@babylonjs/core';
import type { Vec2d, Vec3d, World } from '@transcendence/game-shared';
import type { MapGenerator } from '../MapGenerator';
import type { ModelAssetLibrary } from '../../assets/ModelAssetLibrary';
import { models } from '../../assets/models';
import {
	type ForestBiome,
	type ForestPlacement,
	type ForestPlacementBuffer,
	type ForestPlacementKind,
	readForestPlacement,
} from './ForestPlacement';
import type { WorldGenerationClient } from '../world/WorldGenerationClient';
import { FOREST_PLACEMENT_CAPACITY } from '../world/WorldGenerationProtocol';

interface LoadedForestChunk extends Vec2d {
	key: string;
	root: BABYLON.TransformNode;
	page: ForestRenderPage;
	visible: boolean;
}

interface PendingForestChunk extends LoadedForestChunk {
	token: object;
}

interface ChunkCandidate extends Vec2d {
	key: string;
	distance: number;
}

type SupportPoint = Vec3d;

interface SupportMetadata {
	readonly points: readonly SupportPoint[];
	readonly center: SupportPoint;
}

interface ThinInstanceBatch {
	readonly sourceMeshes: BABYLON.Mesh[];
	matrixData: Float32Array;
	visibleMatrixData: Float32Array;
	readonly instanceChunkKeys: string[];
	instanceCount: number;
	visibleInstanceCount: number;
	bufferInitialized: boolean;
	lastVisibilityVersion: number;
}

interface ForestRenderPage extends Vec2d {
	readonly key: string;
	readonly root: BABYLON.TransformNode;
	readonly chunks: Set<LoadedForestChunk>;
	readonly thinBatches: Map<string, ThinInstanceBatch>;
	visible: boolean;
}

const DEFAULT_VIEW_DISTANCE = 3;
const MAX_CHUNK_LOADS_PER_UPDATE = 1;
const FOREST_PAGE_CHUNK_SPAN = 4;
const FOREST_PAGE_RETENTION_MARGIN = 2;
const FOREST_PAGE_INITIAL_INSTANCE_CAPACITY =
	FOREST_PAGE_CHUNK_SPAN * FOREST_PAGE_CHUNK_SPAN * FOREST_PLACEMENT_CAPACITY;
const FOREST_PAGE_MIN_Y = -256;
const FOREST_PAGE_MAX_Y = 256;
const BASE_CLEARANCE = 0.005;
const SUPPORT_BAND_RATIO = 0.2;
const MIN_SUPPORT_BAND = 0.12;
const MAX_SUPPORT_BAND = 2;
const MAX_SUPPORT_POINTS = 32;
const CONTACT_EPSILON = 0.0001;
const FOREST_PUBLICATION_BUDGET_MS = 3;
const FOREST_PLACEMENTS_PER_PUBLICATION = 16;
const UNSUPPORTED_MODEL = 'model cannot be thin-instanced';
const PREFERRED_VARIANTS: Readonly<
	Record<ForestPlacementKind, Record<ForestBiome, readonly number[]>>
> = {
	tree: { meadow: [0, 1], forest: [3], rocky: [2] },
	rock: { meadow: [2, 3], forest: [0, 1], rocky: [0, 1] },
	bush: { meadow: [1], forest: [0], rocky: [0] },
	grass: { meadow: [0, 1], forest: [2, 3], rocky: [2, 3] },
	flower: { meadow: [1, 2, 4, 5], forest: [0, 3], rocky: [0, 3, 5] },
};

function capSupportPoints(
	points: readonly SupportPoint[],
	maxPoints = MAX_SUPPORT_POINTS,
): readonly SupportPoint[] {
	if (points.length <= maxPoints) return points;

	const selected: SupportPoint[] = [];
	const selectedIndices = new Set<number>();
	const add = (index: number): void => {
		if (
			index < 0 ||
			index >= points.length ||
			selected.length >= maxPoints ||
			selectedIndices.has(index)
		)
			return;
		selectedIndices.add(index);
		selected.push(points[index]!);
	};

	let minX = 0;
	let maxX = 0;
	let minZ = 0;
	let maxZ = 0;
	let minY = 0;
	for (let index = 1; index < points.length; index++) {
		const point = points[index]!;
		if (point.x < points[minX]!.x) minX = index;
		if (point.x > points[maxX]!.x) maxX = index;
		if (point.z < points[minZ]!.z) minZ = index;
		if (point.z > points[maxZ]!.z) maxZ = index;
		if (point.y < points[minY]!.y) minY = index;
	}
	add(minY);
	add(minX);
	add(maxX);
	add(minZ);
	add(maxZ);
	add(0);
	add(points.length - 1);

	const remaining = maxPoints - selected.length;
	for (let slot = 0; slot < remaining; slot++)
		add(Math.floor(((slot + 0.5) * points.length) / remaining));
	for (
		let index = 0;
		selected.length < maxPoints && index < points.length;
		index++
	)
		add(index);
	return selected;
}

export class ForestRenderer {
	private readonly scene: BABYLON.Scene;
	private readonly map: MapGenerator;
	private readonly assets: ModelAssetLibrary;
	private readonly world: World;
	private readonly generation: WorldGenerationClient;
	private readonly viewDistance: number;
	private readonly chunkSize: number;
	private readonly thinRoot: BABYLON.TransformNode;
	private readonly chunks = new Map<string, LoadedForestChunk>();
	private readonly pages = new Map<string, ForestRenderPage>();
	private readonly pending = new Map<string, PendingForestChunk>();
	private readonly queue: ChunkCandidate[] = [];
	private readonly failedModels = new Set<string>();
	private readonly supportMetadata = new Map<string, SupportMetadata>();
	private readonly frustumPlanes: BABYLON.Plane[] = Array.from(
		{ length: 6 },
		() => new BABYLON.Plane(0, 0, 0, 0),
	);
	private readonly placementNormal = BABYLON.Vector3.Zero();
	private readonly placementFittedNormal = BABYLON.Vector3.Zero();
	private readonly placementUp = BABYLON.Vector3.Zero();
	private readonly placementForward = BABYLON.Vector3.Zero();
	private readonly placementScaling = BABYLON.Vector3.One();
	private readonly placementTranslation = BABYLON.Vector3.Zero();
	private readonly placementTransformedCenter = BABYLON.Vector3.Zero();
	private readonly placementZero = BABYLON.Vector3.Zero();
	private readonly placementRotation = BABYLON.Quaternion.Identity();
	private readonly placementRotationAndScale = BABYLON.Matrix.Identity();
	private readonly placementMatrix = BABYLON.Matrix.Identity();
	private readonly placementSupportPoint = BABYLON.Vector3.Zero();
	private readonly placementSupportPoints: BABYLON.Vector3[] = [];
	private readonly packedPlacementScratch: ForestPlacement = {
		kind: 'tree',
		biome: 'meadow',
		x: 0,
		z: 0,
		y: 0,
		normalX: 0,
		normalY: 1,
		normalZ: 0,
		rotationY: 0,
		scale: 1,
		variant: 0,
	};
	private readonly placementSupportGroundHeights: number[] = [];
	private queueIndex = 0;
	private activeLoads = 0;
	private lastCx = Number.NaN;
	private lastCz = Number.NaN;
	private visibilityDirty = true;
	private lastVisibilityCamera: BABYLON.Camera | null = null;
	private readonly lastViewProjection = new Float64Array(16).fill(Number.NaN);
	private lastVisibilityZoneCenterX = Number.NaN;
	private lastVisibilityZoneCenterZ = Number.NaN;
	private visibilityVersion = 0;
	private disposed = false;

	constructor(
		scene: BABYLON.Scene,
		map: MapGenerator,
		assets: ModelAssetLibrary,
		viewDistance = DEFAULT_VIEW_DISTANCE,
	) {
		this.scene = scene;
		this.map = map;
		this.assets = assets;
		this.world = map.getWorld();
		this.generation = map.getGenerationClient();
		this.thinRoot = new BABYLON.TransformNode('forestThinInstances', scene);
		this.viewDistance = Math.max(1, Math.floor(viewDistance));
		this.chunkSize = this.world.N * this.world.CELL;
	}

	update(position: BABYLON.Vector3): void {
		if (this.disposed) return;
		const cx = Math.floor(position.x / this.chunkSize);
		const cz = Math.floor(position.z / this.chunkSize);
		if (cx !== this.lastCx || cz !== this.lastCz) {
			this.lastCx = cx;
			this.lastCz = cz;
			this.evictDistantPages(cx, cz);
			this.rebuildQueue(cx, cz);
		}
		this.startQueuedChunks();
		this.updateVisibility();
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.thinRoot.dispose();
		this.chunks.clear();
		this.pages.clear();
		this.pending.clear();
		this.queue.length = 0;
		this.queueIndex = 0;
		this.supportMetadata.clear();
	}

	private getOrCreatePage(chunkX: number, chunkZ: number): ForestRenderPage {
		const pageX = Math.floor(chunkX / FOREST_PAGE_CHUNK_SPAN);
		const pageZ = Math.floor(chunkZ / FOREST_PAGE_CHUNK_SPAN);
		const key = `${pageX},${pageZ}`;
		const existing = this.pages.get(key);
		if (existing) return existing;

		const page: ForestRenderPage = {
			key,
			x: pageX,
			z: pageZ,
			root: new BABYLON.TransformNode(`forestPage:${key}`, this.scene),
			chunks: new Set(),
			thinBatches: new Map(),
			visible: true,
		};
		page.root.parent = this.thinRoot;
		this.pages.set(key, page);
		this.visibilityDirty = true;
		return page;
	}

	private isChunkInView(
		chunk: LoadedForestChunk,
		centerX: number,
		centerZ: number,
		radiusSquared: number,
	): boolean {
		const minX = chunk.x * this.chunkSize;
		const maxX = (chunk.x + 1) * this.chunkSize;
		const minZ = chunk.z * this.chunkSize;
		const maxZ = (chunk.z + 1) * this.chunkSize;
		const dx = Math.max(minX - centerX, 0, centerX - maxX);
		const dz = Math.max(minZ - centerZ, 0, centerZ - maxZ);
		if (dx * dx + dz * dz > radiusSquared) return false;
		for (const { normal, d } of this.frustumPlanes) {
			const x = normal.x >= 0 ? maxX : minX;
			const y = normal.y >= 0 ? FOREST_PAGE_MAX_Y : FOREST_PAGE_MIN_Y;
			const z = normal.z >= 0 ? maxZ : minZ;
			if (normal.x * x + normal.y * y + normal.z * z + d < 0)
				return false;
		}
		return true;
	}

	private evictDistantPages(centerX: number, centerZ: number): void {
		const retention = this.viewDistance + FOREST_PAGE_RETENTION_MARGIN;
		let evictedPages = 0;
		for (const [pageKey, page] of this.pages) {
			const minChunkX = page.x * FOREST_PAGE_CHUNK_SPAN;
			const maxChunkX = minChunkX + FOREST_PAGE_CHUNK_SPAN - 1;
			const minChunkZ = page.z * FOREST_PAGE_CHUNK_SPAN;
			const maxChunkZ = minChunkZ + FOREST_PAGE_CHUNK_SPAN - 1;
			const distanceX =
				centerX < minChunkX
					? minChunkX - centerX
					: centerX > maxChunkX
						? centerX - maxChunkX
						: 0;
			const distanceZ =
				centerZ < minChunkZ
					? minChunkZ - centerZ
					: centerZ > maxChunkZ
						? centerZ - maxChunkZ
						: 0;
			if (Math.max(distanceX, distanceZ) <= retention) continue;

			for (const [chunkKey, chunk] of this.chunks) {
				if (chunk.page !== page) continue;
				chunk.root.dispose();
				page.chunks.delete(chunk);
				this.chunks.delete(chunkKey);
			}
			for (const [chunkKey, chunk] of this.pending) {
				if (chunk.page !== page) continue;
				chunk.root.dispose();
				this.pending.delete(chunkKey);
			}
			page.root.dispose();
			this.pages.delete(pageKey);
			evictedPages++;
		}
		if (evictedPages === 0) return;
		this.visibilityVersion++;
		this.visibilityDirty = true;
	}

	private rebuildQueue(centerX: number, centerZ: number): void {
		this.queue.length = 0;
		this.queueIndex = 0;
		for (let dz = -this.viewDistance; dz <= this.viewDistance; dz++)
			for (let dx = -this.viewDistance; dx <= this.viewDistance; dx++) {
				const x = centerX + dx;
				const z = centerZ + dz;
				const key = `${x},${z}`;
				if (this.chunks.has(key) || this.pending.has(key)) continue;
				this.queue.push({
					x,
					z,
					key,
					distance: dx * dx + dz * dz,
				});
			}
		this.queue.sort((a, b) => a.distance - b.distance);
	}

	private startQueuedChunks(): void {
		let started = 0;
		while (
			started < MAX_CHUNK_LOADS_PER_UPDATE &&
			this.activeLoads < MAX_CHUNK_LOADS_PER_UPDATE &&
			this.queueIndex < this.queue.length
		) {
			const candidate = this.queue[this.queueIndex++];
			if (
				this.chunks.has(candidate.key) ||
				this.pending.has(candidate.key)
			)
				continue;
			this.startChunk(candidate);
			started++;
		}
		if (this.queueIndex === this.queue.length) {
			this.queue.length = 0;
			this.queueIndex = 0;
		}
	}

	private startChunk(candidate: ChunkCandidate): void {
		const page = this.getOrCreatePage(candidate.x, candidate.z);
		const chunk: PendingForestChunk = {
			key: candidate.key,
			x: candidate.x,
			z: candidate.z,
			root: new BABYLON.TransformNode(
				`forestChunk:${candidate.key}`,
				this.scene,
			),
			page,
			visible: false,
			token: {},
		};
		chunk.root.parent = page.root;
		this.pending.set(candidate.key, chunk);
		this.activeLoads++;
		void this.populateChunk(candidate.key, chunk);
	}

	private async populateChunk(
		key: string,
		chunk: PendingForestChunk,
	): Promise<void> {
		try {
			const placements = await this.generation.generateForestPacked(
				this.world,
				chunk.x,
				chunk.z,
			);
			try {
				if (!this.isCurrent(key, chunk)) return;
				const placementGroups =
					this.groupPackedPlacementsByModel(placements);
				let groupIndex = 0;
				let publicationStartedAt = performance.now();
				for (const [url, group] of placementGroups) {
					if (!this.isCurrent(key, chunk)) return;
					publicationStartedAt =
						await this.yieldForestPublicationIfNeeded(
							publicationStartedAt,
						);
					let model: BABYLON.AbstractMesh | null = null;
					try {
						if (!chunk.page.thinBatches.has(url)) {
							const instance = await this.assets.instantiate(
								url,
								`forest:${key}:batch:${groupIndex++}`,
							);
							model = instance.root;
							if (!this.isCurrent(key, chunk)) {
								model.dispose();
								return;
							}
						}
						for (
							let start = 0;
							start < group.length;
							start += FOREST_PLACEMENTS_PER_PUBLICATION
						) {
							if (!this.isCurrent(key, chunk)) {
								model?.dispose();
								return;
							}
							publicationStartedAt =
								await this.yieldForestPublicationIfNeeded(
									publicationStartedAt,
								);
							this.attachThinInstanceBatch(
								chunk,
								model,
								placements,
								group,
								url,
								start,
								Math.min(
									group.length,
									start + FOREST_PLACEMENTS_PER_PUBLICATION,
								),
							);
							model = null;
						}
					} catch (error) {
						model?.dispose();
						this.logModelFailure(url, error);
					}
				}
				if (!this.isCurrent(key, chunk)) return;
				this.pending.delete(key);
				const loadedChunk: LoadedForestChunk = {
					key,
					x: chunk.x,
					z: chunk.z,
					root: chunk.root,
					page: chunk.page,
					visible: false,
				};
				loadedChunk.root.setEnabled(false);
				this.chunks.set(key, loadedChunk);
				loadedChunk.page.chunks.add(loadedChunk);
				this.visibilityVersion++;
				this.visibilityDirty = true;
			} finally {
				placements.release();
			}
		} catch {
			if (!this.disposed) {
				if (this.isCurrent(key, chunk)) {
					this.pending.delete(key);
					chunk.root.dispose();
				}
			}
		} finally {
			this.activeLoads = Math.max(0, this.activeLoads - 1);
		}
	}

	private groupPackedPlacementsByModel(
		placements: ForestPlacementBuffer,
	): Map<string, number[]> {
		const groups = new Map<string, number[]>();
		for (let index = 0; index < placements.count; index++) {
			const placement = readForestPlacement(
				placements.data,
				index,
				this.packedPlacementScratch,
			);
			const url = this.modelUrl(placement);
			let group = groups.get(url);
			if (!group) {
				group = [];
				groups.set(url, group);
			}
			group.push(index);
		}
		return groups;
	}

	private async yieldForestPublicationIfNeeded(
		startedAt: number,
	): Promise<number> {
		if (performance.now() - startedAt < FOREST_PUBLICATION_BUDGET_MS)
			return startedAt;
		await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
		return performance.now();
	}

	private attachThinInstanceBatch(
		chunk: PendingForestChunk,
		model: BABYLON.AbstractMesh | null,
		placements: ForestPlacementBuffer,
		placementIndices: readonly number[],
		url: string,
		start: number,
		end: number,
	): void {
		const placementCount = end - start;
		if (placementCount <= 0) return;
		const page = chunk.page;
		let batch = page.thinBatches.get(url);
		let metadata: SupportMetadata | undefined;

		if (!batch) {
			const sourceMeshes = model && this.getThinInstanceSources(model);
			if (!model || !sourceMeshes) throw new Error(UNSUPPORTED_MODEL);
			metadata = this.prepareThinInstanceSource(
				model,
				sourceMeshes,
				url,
				page.root,
			);
			batch = {
				sourceMeshes,
				matrixData: new Float32Array(
					FOREST_PAGE_INITIAL_INSTANCE_CAPACITY * 16,
				),
				visibleMatrixData: new Float32Array(
					FOREST_PAGE_INITIAL_INSTANCE_CAPACITY * 16,
				),
				instanceChunkKeys: [],
				instanceCount: 0,
				visibleInstanceCount: 0,
				bufferInitialized: false,
				lastVisibilityVersion: -1,
			};
			page.thinBatches.set(url, batch);
		} else if (model) {
			const sourceMeshes = this.getThinInstanceSources(model);
			if (batch.sourceMeshes.length !== sourceMeshes?.length)
				throw new Error(UNSUPPORTED_MODEL);
			metadata = this.getSupportMetadata(url, model);
			model.dispose();
		} else {
			metadata = this.supportMetadata.get(url);
			if (!metadata) throw new Error(UNSUPPORTED_MODEL);
		}

		const firstMatrixIndex = batch.instanceCount;
		const nextInstanceCount = batch.instanceCount + placementCount;
		const requiredFloatCount = nextInstanceCount * 16;
		if (batch.matrixData.length < requiredFloatCount) {
			const currentCapacity = batch.matrixData.length / 16;
			const nextCapacity = Math.max(
				nextInstanceCount,
				Math.max(
					FOREST_PAGE_INITIAL_INSTANCE_CAPACITY,
					currentCapacity * 2,
				),
			);
			const matrixData = new Float32Array(nextCapacity * 16);
			matrixData.set(batch.matrixData);
			batch.matrixData = matrixData;
			const visibleMatrixData = new Float32Array(nextCapacity * 16);
			visibleMatrixData.set(batch.visibleMatrixData);
			batch.visibleMatrixData = visibleMatrixData;
			batch.bufferInitialized = false;
		}
		const matrixData = batch.matrixData;
		for (let index = 0; index < placementCount; index++) {
			const placement = readForestPlacement(
				placements.data,
				placementIndices[start + index]!,
				this.packedPlacementScratch,
			);
			this.createTerrainPlacementMatrix(placement, metadata).copyToArray(
				matrixData,
				(firstMatrixIndex + index) * 16,
			);
			batch.instanceChunkKeys.push(chunk.key);
		}
		batch.instanceCount = nextInstanceCount;
		batch.lastVisibilityVersion = -1;
		this.refreshThinInstanceBatch(batch);
	}

	private refreshThinInstanceBatch(batch: ThinInstanceBatch): void {
		let visibleInstanceCount = 0;
		for (
			let instanceIndex = 0;
			instanceIndex < batch.instanceCount;
			instanceIndex++
		) {
			const chunkKey = batch.instanceChunkKeys[instanceIndex];
			if (
				chunkKey === undefined ||
				!(this.chunks.get(chunkKey)?.visible ?? true)
			)
				continue;
			batch.visibleMatrixData.set(
				batch.matrixData.subarray(
					instanceIndex * 16,
					instanceIndex * 16 + 16,
				),
				visibleInstanceCount * 16,
			);
			visibleInstanceCount++;
		}
		batch.visibleInstanceCount = visibleInstanceCount;

		for (const sourceMesh of batch.sourceMeshes) {
			if (!batch.bufferInitialized) {
				sourceMesh.thinInstanceSetBuffer(
					'matrix',
					batch.visibleMatrixData,
					16,
					false,
				);
			} else if (visibleInstanceCount > 0) {
				sourceMesh.thinInstancePartialBufferUpdate(
					'matrix',
					batch.visibleMatrixData.subarray(
						0,
						visibleInstanceCount * 16,
					),
					0,
				);
			}
			sourceMesh.thinInstanceCount = visibleInstanceCount;
		}
		batch.bufferInitialized = true;
		batch.lastVisibilityVersion = this.visibilityVersion;
	}

	private prepareThinInstanceSource(
		model: BABYLON.AbstractMesh,
		sourceMeshes: BABYLON.Mesh[],
		url: string,
		parent: BABYLON.TransformNode,
	): SupportMetadata {
		model.parent = parent;
		model.rotationQuaternion = null;
		model.rotation.setAll(0);
		model.position.set(0, 0, 0);
		model.scaling.setAll(1);
		this.updateHierarchyMatrices(model);

		for (const mesh of sourceMeshes)
			mesh.bakeCurrentTransformIntoVertices(true, true);
		const metadata = this.getSupportMetadata(url, model);
		this.map.prepareRenderable(model, true);

		for (const mesh of sourceMeshes) {
			if (mesh !== model) mesh.parent = parent;
			mesh.rotationQuaternion = null;
			mesh.rotation.setAll(0);
			mesh.position.set(0, 0, 0);
			mesh.scaling.setAll(1);
			mesh.computeWorldMatrix(true);
			this.prepareStaticNatureMesh(mesh);
		}
		this.updateHierarchyMatrices(model);

		if (!sourceMeshes.some((mesh) => mesh === model)) model.dispose();
		return metadata;
	}

	private getThinInstanceSources(
		root: BABYLON.AbstractMesh,
	): BABYLON.Mesh[] | null {
		const meshes = [root, ...root.getChildMeshes()].filter(
			(mesh) =>
				(mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind)
					?.length ?? 0) >= 3,
		);
		if (
			meshes.length === 0 ||
			meshes.some(
				(mesh) =>
					!(mesh instanceof BABYLON.Mesh) ||
					!!mesh.skeleton ||
					!!mesh.morphTargetManager,
			)
		)
			return null;
		return meshes as BABYLON.Mesh[];
	}

	private createTerrainPlacementMatrix(
		placement: ForestPlacement,
		metadata: SupportMetadata,
	): BABYLON.Matrix {
		const normal = this.placementNormal.set(
			placement.normalX,
			placement.normalY,
			placement.normalZ,
		);
		this.createTerrainRotation(
			placement.rotationY,
			normal,
			this.placementRotation,
		);
		const matrix = this.composeTerrainPlacement(
			placement,
			metadata.center,
			this.placementRotation,
			this.placementMatrix,
		);

		for (let iteration = 0; iteration < 2; iteration++) {
			const fittedNormal = this.fitSupportNormal(
				this.transformSupportPointsToScratch(matrix, metadata.points),
				metadata.points.length,
				this.placementFittedNormal,
			);
			if (!fittedNormal) break;
			normal.copyFrom(fittedNormal);
			this.createTerrainRotation(
				placement.rotationY,
				normal,
				this.placementRotation,
			);
			this.composeTerrainPlacement(
				placement,
				metadata.center,
				this.placementRotation,
				matrix,
			);
		}

		this.preventSupportFloating(matrix, metadata.points);
		return matrix;
	}

	private composeTerrainPlacement(
		placement: ForestPlacement,
		center: SupportPoint,
		rotation: BABYLON.Quaternion,
		result: BABYLON.Matrix,
	): BABYLON.Matrix {
		const scaling = this.placementScaling.set(
			placement.scale,
			placement.scale,
			placement.scale,
		);
		BABYLON.Matrix.ComposeToRef(
			scaling,
			rotation,
			this.placementZero,
			this.placementRotationAndScale,
		);
		BABYLON.Vector3.TransformCoordinatesFromFloatsToRef(
			center.x,
			center.y,
			center.z,
			this.placementRotationAndScale,
			this.placementTransformedCenter,
		);
		this.placementTranslation.set(
			placement.x - this.placementTransformedCenter.x,
			placement.y - this.placementTransformedCenter.y,
			placement.z - this.placementTransformedCenter.z,
		);
		return BABYLON.Matrix.ComposeToRef(
			scaling,
			rotation,
			this.placementTranslation,
			result,
		);
	}

	private preventSupportFloating(
		matrix: BABYLON.Matrix,
		points: readonly SupportPoint[],
	): void {
		let correction = Number.POSITIVE_INFINITY;
		for (const point of points) {
			BABYLON.Vector3.TransformCoordinatesFromFloatsToRef(
				point.x,
				point.y,
				point.z,
				matrix,
				this.placementSupportPoint,
			);
			correction = Math.min(
				correction,
				this.map.getGroundHeight(
					this.placementSupportPoint.x,
					this.placementSupportPoint.z,
				) +
					BASE_CLEARANCE -
					this.placementSupportPoint.y,
			);
		}
		if (
			!Number.isFinite(correction) ||
			Math.abs(correction) <= CONTACT_EPSILON
		)
			return;
		const translation = matrix.getTranslationToRef(
			this.placementTranslation,
		);
		translation.y += correction;
		matrix.setTranslation(translation);
	}

	private transformSupportPointsToScratch(
		matrix: BABYLON.Matrix,
		points: readonly SupportPoint[],
	): readonly BABYLON.Vector3[] {
		while (this.placementSupportPoints.length < points.length)
			this.placementSupportPoints.push(BABYLON.Vector3.Zero());
		for (let index = 0; index < points.length; index++) {
			const point = points[index]!;
			BABYLON.Vector3.TransformCoordinatesFromFloatsToRef(
				point.x,
				point.y,
				point.z,
				matrix,
				this.placementSupportPoints[index]!,
			);
		}
		return this.placementSupportPoints;
	}

	private updateVisibility(): void {
		const camera = this.scene.activeCamera;
		if (!camera || this.pages.size === 0) return;
		const zoneCenter = this.map.getZoneCenter();
		const transformation = camera.getTransformationMatrix();
		const viewProjection = transformation.m;
		let changed =
			this.visibilityDirty ||
			this.lastVisibilityCamera !== camera ||
			zoneCenter.x !== this.lastVisibilityZoneCenterX ||
			zoneCenter.z !== this.lastVisibilityZoneCenterZ;
		for (let index = 0; !changed && index < 16; index++)
			changed = viewProjection[index] !== this.lastViewProjection[index];
		if (!changed) return;

		BABYLON.Frustum.GetPlanesToRef(transformation, this.frustumPlanes);
		const displayRadiusSquared = this.map.CHUNK_DISPLAY_RADIUS ** 2;
		let chunkVisibilityChanged = false;
		for (const chunk of this.chunks.values()) {
			const visible = this.isChunkInView(
				chunk,
				zoneCenter.x,
				zoneCenter.z,
				displayRadiusSquared,
			);
			if (chunk.visible !== visible) {
				chunk.visible = visible;
				chunkVisibilityChanged = true;
			}
			chunk.root.setEnabled(visible);
		}
		for (const page of this.pages.values()) {
			let visible = false;
			for (const chunk of page.chunks) {
				if (chunk.visible) {
					visible = true;
					break;
				}
			}
			if (page.visible !== visible) {
				page.visible = visible;
				page.root.setEnabled(visible);
			}
		}
		if (chunkVisibilityChanged) this.visibilityVersion++;
		for (const page of this.pages.values())
			for (const batch of page.thinBatches.values())
				if (batch.lastVisibilityVersion !== this.visibilityVersion)
					this.refreshThinInstanceBatch(batch);
		this.lastVisibilityCamera = camera;
		this.lastViewProjection.set(viewProjection);
		this.lastVisibilityZoneCenterX = zoneCenter.x;
		this.lastVisibilityZoneCenterZ = zoneCenter.z;
		this.visibilityDirty = false;
	}

	private prepareStaticNatureMesh(mesh: BABYLON.AbstractMesh): void {
		mesh.isPickable = false;
		mesh.checkCollisions = false;
		mesh.alwaysSelectAsActiveMesh = true;
		if (mesh instanceof BABYLON.Mesh)
			mesh.thinInstanceEnablePicking = false;
		mesh.freezeWorldMatrix();
	}

	private getSupportMetadata(
		url: string,
		root: BABYLON.AbstractMesh,
	): SupportMetadata {
		const cached = this.supportMetadata.get(url);
		if (cached) return cached;

		const rootWorld = root.getWorldMatrix();
		const inverseRootWorld = BABYLON.Matrix.Invert(rootWorld);
		const point = BABYLON.Vector3.Zero();
		const localPoint = BABYLON.Vector3.Zero();
		const allPoints: SupportPoint[] = [];
		let minY = Number.POSITIVE_INFINITY;
		let maxY = Number.NEGATIVE_INFINITY;
		for (const mesh of [root, ...root.getChildMeshes()]) {
			const positions = mesh.getVerticesData(
				BABYLON.VertexBuffer.PositionKind,
			);
			if (!positions) continue;
			const worldMatrix = mesh.getWorldMatrix();
			for (let index = 0; index + 2 < positions.length; index += 3) {
				BABYLON.Vector3.TransformCoordinatesFromFloatsToRef(
					positions[index],
					positions[index + 1],
					positions[index + 2],
					worldMatrix,
					point,
				);
				BABYLON.Vector3.TransformCoordinatesToRef(
					point,
					inverseRootWorld,
					localPoint,
				);
				const supportPoint = {
					x: localPoint.x,
					y: localPoint.y,
					z: localPoint.z,
				};
				allPoints.push(supportPoint);
				minY = Math.min(minY, localPoint.y);
				maxY = Math.max(maxY, localPoint.y);
			}
		}

		if (!allPoints.length) {
			const empty: SupportMetadata = {
				points: [{ x: 0, y: 0, z: 0 }],
				center: { x: 0, y: 0, z: 0 },
			};
			this.supportMetadata.set(url, empty);
			return empty;
		}

		const band = Math.max(
			MIN_SUPPORT_BAND,
			Math.min(MAX_SUPPORT_BAND, (maxY - minY) * SUPPORT_BAND_RATIO),
		);
		const points = allPoints.filter(
			(candidate) => candidate.y <= minY + band,
		);
		const supportPoints = points.length
			? capSupportPoints(points)
			: [allPoints[0]!];
		const center = { x: 0, y: 0, z: 0 };
		for (const point of supportPoints) {
			center.x += point.x;
			center.y += point.y;
			center.z += point.z;
		}
		const inversePointCount = 1 / supportPoints.length;
		center.x *= inversePointCount;
		center.y *= inversePointCount;
		center.z *= inversePointCount;
		const metadata: SupportMetadata = { points: supportPoints, center };
		this.supportMetadata.set(url, metadata);
		return metadata;
	}

	private createTerrainRotation(
		rotationY: number,
		normal: BABYLON.Vector3,
		result: BABYLON.Quaternion,
	): BABYLON.Quaternion {
		const up = this.placementUp.copyFrom(normal);
		if (up.lengthSquared() < 0.000001) up.set(0, 1, 0);
		else up.normalize();
		if (up.y < 0) up.scaleInPlace(-1);
		const forward = this.placementForward.set(
			Math.sin(rotationY),
			0,
			Math.cos(rotationY),
		);
		const projection = BABYLON.Vector3.Dot(forward, up);
		forward.x -= up.x * projection;
		forward.y -= up.y * projection;
		forward.z -= up.z * projection;
		if (forward.lengthSquared() < 0.000001) forward.set(up.z, 0, -up.x);
		forward.normalize();
		return BABYLON.Quaternion.FromLookDirectionLHToRef(forward, up, result);
	}

	private fitSupportNormal(
		points: readonly BABYLON.Vector3[],
		count: number,
		result: BABYLON.Vector3,
	): BABYLON.Vector3 | null {
		if (count < 3) return null;
		let meanX = 0;
		let meanZ = 0;
		let meanGround = 0;
		while (this.placementSupportGroundHeights.length < count)
			this.placementSupportGroundHeights.push(0);
		for (let index = 0; index < count; index++) {
			const point = points[index]!;
			meanX += point.x;
			meanZ += point.z;
			const ground = this.map.getGroundHeight(point.x, point.z);
			this.placementSupportGroundHeights[index] = ground;
			meanGround += ground;
		}
		meanX /= count;
		meanZ /= count;
		meanGround /= count;

		let xx = 0;
		let xz = 0;
		let zz = 0;
		let xGround = 0;
		let zGround = 0;
		for (let index = 0; index < count; index++) {
			const point = points[index]!;
			const dx = point.x - meanX;
			const dz = point.z - meanZ;
			const dg = this.placementSupportGroundHeights[index]! - meanGround;
			xx += dx * dx;
			xz += dx * dz;
			zz += dz * dz;
			xGround += dx * dg;
			zGround += dz * dg;
		}
		const determinant = xx * zz - xz * xz;
		if (determinant < 0.000001) return null;
		const slopeX = (xGround * zz - zGround * xz) / determinant;
		const slopeZ = (zGround * xx - xGround * xz) / determinant;
		result.set(-slopeX, 1, -slopeZ);
		return result.lengthSquared() < 0.000001 ? null : result.normalize();
	}

	private updateHierarchyMatrices(root: BABYLON.AbstractMesh): void {
		root.computeWorldMatrix(true);
		for (const mesh of root.getChildMeshes()) mesh.computeWorldMatrix(true);
	}

	private modelUrl(placement: ForestPlacement): string {
		const variants = models.environment.forest[placement.kind];
		const preferredVariants =
			PREFERRED_VARIANTS[placement.kind][placement.biome];
		const variant =
			preferredVariants[placement.variant % preferredVariants.length] ??
			0;
		return variants[variant % variants.length];
	}

	private isCurrent(key: string, chunk: PendingForestChunk): boolean {
		return !this.disposed && this.pending.get(key)?.token === chunk.token;
	}

	private logModelFailure(url: string, error: unknown): void {
		if (this.failedModels.has(url)) return;
		this.failedModels.add(url);
		console.warn(`failed to load forest model '${url}'`, error);
	}
}
