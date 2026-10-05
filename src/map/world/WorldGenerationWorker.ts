import { World } from '@transcendence/game-shared';
import {
	GENERATION_HEADER_BYTES,
	GENERATION_READY,
	TERRAIN_SURFACE_STRIDE,
	writeGenerationHeader,
	type GenerationResponse,
	type GenerationTask,
} from './WorldGenerationProtocol';
import { generateForestPlacementsInto } from '../nature/ForestPlacement';
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

scope.onmessage = (event) => {
	const task = event.data;
	try {
		const world = worldFor(task.seed);
		let count: number;
		if (task.kind === 'forest')
			count = generateForestPlacementsInto(
				world,
				task.chunkX,
				task.chunkZ,
				new Float64Array(task.buffer, GENERATION_HEADER_BYTES),
			);
		else {
			count = (terrainSurfaceSegments(world) + 1) ** 2;
			const output = new Float32Array(
				task.buffer,
				GENERATION_HEADER_BYTES,
			);
			if (output.length < count * TERRAIN_SURFACE_STRIDE)
				throw new Error('Terrain surface output buffer is too small');
			writeTerrainSurface(
				world,
				task.chunkX,
				task.chunkZ,
				output.subarray(0, count),
				output.subarray(count, count * TERRAIN_SURFACE_STRIDE),
			);
		}
		writeGenerationHeader(task.buffer, GENERATION_READY, count);
		publish(task, { id: task.id, kind: task.kind, buffer: task.buffer });
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
