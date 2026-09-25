import * as BABYLON from '@babylonjs/core';
import { SceneManager } from './scenes/SceneManager';
import type { GameLocale } from './i18n';

let engine: BABYLON.Engine | null = null;
let handleResize: (() => void) | null = null;

export async function initGame(
	canvas: HTMLCanvasElement,
	username: string,
	userId: string,
	locale: GameLocale,
	avatarUrl?: string,
) {
	engine = new BABYLON.Engine(canvas, true);
	SceneManager.init(engine, username, userId, locale, avatarUrl);
	await SceneManager.toLobby();
	SceneManager.start();

	handleResize = () => engine?.resize();
	window.addEventListener('resize', handleResize);
}

export async function destroyGame() {
	SceneManager.stop();
	if (handleResize) {
		window.removeEventListener('resize', handleResize);
		handleResize = null;
	}
	engine?.dispose();
	engine = null;
}
