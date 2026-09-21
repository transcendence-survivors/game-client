import * as GUI from '@babylonjs/gui';
import * as BABYLON from '@babylonjs/core';
import * as COLYSEUS from '@colyseus/sdk';
import type { GameState } from '../../../shared-package/src';
import { guiImports } from '../assets/ui';
import { SceneManager } from './SceneManager';
import { gameI18n } from '../i18n';
import { setText } from '../i18n/gui';
import { formatGameTime } from '../hud/HudFormatting';
import { readStatValue, STAT_DEFS } from '../hud/StatDefinitions';

export class EndingScreen {
	private advTex!: GUI.AdvancedDynamicTexture;
	private engine: BABYLON.Engine;
	private room!: COLYSEUS.Room<GameState>;
	private scene: BABYLON.Scene;
	public readonly ready: Promise<void>;

	constructor(engine: BABYLON.Engine, room: COLYSEUS.Room<GameState>) {
		this.engine = engine;
		this.scene = new BABYLON.Scene(this.engine);
		new BABYLON.FreeCamera(
			'EndingScreenCam',
			BABYLON.Vector3.Zero(),
			this.scene,
		);
		this.room = room;
		this.ready = this.show();
	}

	async render() {
		this.scene.render();
	}

	async show() {
		this.advTex = GUI.AdvancedDynamicTexture.CreateFullscreenUI(
			'EndingScreen',
			true,
			this.scene,
		);
		this.advTex.idealWidth = 1920;
		this.advTex.idealHeight = 1080;
		this.advTex.renderAtIdealSize = true;
		await this.advTex.parseFromURLAsync(guiImports.endingScreen);
		setText(this.advTex, 'GameOver', gameI18n.t('ending.gameOver'));
		setText(this.advTex, 'BTL_txt', gameI18n.t('ending.backToLobby'));
		this.fillStats();
		this.connectButton();
	}

	dispose() {
		this.advTex.dispose();
		this.scene.dispose();
	}

	private fillStats() {
		const stats = this.room.state.players.get(this.room.sessionId)?.stats;
		if (!stats) {
			return;
		}
		STAT_DEFS.forEach((def, i) => {
			const icon = this.advTex.getControlByName(
				`Stat_${i + 1}_img`,
			) as GUI.Image | null;

			const text = this.advTex.getControlByName(
				`Stat_${i + 1}_txt`,
			) as GUI.TextBlock | null;

			if (!icon || !text) {
				return;
			}

			icon.source = def.icon;
			const value = readStatValue(stats, def);
			text.text = `${gameI18n.t(def.labelKey)}: ${value}`;
		});

		const kills = this.advTex.getControlByName('Kills') as GUI.TextBlock;
		if (!kills) return;
		kills.text = `${gameI18n.t('stats.kills')}: ${stats.killAmount}`;

		const time = this.advTex.getControlByName('Time') as GUI.TextBlock;
		if (!time) return;
		time.text = `${gameI18n.t('hud.survivalTime')}: ${formatGameTime(this.room.state.combatTimeS)}`;
	}

	private connectButton() {
		const button = this.advTex.getControlByName(
			'BackToLobby',
		) as GUI.Button;

		button.onPointerDownObservable.add(() => SceneManager.toLobby());
	}
}
