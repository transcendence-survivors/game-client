export type GenerationBuffer = ArrayBuffer | SharedArrayBuffer;

export const GENERATION_HEADER_BYTES = 8;
export const GENERATION_STATUS_INDEX = 0;
export const GENERATION_COUNT_INDEX = 1;
export const GENERATION_READY = 1;

export const FOREST_PLACEMENT_STRIDE = 11;
export const FOREST_PLACEMENT_CAPACITY = 128;

export const TERRAIN_SURFACE_STRIDE = 4;

type GenerationTaskBase = ChunkCoordinates & {
	id: number;
	seed: number;
	buffer: GenerationBuffer;
};

type ForestGenerationTask = GenerationTaskBase & { kind: 'forest' };

type TerrainGenerationTask = GenerationTaskBase & { kind: 'terrain' };

export type GenerationTask = ForestGenerationTask | TerrainGenerationTask;

export interface GenerationResponse {
	id: number;
	kind: GenerationTask['kind'];
	buffer?: GenerationBuffer;
	error?: string;
}

export function isSharedGenerationBuffer(
	buffer: GenerationBuffer,
): buffer is SharedArrayBuffer {
	return (
		typeof SharedArrayBuffer !== 'undefined' &&
		buffer instanceof SharedArrayBuffer
	);
}

export function writeGenerationHeader(
	buffer: GenerationBuffer,
	status: number,
	count: number,
): void {
	const header = new Int32Array(buffer, 0, 2);
	if (isSharedGenerationBuffer(buffer)) {
		Atomics.store(header, GENERATION_COUNT_INDEX, count);
		Atomics.store(header, GENERATION_STATUS_INDEX, status);
	} else {
		header[GENERATION_COUNT_INDEX] = count;
		header[GENERATION_STATUS_INDEX] = status;
	}
}

export function readGenerationCount(buffer: GenerationBuffer): number {
	const header = new Int32Array(buffer, 0, 2);
	const shared = isSharedGenerationBuffer(buffer);
	const status = shared
		? Atomics.load(header, GENERATION_STATUS_INDEX)
		: header[GENERATION_STATUS_INDEX];
	if (status !== GENERATION_READY)
		throw new Error('World generation did not complete');
	return shared
		? Atomics.load(header, GENERATION_COUNT_INDEX)
		: header[GENERATION_COUNT_INDEX]!;
}
import type { ChunkCoordinates } from '@transcendence/game-shared';
