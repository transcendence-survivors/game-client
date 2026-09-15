import { Client } from '@colyseus/sdk';
import {
	GAME_ROOM_TYPE,
	normalizeRoomName,
	type GameRoomOptions,
	type GameState,
} from '@transcendence/game-shared';

export class NetworkManager {
	private readonly client: Client;

	constructor() {
		const host = window.location.hostname;
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
		return { roomName };
	}
}
