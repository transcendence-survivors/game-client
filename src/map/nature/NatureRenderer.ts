import * as BABYLON from '@babylonjs/core';
import type { World } from '@transcendence/game-shared';
import type { ModelAssetLibrary } from '../../assets/ModelAssetLibrary';
import type { ChunkAttachment } from '../world/ChunkManager';
import {
	generateNaturePlacements,
	type NaturePlacement,
} from './NaturePlacement';

interface NatureChunk {
	placements: ReadonlyMap<string, readonly NaturePlacement[]> | null;
	readonly matrices: Map<string, Float32Array>;
}

export class NatureRenderer {
	private readonly world: World;
	private readonly assets: ModelAssetLibrary;
	private readonly sources = new Map<string, BABYLON.Mesh[] | null>();
	private readonly visibleChunks = new Set<NatureChunk>();
	private readonly dirtyUrls = new Set<string>();
	private readonly yaw = new BABYLON.Quaternion();
	private readonly tilt = new BABYLON.Quaternion();
	private readonly normal = new BABYLON.Vector3();
	private readonly scaling = new BABYLON.Vector3();
	private readonly position = new BABYLON.Vector3();
	private readonly matrix = new BABYLON.Matrix();
	private disposed = false;

	constructor(world: World, assets: ModelAssetLibrary) {
		this.world = world;
		this.assets = assets;
	}

	update(): void {
		if (this.disposed) return;
		for (const url of this.dirtyUrls) {
			const source = this.sources.get(url);
			if (source === undefined) this.loadSource(url);
			else if (source) this.rebuild(url, source);
		}
		this.dirtyUrls.clear();
	}

	dispose(): void {
		this.disposed = true;
		for (const source of this.sources.values())
			for (const mesh of source ?? []) mesh.dispose();
		this.sources.clear();
		this.visibleChunks.clear();
	}

	createChunkAttachment(x: number, z: number): ChunkAttachment {
		const chunk: NatureChunk = { placements: null, matrices: new Map() };
		return {
			setVisible: (visible) => {
				if (visible) chunk.placements ??= this.groupByModel(x, z);
				this.setVisible(chunk, visible);
			},
			dispose: () => this.setVisible(chunk, false),
		};
	}

	private setVisible(chunk: NatureChunk, visible: boolean): void {
		if (visible === this.visibleChunks.has(chunk)) return;
		if (visible) this.visibleChunks.add(chunk);
		else this.visibleChunks.delete(chunk);
		for (const url of chunk.placements?.keys() ?? [])
			this.dirtyUrls.add(url);
	}

	private groupByModel(x: number, z: number): Map<string, NaturePlacement[]> {
		const groups = new Map<string, NaturePlacement[]>();
		for (const placement of generateNaturePlacements(this.world, x, z)) {
			const group = groups.get(placement.url);
			if (group) group.push(placement);
			else groups.set(placement.url, [placement]);
		}
		return groups;
	}

	private loadSource(url: string): void {
		this.sources.set(url, null);
		this.assets
			.instantiate(url, `nature:${url}`)
			.then(({ root }) => {
				if (this.disposed) return root.dispose();
				this.sources.set(url, this.prepareSource(root));
				for (const chunk of this.visibleChunks)
					if (chunk.placements?.has(url)) this.dirtyUrls.add(url);
			})
			.catch((error: unknown) =>
				console.warn(`failed to load nature model '${url}'`, error),
			);
	}

	private prepareSource(root: BABYLON.AbstractMesh): BABYLON.Mesh[] {
		const meshes = root
			.getChildMeshes()
			.filter(
				(mesh): mesh is BABYLON.Mesh =>
					mesh instanceof BABYLON.Mesh && mesh.getTotalVertices() > 0,
			);
		for (const mesh of meshes) {
			mesh.parent = null;
			mesh.isPickable = false;
			mesh.alwaysSelectAsActiveMesh = true;
			mesh.setEnabled(false);
			mesh.freezeWorldMatrix();
		}
		root.dispose();
		return meshes;
	}

	private rebuild(url: string, source: readonly BABYLON.Mesh[]): void {
		const visible: Float32Array[] = [];
		let length = 0;
		for (const chunk of this.visibleChunks) {
			const placements = chunk.placements?.get(url);
			if (!placements) continue;
			let matrices = chunk.matrices.get(url);
			if (!matrices) {
				matrices = this.createMatrices(placements);
				chunk.matrices.set(url, matrices);
			}
			visible.push(matrices);
			length += matrices.length;
		}
		const data = new Float32Array(length);
		let offset = 0;
		for (const matrices of visible) {
			data.set(matrices, offset);
			offset += matrices.length;
		}
		for (const mesh of source) {
			if (length > 0)
				mesh.thinInstanceSetBuffer('matrix', data, 16, true);
			mesh.setEnabled(length > 0);
		}
	}

	private createMatrices(
		placements: readonly NaturePlacement[],
	): Float32Array {
		const data = new Float32Array(placements.length * 16);
		placements.forEach((placement, index) => {
			BABYLON.Quaternion.RotationAxisToRef(
				BABYLON.Axis.Y,
				placement.rotationY,
				this.yaw,
			);
			if (placement.tilt) {
				this.normal
					.set(
						placement.normalX,
						placement.normalY,
						placement.normalZ,
					)
					.normalize();
				BABYLON.Quaternion.FromUnitVectorsToRef(
					BABYLON.Axis.Y,
					this.normal,
					this.tilt,
				).multiplyToRef(this.yaw, this.yaw);
			}
			BABYLON.Matrix.ComposeToRef(
				this.scaling.setAll(placement.scale),
				this.yaw,
				this.position.set(placement.x, placement.y, placement.z),
				this.matrix,
			);
			this.matrix.copyToArray(data, index * 16);
		});
		return data;
	}
}
