import * as BABYLON from '@babylonjs/core';
import * as GUI from '@babylonjs/gui';
import * as COLYSEUS from '@colyseus/sdk';
import {
	clearStoredRoom,
	NetworkManager,
	STORAGE_COLYSEUS_ROOM_ID_STR,
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
	titleIcon: GUI.TextBlock;
	titleText: GUI.TextBlock;
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

	private disposed = false;

	constructor(
		engine: BABYLON.Engine,
		user: UserInfos,
		gameSocketUrl: string,
	) {
		this.engine = engine;
		this.network = new NetworkManager(user, gameSocketUrl);
		this.user = user;
		this.scene = new BABYLON.Scene(this.engine);
		new BABYLON.FreeCamera('LobbyCam', BABYLON.Vector3.Zero(), this.scene);
		this.ready = this.show();
	}

	render() {
		this.scene.render();
	}

	async show() {
		if (await isDuplicateTab()) {
			sessionStorage.removeItem(STORAGE_COLYSEUS_TOKEN_ID_STR);
			sessionStorage.removeItem(STORAGE_COLYSEUS_ROOM_ID_STR);
			SceneManager.toLobby();
			return;
		}
		if (await this.tryReconnect()) return;
		if (this.disposed) return;
		this.advTex = createFullscreenUi('LobbyUi', this.scene);
		const bg = await createBackgroundVideo(this.scene, () => this.disposed);
		if (!bg || this.disposed) return;
		this.videoTexture = bg.videoTexture;
		this.backgroundLayer = bg.backgroundLayer;
		await this.advTex.parseFromURLAsync(guiImports.lobby);
		if (this.disposed) return;
		this.applyTranslations();
		this.linkControls();
	}

	dispose() {
		this.disposed = true;
		if (this.videoTexture) this.videoTexture.dispose();
		if (this.backgroundLayer) this.backgroundLayer.dispose();
		if (this.advTex) this.advTex.dispose();
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

		try {
			const token = sessionStorage.getItem(STORAGE_COLYSEUS_TOKEN_ID_STR);
			if (!token) return false;
			this.room = await this.network.reconnect(token);
			if (this.disposed) {
				this.room.leave();
				return false;
			}
			await this.waitForState(this.room);
			if (this.room.state.started)
				await SceneManager.toGame(this.room, this.room.state.seed);
			else await SceneManager.toWaiting(this.room);
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
			titleIcon,
			titleText,
		} = getGuiControls<LobbyControls>(this.advTex, {
			input: 'RoomNameInput',
			createButton: 'ButtonCreate',
			joinButton: 'ButtonJoin',
			status: 'StatusText',
			profileImage: 'ProfileImage',
			profileUsername: 'ProfileUsername',
			profileDisplayname: 'ProfileDisplayName',
			titleIcon: 'TitleIcon',
			titleText: 'TitleText',
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
				const newRoom = create
					? await this.network.createRoom(roomName)
					: await this.network.joinRoomByName(roomName);
				if (newRoom) {
					this.room = newRoom;
				} else throw new Error('Could not find the room');
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

		const goBack = () => (window.location.href = '/game');

		titleIcon.onPointerUpObservable.add(goBack);
		titleText.onPointerUpObservable.add(goBack);
		createButton.onPointerUpObservable.add(() => enterRoom(true));
		joinButton.onPointerUpObservable.add(() => enterRoom(false));
	}

	private applyTranslations(): void {
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

const TAB_CHANNEL = 'transcendence-game-tab';
const PING_TIMEOUT_MS = 300;

const tabId = Math.random().toString(36).slice(2) + Date.now().toString(36);
const startedAt = Date.now();

let channel: BroadcastChannel | null = null;
let duplicate = false;
let olderTabSeen = false;

function ensureChannel() {
	if (channel || typeof BroadcastChannel === 'undefined') return;
	channel = new BroadcastChannel(TAB_CHANNEL);

	channel.onmessage = (e) => {
		const { type, from, startedAt: otherStart } = e.data;
		if (from === tabId) return;

		if (type === 'ping') {
			if (!duplicate)
				channel?.postMessage({ type: 'pong', from: tabId, startedAt });
		} else if (type === 'pong') {
			if (
				otherStart < startedAt ||
				(otherStart === startedAt && from < tabId)
			)
				olderTabSeen = true;
		}
	};
}

export function isDuplicateTab(): Promise<boolean> {
	ensureChannel();
	if (!channel) return Promise.resolve(false);

	olderTabSeen = false;
	channel.postMessage({ type: 'ping', from: tabId, startedAt });

	return new Promise<boolean>((resolve) => {
		setTimeout(() => {
			duplicate = olderTabSeen;
			resolve(duplicate);
		}, PING_TIMEOUT_MS);
	});
}

export async function createBackgroundVideo(
	scene: BABYLON.Scene,
	isDisposed: () => boolean,
) {
	const video = document.createElement('video');
	video.muted = true;
	video.loop = true;
	video.playsInline = true;
	video.crossOrigin = 'anonymous';
	video.src = guiImports.testVideo;

	const loaded = await new Promise<boolean>((resolve) => {
		video.addEventListener('canplay', () => resolve(true), { once: true });
		video.addEventListener('error', () => resolve(false), { once: true });
	});

	if (!loaded || isDisposed()) {
		video.removeAttribute('src');
		video.load();
		return null;
	}
	const videoTexture = new BABYLON.VideoTexture(
		'menuTrailer',
		video,
		scene,
		true,
		false,
		BABYLON.VideoTexture.TRILINEAR_SAMPLINGMODE,
		{
			autoPlay: true,
			muted: true,
			loop: true,
			autoUpdateTexture: true,
		},
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
