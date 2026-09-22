import { Client } from '@colyseus/sdk';
import {
	GAME_ROOM_TYPE,
	normalizeRoomName,
	type GameRoomOptions,
	type GameState,
} from '@transcendence/game-shared';
import type { UserInfos } from '../../../shared-package/src/utils/Types';

export class NetworkManager {
	private readonly client: Client;
	private readonly user: UserInfos;

	constructor(user: UserInfos) {
		const host = window.location.hostname;
		this.user = user;
		this.client = new Client(`ws://${host}:4000`);
	}

	getClient() {
		return this.client;
	}

	createRoom(rawName: string) {
		return this.client.create<GameState>(
			GAME_ROOM_TYPE,
			this.roomOptions(rawName),
		);
	}

	joinRoomByName(rawName: string) {
		return this.client.join<GameState>(
			GAME_ROOM_TYPE,
			this.roomOptions(rawName),
		);
	}

	private roomOptions(rawName: string): GameRoomOptions {
		const roomName = normalizeRoomName(rawName);
		if (!roomName) throw new Error('Empty room name');
		const user = this.user;
		return { roomName, user };
	}
}
