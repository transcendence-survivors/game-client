import * as BABYLON from '@babylonjs/core';
import * as GUI from '@babylonjs/gui';
import * as COLYSEUS from '@colyseus/sdk';
import { NetworkManager } from '../server/NetworkManager';
import { SceneManager } from '../scenes/SceneManager';
import { normalizeRoomName, type GameState } from '@transcendence/game-shared';
import { createFullscreenUi, getGuiControls, guiImports } from '../assets/ui';
import { GAME_LOCALES, gameI18n, type GameLocale } from '../i18n';
import { setInputPlaceholder, setText } from '../i18n/gui';
import type { UserInfos } from '../../../shared-package/src/utils/Types';

interface LobbyControls {
	input: GUI.InputText;
	createButton: GUI.Button;
	joinButton: GUI.Button;
	status: GUI.TextBlock;
}

export const STORAGE_COLYSEUS_TOKEN_ID_STR = 'colyseus_reconnection_token';
export const STORAGE_COLYSEUS_ROOM_ID_STR = 'colyseus_room_id';

export class LobbyScene {
	private scene: BABYLON.Scene;
	private advTex!: GUI.AdvancedDynamicTexture;
	private network!: NetworkManager;
	private engine: BABYLON.Engine;
	private room!: COLYSEUS.Room<GameState>;
	public readonly ready: Promise<void>;
	//TODO
	private backgroundLayer!: BABYLON.Layer;
	private videoTexture!: BABYLON.VideoTexture;
	//

	private reconnecting: boolean = false;

	constructor(engine: BABYLON.Engine, user: UserInfos) {
		this.engine = engine;
		this.network = new NetworkManager(user);
		this.scene = new BABYLON.Scene(this.engine);
		new BABYLON.FreeCamera('LobbyCam', BABYLON.Vector3.Zero(), this.scene);
		this.ready = this.show();
	}

	render() {
		this.scene.render();
	}

	async show() {
		if (await this.tryReconnect()) return;
		this.advTex = createFullscreenUi('LobbyUi', this.scene);
		// TODO
		const { videoTexture, backgroundLayer } = createBackgroundVideo(
			this.scene,
		);
		this.videoTexture = videoTexture;
		this.backgroundLayer = backgroundLayer;
		//
		await this.advTex.parseFromURLAsync(guiImports.lobby);
		this.applyTranslations();
		this.linkControls();
	}

	dispose() {
		if (this.advTex) this.advTex.dispose();
		//TODO
		if (this.videoTexture) this.videoTexture.dispose();
		if (this.backgroundLayer) this.backgroundLayer.dispose();
		//
		if (this.scene) this.scene.dispose();
	}

	private async tryReconnect() {
		if (this.reconnecting) return false;
		this.reconnecting = true;

		try {
			const token = sessionStorage.getItem(STORAGE_COLYSEUS_TOKEN_ID_STR);
			if (!token) return false;
			this.room = await this.network.getClient().reconnect(token);
			sessionStorage.setItem(
				STORAGE_COLYSEUS_TOKEN_ID_STR,
				this.room.reconnectionToken,
			);
			sessionStorage.setItem(
				STORAGE_COLYSEUS_ROOM_ID_STR,
				this.room.roomId,
			);

			await SceneManager.toGame(this.room, this.room.state.seed);
			return true;
		} catch (error) {
			sessionStorage.removeItem(STORAGE_COLYSEUS_TOKEN_ID_STR);
			sessionStorage.removeItem(STORAGE_COLYSEUS_ROOM_ID_STR);
			return false;
		} finally {
			this.reconnecting = false;
		}
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
				sessionStorage.setItem(
					STORAGE_COLYSEUS_TOKEN_ID_STR,
					this.room.reconnectionToken,
				);
				sessionStorage.setItem(
					STORAGE_COLYSEUS_ROOM_ID_STR,
					this.room.roomId,
				);
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
				console.warn('Room connection failed', error);
				setStatus(
					gameI18n.t(
						create
							? 'lobby.createRoomFailed'
							: 'lobby.joinRoomFailed',
					),
				);
				setBusy(false);
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

//TODO
function createBackgroundVideo(scene: BABYLON.Scene) {
	const videoTexture = new BABYLON.VideoTexture(
		'menuTrailer',
		guiImports.testVideo,
		scene,
		true,
		false,
		BABYLON.VideoTexture.TRILINEAR_SAMPLINGMODE,
		{ autoPlay: true, muted: true, loop: true, autoUpdateTexture: true },
	);

	const backgroundLayer = new BABYLON.Layer(
		'menuBackground',
		null,
		scene,
		true,
	);
	backgroundLayer.texture = videoTexture;

	return { videoTexture, backgroundLayer };
}
//
