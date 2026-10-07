export type GenerationBuffer = ArrayBuffer | SharedArrayBuffer;

export const GENERATION_HEADER_BYTES = 8;
export const GENERATION_STATUS_INDEX = 0;
export const GENERATION_COUNT_INDEX = 1;
export const GENERATION_READY = 1;

export const TERRAIN_SURFACE_STRIDE = 4;

type GenerationTaskBase = ChunkCoordinates & {
	id: number;
	seed: number;
	buffer: GenerationBuffer;
};

export type GenerationTask = GenerationTaskBase & { kind: 'terrain' };

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

export function writeGenerationReady(
	header: Int32Array,
	count: number,
	shared: boolean,
): void {
	if (shared) {
		Atomics.store(header, GENERATION_COUNT_INDEX, count);
		Atomics.store(header, GENERATION_STATUS_INDEX, GENERATION_READY);
		return;
	}
	header[GENERATION_COUNT_INDEX] = count;
	header[GENERATION_STATUS_INDEX] = GENERATION_READY;
}

export function readGenerationCount(
	header: Int32Array,
	shared: boolean,
): number {
	return shared
		? Atomics.load(header, GENERATION_COUNT_INDEX)
		: header[GENERATION_COUNT_INDEX]!;
}
import type { ChunkCoordinates } from '@transcendence/game-shared';
