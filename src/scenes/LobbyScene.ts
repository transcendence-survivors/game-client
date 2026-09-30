import * as BABYLON from '@babylonjs/core';
import * as GUI from '@babylonjs/gui';
import * as COLYSEUS from '@colyseus/sdk';
import {
	clearStoredRoom,
	NetworkManager,
	STORAGE_COLYSEUS_TOKEN_ID_STR,
} from '../server/NetworkManager';
import { SceneManager } from '../scenes/SceneManager';
import { normalizeRoomName, type GameState } from '@transcendence/game-shared';
import { createFullscreenUi, getGuiControls, guiImports } from '../assets/ui';
import { gameI18n } from '../i18n';
import { setInputPlaceholder, setText } from '../i18n/gui';
import type { UserInfos } from '../../../shared-package/src/utils/Types';
import { iconsImport } from '../assets/icons';

interface LobbyControls {
	input: GUI.InputText;
	createButton: GUI.Button;
	joinButton: GUI.Button;
	status: GUI.TextBlock;
	profileImage: GUI.Image;
	profileUsername: GUI.TextBlock;
	profileDisplayname: GUI.TextBlock;
}

export class LobbyScene {
	private scene: BABYLON.Scene;
	private advTex!: GUI.AdvancedDynamicTexture;
	private network!: NetworkManager;
	private engine: BABYLON.Engine;
	private room!: COLYSEUS.Room<GameState>;
	public readonly ready: Promise<void>;

	private backgroundLayer!: BABYLON.Layer;
	private videoTexture!: BABYLON.VideoTexture;

	private reconnecting: boolean = false;
	private user: UserInfos;

	constructor(engine: BABYLON.Engine, user: UserInfos) {
		this.engine = engine;
		this.network = new NetworkManager(user);
		this.user = user;
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
		const { videoTexture, backgroundLayer } = createBackgroundVideo(
			this.scene,
		);
		this.videoTexture = videoTexture;
		this.backgroundLayer = backgroundLayer;
		await this.advTex.parseFromURLAsync(guiImports.lobby);
		this.applyTranslations();
		this.linkControls();
	}

	dispose() {
		if (this.advTex) this.advTex.dispose();
		if (this.videoTexture) this.videoTexture.dispose();
		if (this.backgroundLayer) this.backgroundLayer.dispose();
		if (this.scene) this.scene.dispose();
	}

	private async waitForState(room: COLYSEUS.Room<GameState>) {
		return new Promise<void>((resolve) => {
			if (room.state?.seed) return resolve();
			room.onStateChange.once(() => resolve());
		});
	}

	private async tryReconnect() {
		if (this.reconnecting) return false;
		this.reconnecting = true;
		console.log('Reconnecting');

		try {
			const token = sessionStorage.getItem(STORAGE_COLYSEUS_TOKEN_ID_STR);
			if (!token) return false;
			console.log(`Trying to reconect using ${token}`);
			this.room = await this.network.reconnect(token);
			await this.waitForState(this.room);
			await SceneManager.toGame(this.room, this.room.state.seed);
			return true;
		} catch (error) {
			console.warn('reconnect failed', error);
			clearStoredRoom();
			return false;
		} finally {
			this.reconnecting = false;
		}
	}

	private linkControls() {
		const {
			input,
			createButton,
			joinButton,
			status,
			profileImage,
			profileDisplayname,
			profileUsername,
		} = getGuiControls<LobbyControls>(this.advTex, {
			input: 'RoomNameInput',
			createButton: 'ButtonCreate',
			joinButton: 'ButtonJoin',
			status: 'StatusText',
			profileImage: 'ProfileImage',
			profileUsername: 'ProfileUsername',
			profileDisplayname: 'ProfileDisplayName',
		});

		profileDisplayname.text = this.user.displayName;
		profileUsername.text = `@${this.user.username}`;
		profileImage.source = this.user.avatarUrl || iconsImport.ppPh;

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
