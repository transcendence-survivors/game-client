import { Client, Room } from '@colyseus/sdk';
import {
	GAME_ROOM_TYPE,
	normalizeRoomName,
	type GameRoomOptions,
	type GameState,
} from '@transcendence/game-shared';
import type { UserInfos } from '../../../shared-package/src/utils/Types';

export const STORAGE_COLYSEUS_TOKEN_ID_STR = 'colyseus_reconnection_token';
export const STORAGE_COLYSEUS_ROOM_ID_STR = 'colyseus_room_id';

export class NetworkManager {
	private readonly client: Client;
	private readonly user: UserInfos;

	constructor(user: UserInfos, gameSocketUrl: string) {
		this.user = user;
		this.client = new Client(gameSocketUrl);
	}

	async enterRoom(rawName: string, create: boolean) {
		try {
			return persistRoom(
				await this.client[create ? 'create' : 'join']<GameState>(
					GAME_ROOM_TYPE,
					this.roomOptions(rawName),
				),
			);
		} catch (error) {}
	}

	async reconnect(token: string) {
		return persistRoom(await this.client.reconnect<GameState>(token));
	}

	private roomOptions(rawName: string): GameRoomOptions {
		const roomName = normalizeRoomName(rawName);
		if (!roomName) throw new Error('Empty room name');
		const user = this.user;
		return { roomName, user };
	}
}

const lastInitSeq = new WeakMap<Room<any>, number>();
const initSeqListeners = new WeakMap<Room<any>, Set<(seq: number) => void>>();

export function clearStoredRoom() {
	sessionStorage.removeItem(STORAGE_COLYSEUS_TOKEN_ID_STR);
	sessionStorage.removeItem(STORAGE_COLYSEUS_ROOM_ID_STR);
}

export function persistRoom<T>(room: Room<T>): Room<T> {
	const loose = room as Room<any>;
	loose.reconnection.maxRetries = 0;
	const save = () => {
		sessionStorage.setItem(
			STORAGE_COLYSEUS_TOKEN_ID_STR,
			loose.reconnectionToken,
		);
		sessionStorage.setItem(STORAGE_COLYSEUS_ROOM_ID_STR, loose.roomId);
	};
	save();
	loose.onReconnect(save);
	loose.onLeave((code) => {
		if (code === 1000) clearStoredRoom();
	});

	loose.onMessage('initSeq', (seq: number) => {
		lastInitSeq.set(loose, seq);
		initSeqListeners.get(loose)?.forEach((cb) => cb(seq));
	});
	return room;
}

export function watchInitSeq(room: Room<GameState>, cb: (seq: number) => void) {
	let listeners = initSeqListeners.get(room);
	if (!listeners) {
		listeners = new Set();
		initSeqListeners.set(room, listeners);
	}
	listeners.add(cb);

	const cached = lastInitSeq.get(room);
	if (cached !== undefined) cb(cached);

	return () => {
		listeners!.delete(cb);
	};
}
