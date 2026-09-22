import { type Engine } from '@babylonjs/core';
import { MainMenuScene } from './MainMenuScene';
import { GameScene } from './GameScene';
import { LobbyScene } from './LobbyScene';
import * as COLYSEUS from '@colyseus/sdk';
import type { GameState } from '../../../shared-package/src';
import { EndingScreen } from './EndingScreen';
import { WaitingScreen } from './WaitingScreen';
import type { UserInfos } from '../../../shared-package/src/utils/Types';

export interface ManagedScene {
	render(): void;
	dispose(): void;
	ready: Promise<void>;
}

export class SceneManager {
	private static engine: Engine;
	private static currentScene: ManagedScene | undefined;
	private static transitionSequence = 0;
	private static user: UserInfos = {
		username: '',
		userId: '',
		avatarUrl: '',
	};

	static init(
		engine: Engine,
		username: string,
		userId: string,
		avatarUrl?: string,
	) {
		SceneManager.engine = engine;
		this.user.username = username;
		this.user.userId = userId;
		this.user.avatarUrl = avatarUrl;
	}

	static toMainMenu() {
		return SceneManager.set(new MainMenuScene(SceneManager.engine));
	}

	static toGame(room: COLYSEUS.Room<GameState>, seed: number) {
		return SceneManager.set(new GameScene(this.engine, room, seed));
	}

	static toWaiting(room: COLYSEUS.Room<GameState>) {
		return SceneManager.set(new WaitingScreen(this.engine, room));
	}

	static toLobby() {
		return SceneManager.set(new LobbyScene(this.engine, this.user));
	}

	static toEndScreen(room: COLYSEUS.Room<GameState>) {
		return SceneManager.set(new EndingScreen(this.engine, room));
	}

	static async set(newScene: ManagedScene) {
		const transition = ++SceneManager.transitionSequence;
		try {
			await newScene.ready;
		} catch (error) {
			if (transition === SceneManager.transitionSequence)
				console.error('Scene failed to initialize', error);
			newScene.dispose();
			return;
		}
		if (transition !== SceneManager.transitionSequence) {
			newScene.dispose();
			return;
		}
		const previousScene = SceneManager.currentScene;
		SceneManager.currentScene = newScene;
		if (previousScene) previousScene.dispose();
	}

	static start() {
		this.engine.runRenderLoop(() => {
			this.currentScene?.render();
		});
	}

	static stop() {
		SceneManager.transitionSequence++;
		this.engine.stopRenderLoop();
		this.currentScene?.dispose();
		this.currentScene = undefined;
	}
}
