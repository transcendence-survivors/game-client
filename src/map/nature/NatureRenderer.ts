import * as BABYLON from '@babylonjs/core';
import type { ModelAssetLibrary } from '../../assets/ModelAssetLibrary';
import type { MapGenerator } from '../MapGenerator';
import type { ChunkVisibilityListener } from '../world/ChunkManager';
import {
	generateNaturePlacements,
	type NaturePlacement,
} from './NaturePlacement';

interface NatureChunk {
	readonly placements: ReadonlyMap<string, readonly NaturePlacement[]>;
	readonly matrices: Map<string, Float32Array>;
	visible: boolean;
}

const GROUND_SINK_RATIO = 0.04;

export class NatureRenderer implements ChunkVisibilityListener {
	private readonly map: MapGenerator;
	private readonly assets: ModelAssetLibrary;
	private readonly sources = new Map<string, BABYLON.Mesh[] | null>();
	private readonly chunks = new Map<string, NatureChunk>();
	private readonly dirtyUrls = new Set<string>();
	private readonly yaw = new BABYLON.Quaternion();
	private readonly tilt = new BABYLON.Quaternion();
	private readonly normal = new BABYLON.Vector3();
	private readonly scaling = new BABYLON.Vector3();
	private readonly position = new BABYLON.Vector3();
	private readonly matrix = new BABYLON.Matrix();
	private disposed = false;

	constructor(map: MapGenerator, assets: ModelAssetLibrary) {
		this.map = map;
		this.assets = assets;
		map.setChunkVisibilityListener(this);
	}

	onChunkVisibilityChanged(x: number, z: number, visible: boolean): void {
		const key = `${x},${z}`;
		let chunk = this.chunks.get(key);
		if (!chunk) {
			if (!visible) return;
			const placements = new Map<string, NaturePlacement[]>();
			for (const placement of generateNaturePlacements(
				this.map.getWorld(),
				x,
				z,
			)) {
				const group = placements.get(placement.url);
				if (group) group.push(placement);
				else placements.set(placement.url, [placement]);
			}
			chunk = { placements, matrices: new Map(), visible: false };
			this.chunks.set(key, chunk);
		}
		if (chunk.visible === visible) return;
		chunk.visible = visible;
		for (const url of chunk.placements.keys()) this.dirtyUrls.add(url);
	}

	onChunkDisposed(x: number, z: number): void {
		const key = `${x},${z}`;
		this.onChunkVisibilityChanged(x, z, false);
		this.chunks.delete(key);
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
		if (this.disposed) return;
		this.disposed = true;
		this.map.setChunkVisibilityListener(null);
		for (const source of this.sources.values())
			for (const mesh of source ?? []) mesh.dispose();
		this.sources.clear();
		this.chunks.clear();
	}

	private loadSource(url: string): void {
		this.sources.set(url, null);
		this.assets
			.instantiate(url, `nature:${url}`)
			.then(({ root }) => {
				if (this.disposed) return root.dispose();
				this.sources.set(url, this.prepareSource(root));
				for (const chunk of this.chunks.values())
					if (chunk.visible && chunk.placements.has(url))
						this.dirtyUrls.add(url);
			})
			.catch((error: unknown) =>
				console.warn(`failed to load nature model '${url}'`, error),
			);
	}

	private prepareSource(root: BABYLON.AbstractMesh): BABYLON.Mesh[] {
		root.rotationQuaternion = null;
		root.rotation.setAll(0);
		root.position.setAll(0);
		root.scaling.setAll(1);
		this.map.prepareRenderable(root, true);
		const meshes = [root, ...root.getChildMeshes()].filter(
			(mesh): mesh is BABYLON.Mesh =>
				mesh instanceof BABYLON.Mesh &&
				mesh.getTotalVertices() > 0 &&
				!mesh.skeleton &&
				!mesh.morphTargetManager,
		);
		const { min, max } = root.getHierarchyBoundingVectors(true);
		const ground = BABYLON.Matrix.Translation(
			0,
			-min.y - (max.y - min.y) * GROUND_SINK_RATIO,
			0,
		);
		const transforms = meshes.map((mesh) =>
			mesh.computeWorldMatrix(true).multiply(ground),
		);
		meshes.forEach((mesh, index) => {
			mesh.parent = null;
			mesh.makeGeometryUnique();
			mesh.bakeTransformIntoVertices(transforms[index]!);
			mesh.rotationQuaternion = null;
			mesh.rotation.setAll(0);
			mesh.position.setAll(0);
			mesh.scaling.setAll(1);
			mesh.isPickable = false;
			mesh.alwaysSelectAsActiveMesh = true;
			mesh.thinInstanceEnablePicking = false;
			mesh.setEnabled(false);
			mesh.freezeWorldMatrix();
		});
		if (!meshes.includes(root as BABYLON.Mesh)) root.dispose();
		return meshes;
	}

	private rebuild(url: string, source: readonly BABYLON.Mesh[]): void {
		const visible: Float32Array[] = [];
		let length = 0;
		for (const chunk of this.chunks.values()) {
			const placements = chunk.placements.get(url);
			if (!chunk.visible || !placements) continue;
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
