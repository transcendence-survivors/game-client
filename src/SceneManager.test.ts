import type { Engine } from '@babylonjs/core';
import { describe, expect, it, vi } from 'vitest';
import { type ManagedScene, SceneManager } from './scenes/SceneManager';

function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function scene(ready: Promise<void>) {
	return {
		ready,
		render: vi.fn<ManagedScene['render']>(),
		dispose: vi.fn<ManagedScene['dispose']>(),
	} satisfies ManagedScene;
}

describe('SceneManager', () => {
	it('keeps the latest scene when an older transition finishes later', async () => {
		let renderLoop: (() => void) | undefined;
		const engine = {
			runRenderLoop: vi.fn((callback: () => void) => {
				renderLoop = callback;
			}),
			stopRenderLoop: vi.fn(),
		} as unknown as Engine;
		SceneManager.init(engine);

		const slowReady = deferred();
		const slowScene = scene(slowReady.promise);
		const latestScene = scene(Promise.resolve());
		const slowTransition = SceneManager.set(slowScene);
		await SceneManager.set(latestScene);
		slowReady.resolve();
		await slowTransition;

		SceneManager.start();
		renderLoop?.();
		expect(latestScene.render).toHaveBeenCalledOnce();
		expect(latestScene.dispose).not.toHaveBeenCalled();
		expect(slowScene.dispose).toHaveBeenCalledOnce();

		SceneManager.stop();
		expect(latestScene.dispose).toHaveBeenCalledOnce();
	});
});
