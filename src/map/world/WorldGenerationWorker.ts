import { World } from '@transcendence/game-shared';
import {
	GENERATION_HEADER_BYTES,
	isSharedGenerationBuffer,
	TERRAIN_SURFACE_STRIDE,
	writeGenerationReady,
	type GenerationResponse,
	type GenerationTask,
} from './WorldGenerationProtocol';
import { writeTerrainSurface, terrainSurfaceSegments } from './TerrainSurface';

interface WorkerMessageEvent {
	data: GenerationTask;
}

interface WorkerScope {
	onmessage: ((event: WorkerMessageEvent) => void) | null;
	postMessage(message: GenerationResponse, transfer?: Transferable[]): void;
}

const scope = globalThis as unknown as WorkerScope;
let cachedSeed = Number.NaN;
let cachedWorld: World | null = null;

function worldFor(seed: number): World {
	if (!cachedWorld || cachedSeed !== seed) {
		cachedSeed = seed;
		cachedWorld = new World(seed);
	}
	return cachedWorld;
}

function publish(task: GenerationTask, response: GenerationResponse): void {
	if (task.buffer instanceof ArrayBuffer) {
		scope.postMessage(response, [task.buffer]);
	} else {
		scope.postMessage(response);
	}
}

function generateTerrain(
	task: Extract<GenerationTask, { kind: 'terrain' }>,
): void {
	const world = worldFor(task.seed);
	const vertexCount = (terrainSurfaceSegments(world) + 1) ** 2;

	const header = new Int32Array(task.buffer, 0, 2);
	const output = new Float32Array(task.buffer, GENERATION_HEADER_BYTES);
	const normalsOffset = vertexCount;
	if (output.length < vertexCount * TERRAIN_SURFACE_STRIDE)
		throw new Error('Terrain surface output buffer is too small');
	writeTerrainSurface(
		world,
		task.chunkX,
		task.chunkZ,
		output.subarray(0, vertexCount),
		output.subarray(normalsOffset, vertexCount * TERRAIN_SURFACE_STRIDE),
	);
	writeGenerationReady(
		header,
		vertexCount,
		isSharedGenerationBuffer(task.buffer),
	);
	publish(task, { id: task.id, kind: task.kind, buffer: task.buffer });
}

scope.onmessage = (event) => {
	const task = event.data;
	try {
		generateTerrain(task);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		publish(task, {
			id: task.id,
			kind: task.kind,
			buffer: task.buffer,
			error: message,
		});
	}
};
