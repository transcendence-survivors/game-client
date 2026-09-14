import * as BABYLON from '@babylonjs/core';
import * as GUI from '@babylonjs/gui';
import * as COLYSEUS from '@colyseus/sdk';
import { NetworkManager } from '../server/NetworkManager';
import { SceneManager } from '../scenes/SceneManager';
import { normalizeRoomName, type GameState } from '@transcendence/game-shared';
import { createFullscreenUi, getGuiControls, guiImports } from '../assets/ui';
import { gameI18n } from '../i18n';
import { setInputPlaceholder, setText } from '../i18n/gui';

interface LobbyControls {
	input: GUI.InputText;
	createButton: GUI.Button;
	joinButton: GUI.Button;
	status: GUI.TextBlock;
}

export class LobbyScene {
	private scene: BABYLON.Scene;
	private advTex!: GUI.AdvancedDynamicTexture;
	private network: NetworkManager = new NetworkManager();
	private engine: BABYLON.Engine;
	private room!: COLYSEUS.Room<GameState>;
	public readonly ready: Promise<void>;

	constructor(engine: BABYLON.Engine) {
		this.engine = engine;
		this.scene = new BABYLON.Scene(this.engine);
		new BABYLON.FreeCamera('LobbyCam', BABYLON.Vector3.Zero(), this.scene);
		this.ready = this.show();
	}

	render() {
		this.scene.render();
	}

	async show() {
		this.advTex = createFullscreenUi('LobbyUi', this.scene);
		await this.advTex.parseFromURLAsync(guiImports.lobby);
		this.applyTranslations();
		this.linkControls();
	}

	dispose() {
		this.advTex.dispose();
		this.scene.dispose();
	}

	private linkControls() {
		const { input, createButton, joinButton, status } =
			getGuiControls<LobbyControls>(this.advTex, {
				input: 'RoomNameInput',
				createButton: 'ButtonCreate',
				joinButton: 'ButtonJoin',
				status: 'StatusText',
			});

		const setStatus = (text: string) => {
			status.text = text;
		};

		const setBusy = (busy: boolean) => {
			createButton.isEnabled = !busy;
			joinButton.isEnabled = !busy;
			input.isEnabled = !busy;
		};

		const getRoomName = () => {
			const roomName = normalizeRoomName(input.text);
			if (!roomName) {
				setStatus(gameI18n.t('lobby.enterRoomName'));
				return null;
			}
			return roomName;
		};

		const enterRoom = async (create: boolean) => {
			const roomName = getRoomName();
			if (!roomName) return;
			setBusy(true);
			setStatus(
				gameI18n.t(create ? 'lobby.creatingRoom' : 'lobby.joiningRoom'),
			);
			try {
				this.room = create
					? await this.network.createRoom(roomName)
					: await this.network.joinRoomByName(roomName);
				setStatus(
					create
						? gameI18n.t('lobby.roomCreated', { roomName })
						: gameI18n.t('lobby.roomJoined', { roomName }),
				);
				setBusy(false);
				if (this.room) {
					await SceneManager.toWaiting(this.room);
				}
			} catch (error) {
				console.error('Room connection failed', error);
				setStatus(
					gameI18n.t(
						create
							? 'lobby.createRoomFailed'
							: 'lobby.joinRoomFailed',
					),
				);
			}
		};

		createButton.onPointerUpObservable.add(() => enterRoom(true));
		joinButton.onPointerUpObservable.add(() => enterRoom(false));
	}

	private applyTranslations(): void {
		setText(this.advTex, 'Title', gameI18n.t('lobby.title'));
		setText(
			this.advTex,
			'ButtonCreate_button',
			gameI18n.t('lobby.createRoom'),
		);
		setText(this.advTex, 'ButtonJoin_button', gameI18n.t('lobby.joinRoom'));
		setInputPlaceholder(
			this.advTex,
			'RoomNameInput',
			gameI18n.t('lobby.roomNamePlaceholder'),
		);
	}
}
