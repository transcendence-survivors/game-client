import {
	type ForestPlacementBuffer,
	generateForestPlacementsInto,
	validateForestPlacementBuffer,
} from '../nature/ForestPlacement';
import type { World } from '@transcendence/game-shared';
import {
	FOREST_PLACEMENT_CAPACITY,
	FOREST_PLACEMENT_STRIDE,
	GENERATION_HEADER_BYTES,
	GENERATION_READY,
	GENERATION_COUNT_INDEX,
	GENERATION_STATUS_INDEX,
	readGenerationCount,
	isSharedGenerationBuffer,
	TERRAIN_SURFACE_STRIDE,
	type GenerationBuffer,
	type GenerationResponse,
	type GenerationTask,
} from './WorldGenerationProtocol';
import {
	generateTerrainSurface,
	terrainSurfaceSegments,
	type TerrainSurfaceData,
} from './TerrainSurface';

interface PendingTask {
	kind: GenerationTask['kind'];
	decode: (buffer: GenerationBuffer) => unknown;
	fallback: () => unknown;
	resolve: (value: unknown) => void;
	reject: (reason: unknown) => void;
}

const MAX_POOLED_BUFFERS_PER_SIZE = 2;
const FOREST_BUFFER_BYTES =
	GENERATION_HEADER_BYTES +
	FOREST_PLACEMENT_CAPACITY *
		FOREST_PLACEMENT_STRIDE *
		Float64Array.BYTES_PER_ELEMENT;

function supportsSharedBuffers(): boolean {
	return (
		typeof SharedArrayBuffer !== 'undefined' &&
		typeof globalThis.crossOriginIsolated === 'boolean' &&
		globalThis.crossOriginIsolated
	);
}

function readReadyCount(buffer: GenerationBuffer): number {
	const header = new Int32Array(buffer, 0, 2);
	const shared = isSharedGenerationBuffer(buffer);
	const status = shared
		? Atomics.load(header, GENERATION_STATUS_INDEX)
		: header[GENERATION_STATUS_INDEX];
	if (status !== GENERATION_READY)
		throw new Error('World generation did not complete');
	return readGenerationCount(header, shared);
}

function deferToTask<T>(work: () => T): Promise<T> {
	if (typeof window === 'undefined') {
		try {
			return Promise.resolve(work());
		} catch (error) {
			return Promise.reject(error);
		}
	}
	return new Promise<T>((resolve, reject) => {
		window.setTimeout(() => {
			try {
				resolve(work());
			} catch (error) {
				reject(error);
			}
		}, 0);
	});
}

export class WorldGenerationClient {
	private worker: Worker | null = null;
	private nextTaskId = 1;
	private disposed = false;
	private readonly pending = new Map<number, PendingTask>();
	private readonly bufferPool = new Map<number, GenerationBuffer[]>();
	private readonly sharedBuffersEnabled = supportsSharedBuffers();

	constructor() {
		this.worker = this.createWorker();
		if (this.worker) {
			this.worker.onmessage = this.handleMessage;
			this.worker.onerror = this.handleWorkerError;
		}
	}

	generateForestPacked(
		world: World,
		chunkX: number,
		chunkZ: number,
	): Promise<ForestPlacementBuffer> {
		const fallback = (): ForestPlacementBuffer => {
			const data = new Float64Array(
				FOREST_PLACEMENT_CAPACITY * FOREST_PLACEMENT_STRIDE,
			);
			const count = generateForestPlacementsInto(
				world,
				chunkX,
				chunkZ,
				data,
			);
			return {
				data,
				count,
				release: () => {},
			};
		};
		return this.dispatch(
			'forest',
			world.seed,
			chunkX,
			chunkZ,
			FOREST_BUFFER_BYTES,
			this.decodePackedForest,
			fallback,
		);
	}

	generateTerrain(
		world: World,
		chunkX: number,
		chunkZ: number,
	): Promise<TerrainSurfaceData> {
		const fallback = () => generateTerrainSurface(world, chunkX, chunkZ);
		const vertexCount = (terrainSurfaceSegments(world) + 1) ** 2;
		const bufferBytes =
			GENERATION_HEADER_BYTES +
			vertexCount *
				TERRAIN_SURFACE_STRIDE *
				Float32Array.BYTES_PER_ELEMENT;
		return this.dispatch(
			'terrain',
			world.seed,
			chunkX,
			chunkZ,
			bufferBytes,
			(bufferResult) => this.decodeTerrain(bufferResult, vertexCount),
			fallback,
		);
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.worker?.terminate();
		this.worker = null;
		const error = new Error('World generation client disposed');
		for (const task of this.pending.values()) task.reject(error);
		this.pending.clear();
	}

	private createWorker(): Worker | null {
		if (typeof window === 'undefined' || typeof Worker === 'undefined')
			return null;
		try {
			return new Worker(
				new URL('./WorldGenerationWorker.ts', import.meta.url),
				{
					type: 'module',
				},
			);
		} catch {
			return null;
		}
	}

	private createBuffer(byteLength: number): GenerationBuffer {
		const pooled = this.bufferPool.get(byteLength);
		const reused = pooled?.pop();
		if (reused) {
			const header = new Int32Array(reused, 0, 2);
			if (isSharedGenerationBuffer(reused)) {
				Atomics.store(header, GENERATION_STATUS_INDEX, 0);
				Atomics.store(header, GENERATION_COUNT_INDEX, 0);
			} else {
				header[GENERATION_STATUS_INDEX] = 0;
				header[GENERATION_COUNT_INDEX] = 0;
			}
			return reused;
		}
		return this.sharedBuffersEnabled
			? new SharedArrayBuffer(byteLength)
			: new ArrayBuffer(byteLength);
	}

	private readonly releaseBuffer = (buffer: GenerationBuffer): void => {
		if (this.disposed || buffer.byteLength === 0) return;
		let pooled = this.bufferPool.get(buffer.byteLength);
		if (!pooled) {
			pooled = [];
			this.bufferPool.set(buffer.byteLength, pooled);
		}
		if (pooled.length < MAX_POOLED_BUFFERS_PER_SIZE) pooled.push(buffer);
	};

	private dispatch<T>(
		kind: GenerationTask['kind'],
		seed: number,
		chunkX: number,
		chunkZ: number,
		bufferBytes: number,
		decode: (buffer: GenerationBuffer) => T,
		fallback: () => T,
	): Promise<T> {
		const worker = this.worker;
		if (!worker || this.disposed) return deferToTask(fallback);
		const buffer = this.createBuffer(bufferBytes);
		const id = this.nextTaskId++;
		const message = {
			id,
			kind,
			seed,
			chunkX,
			chunkZ,
			buffer,
		} as GenerationTask;
		return new Promise<T>((resolve, reject) => {
			this.pending.set(id, {
				kind,
				decode,
				fallback,
				resolve: (value) => resolve(value as T),
				reject,
			});
			try {
				if (isSharedGenerationBuffer(buffer))
					worker.postMessage(message);
				else worker.postMessage(message, [buffer]);
			} catch {
				this.pending.delete(id);
				this.releaseBuffer(buffer);
				this.disableWorker();
				deferToTask(fallback).then(resolve, reject);
			}
		});
	}

	private readonly handleMessage = (
		event: MessageEvent<GenerationResponse>,
	): void => {
		const response = event.data;
		const task = this.pending.get(response.id);
		if (!task) return;
		this.pending.delete(response.id);
		if (response.error) {
			if (response.buffer) this.releaseBuffer(response.buffer);
			task.reject(new Error(response.error));
			return;
		}
		if (!response.buffer) {
			task.reject(new Error(`Missing ${task.kind} generation buffer`));
			return;
		}
		try {
			task.resolve(task.decode(response.buffer));
		} catch (error) {
			this.releaseBuffer(response.buffer);
			task.reject(error);
		}
	};

	private readonly handleWorkerError = (): void => this.disableWorker();

	private disableWorker(): void {
		this.worker?.terminate();
		this.worker = null;
		const tasks = [...this.pending.values()];
		this.pending.clear();
		for (const task of tasks)
			deferToTask(task.fallback).then(task.resolve, task.reject);
	}

	private readonly decodePackedForest = (
		buffer: GenerationBuffer,
	): ForestPlacementBuffer => {
		const count = readReadyCount(buffer);
		if (count < 0 || count > FOREST_PLACEMENT_CAPACITY)
			throw new Error(`Invalid forest placement count: ${count}`);
		const output = new Float64Array(buffer, GENERATION_HEADER_BYTES);
		validateForestPlacementBuffer(output, count);
		return {
			data: output,
			count,
			release: this.createRelease(buffer),
		};
	};

	private decodeTerrain = (
		buffer: GenerationBuffer,
		vertexCount: number,
	): TerrainSurfaceData => {
		if (readReadyCount(buffer) !== vertexCount)
			throw new Error('Invalid terrain vertex count');
		const output = new Float32Array(buffer, GENERATION_HEADER_BYTES);
		return {
			segments: Math.sqrt(vertexCount) - 1,
			heights: output.subarray(0, vertexCount),
			normals: output.subarray(
				vertexCount,
				vertexCount * TERRAIN_SURFACE_STRIDE,
			),
			release: this.createRelease(buffer),
		};
	};

	private createRelease(buffer: GenerationBuffer): () => void {
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.releaseBuffer(buffer);
		};
	}
}
