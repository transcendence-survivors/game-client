import * as BABYLON from '@babylonjs/core';
import { SceneManager } from './scenes/SceneManager';
import type { GameLocale } from './i18n';

let engine: BABYLON.Engine | null = null;
let handleResize: (() => void) | null = null;
let generation = 0;

export async function initGame(
	canvas: HTMLCanvasElement,
	username: string,
	userId: string,
	locale: GameLocale,
	displayName: string,
	gameSocketUrl: string,
	avatarUrl?: string,
) {
	destroyGame();
	const myGen = generation;

	const myEngine = new BABYLON.Engine(canvas, true);
	engine = myEngine;

	handleResize = () => engine?.resize();
	window.addEventListener('resize', handleResize);

	SceneManager.init(
		engine,
		username,
		userId,
		locale,
		displayName,
		gameSocketUrl,
		avatarUrl,
	);
	await SceneManager.toLobby();

	if (myGen !== generation) return;
	SceneManager.start();
}

export function destroyGame() {
	generation++;
	SceneManager.stop();
	if (handleResize) {
		window.removeEventListener('resize', handleResize);
		handleResize = null;
	}
	engine?.dispose();
	engine = null;
}
