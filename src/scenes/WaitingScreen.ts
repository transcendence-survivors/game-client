import * as BABYLON from '@babylonjs/core';
import * as GUI from '@babylonjs/gui';
import * as COLYSEUS from '@colyseus/sdk';
import type { GameState, Player } from '../../../shared-package/src';
import { iconsImport } from '../assets/icons';
import { guiImports } from '../assets/ui';
import { SceneManager } from './SceneManager';
import { gameI18n } from '../i18n';
import { setText } from '../i18n/gui';

export class WaitingScreen {
	private advTex!: GUI.AdvancedDynamicTexture;
	private scene: BABYLON.Scene;
	private engine: BABYLON.Engine;
	private room: COLYSEUS.Room<GameState>;
	public readonly ready: Promise<void>;

	constructor(engine: BABYLON.Engine, room: COLYSEUS.Room<GameState>) {
		this.engine = engine;
		this.room = room;
		this.room.onMessage('gameStart', ({ seed }: { seed: number }) =>
			SceneManager.toGame(this.room, seed),
		);
		this.scene = new BABYLON.Scene(this.engine);
		new BABYLON.FreeCamera(
			'EndingScreenCam',
			BABYLON.Vector3.Zero(),
			this.scene,
		);
		this.ready = this.show();
	}

	async render() {
		this.scene.render();
	}

	async show() {
		this.advTex = GUI.AdvancedDynamicTexture.CreateFullscreenUI(
			'WaitingScreen',
			true,
			this.scene,
		);
		this.advTex.idealWidth = 1920;
		this.advTex.idealHeight = 1080;
		this.advTex.renderAtIdealSize = true;
		await this.advTex.parseFromURLAsync(guiImports.waitingScreen);
		setText(this.advTex, 'Title', gameI18n.t('menu.title'));
		setText(this.advTex, 'ReadyText', gameI18n.t('waiting.notReady'));
		this.fillData();
		this.connectButton();
	}

	dispose() {
		this.advTex.dispose();
		this.scene.dispose();
	}

	private fillData() {
		const eventsCallbacks = COLYSEUS.getStateCallbacks(this.room);

		for (let i = 0; i < 4; i++) {
			this.setSlot(i + 1, null);
		}

		eventsCallbacks(this.room.state).players.onAdd((player) => {
			if (player.id) this.setSlot(player.id, player);

			eventsCallbacks(player).onChange(() => {
				if (player.id) this.setSlot(player.id, player);
			});
		});

		eventsCallbacks(this.room.state).players.onRemove((player) => {
			if (player.id) this.setSlot(player.id, null);
		});
	}

	private setSlot(slotId: number, player: Player | null) {
		const container = this.advTex.getControlByName(
			`Player_${slotId}`,
		) as GUI.Container;

		if (!container) return;

		if (!player) {
			container.isVisible = false;
			return;
		}
		container.isVisible = true;
		const pp = this.advTex.getControlByName(
			`ProfilePicture_${slotId}`,
		) as GUI.Image;

		const usernamePh = this.advTex.getControlByName(
			`Username_${slotId}`,
		) as GUI.TextBlock;

		const readyIndicator = this.advTex.getControlByName(
			`ReadyIndicator_${slotId}`,
		) as GUI.Image;

		if (!pp || !usernamePh || !readyIndicator) return;

		if (!player) {
			pp.source = iconsImport.ppPh;
			usernamePh.text = '';
			readyIndicator.source = iconsImport.notReadyIndicator;
			return;
		}
		if (player.avatarUrl === '') pp.source = iconsImport.ppPh;
		else pp.source = player.avatarUrl;

		const domImage = pp.domImage;
		if (domImage) {
			domImage.onerror = () => {
				pp.source = iconsImport.ppPh;
			};
		}
		usernamePh.text = player.username;
		readyIndicator.source = player.ready
			? iconsImport.readyIndicator
			: iconsImport.notReadyIndicator;
	}

	private connectButton() {
		const button = this.advTex.getControlByName(
			'ReadyButton',
		) as GUI.Button;

		const text = this.advTex.getControlByName('ReadyText') as GUI.TextBlock;
		// TODO
		button.onPointerDownObservable.add(() => {
			const player = this.room.state.players.get(this.room.sessionId);
			if (!player) {
				console.error(`Can't get player`);
				return;
			}
			const newReady = !player.ready;
			this.room.send('ready', newReady);
			text.text = gameI18n.t(
				newReady ? 'waiting.ready' : 'waiting.notReady',
			);
		});
	}
}
