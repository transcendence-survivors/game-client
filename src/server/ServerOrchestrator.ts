import * as BABYLON from '@babylonjs/core';
import * as COLYSEUS from '@colyseus/sdk';
import { MapGenerator } from '../map/MapGenerator';
import type { AuraInstance } from '../map/effects/PlayerAuraPlugin';
import {
	simulatePlayerMovement,
	type GameState,
	type MoveInput,
	type MovementState,
	type MovementBoundary,
	type Player,
	ClientMessage,
	ServerMessage,
	type Vec3d,
	PLAYER_ACCESS_RADIUS,
	createMoveInput,
	createMovementState,
} from '@transcendence/game-shared';

import type { ModelAssetLibrary } from '../assets/ModelAssetLibrary';
import {
	createPlayerAnimationController,
	type PlayerAnimationController,
} from '../assets/PlayerAnimation';
import { models } from '../assets/models';
import { SceneManager } from '../scenes/SceneManager';
import { CombatRenderer } from '../combat/CombatRenderer';
import { CombatAssetLibrary } from '../combat/CombatAssetLibrary';
import { WeaponAttachmentRenderer } from '../combat/WeaponAttachmentRenderer';
import { AsyncViewRegistry } from '../combat/AsyncViewRegistry';
import { CleanupBag, CleanupRegistry } from '../CleanupBag';
import {
	STORAGE_COLYSEUS_ROOM_ID_STR,
	STORAGE_COLYSEUS_TOKEN_ID_STR,
} from '../scenes/LobbyScene';

class RemotePlayerView {
	readonly mesh: BABYLON.AbstractMesh;
	readonly animations: PlayerAnimationController;
	private moving: boolean | null = null;

	constructor(
		mesh: BABYLON.AbstractMesh,
		animations: PlayerAnimationController,
	) {
		this.mesh = mesh;
		this.animations = animations;
	}

	setMoving(moving: boolean): void {
		if (this.moving === moving) return;
		this.moving = moving;
		if (moving) this.animations.playWalk();
		else {
			this.animations.playIdle();
			this.mesh.rotation.z = 0;
		}
	}

	dispose(): void {
		this.animations.dispose();
		this.mesh.dispose();
	}
}

type AuthoritativeMovementState = Pick<
	Player,
	| 'x'
	| 'y'
	| 'z'
	| 'rotationY'
	| 'velocityY'
	| 'isGrounded'
	| 'lastProcessedSeq'
>;

interface ReconciliationSnapshot extends AuthoritativeMovementState {
	moveSpeed: number;
	pendingInputHead: number;
	pendingInputLength: number;
	pendingInputLastSeq: number | null;
}

type RemoteTarget = Vec3d & { rotationY: number };

function isAuthoritativeMovementState(
	state: Partial<AuthoritativeMovementState>,
): state is AuthoritativeMovementState {
	return (
		typeof state.x === 'number' &&
		typeof state.y === 'number' &&
		typeof state.z === 'number' &&
		typeof state.rotationY === 'number' &&
		typeof state.velocityY === 'number' &&
		typeof state.isGrounded === 'boolean' &&
		typeof state.lastProcessedSeq === 'number'
	);
}

export class ServerOrchestrator {
	private readonly scene: BABYLON.Scene;
	private readonly remoteTargets = new Map<string, RemoteTarget>();
	private readonly remotePlayers = new AsyncViewRegistry<RemotePlayerView>();
	private mapGen!: MapGenerator;
	private readonly room: COLYSEUS.Room<GameState>;
	private player!: BABYLON.AbstractMesh;
	private combatRenderer!: CombatRenderer;
	private weaponAttachments!: WeaponAttachmentRenderer;
	private combatAssets!: CombatAssetLibrary;
	private readonly pendingInputs: MoveInput[] = [];
	private readonly recycledInputs: MoveInput[] = [];
	private pendingInputHead = 0;
	private readonly unsentPredictionInput = createMoveInput();
	private readonly playerAssets: ModelAssetLibrary;
	private combatHitboxesVisible = false;
	private readonly auras: AuraInstance[] = [];
	private readonly subscriptions = new CleanupBag();
	private readonly playerSubscriptions = new CleanupRegistry<string>();
	private gameOverHandled = false;
	private movementState: MovementState = createMovementState();
	private readonly reconciliationState = createMovementState();
	private readonly movementBoundary: MovementBoundary = {
		centerX: 0,
		centerZ: 0,
		radius: PLAYER_ACCESS_RADIUS,
	};
	private readonly lastReconciliation: ReconciliationSnapshot = {
		x: 0,
		y: 0,
		z: 0,
		rotationY: 0,
		velocityY: 0,
		isGrounded: true,
		lastProcessedSeq: 0,
		moveSpeed: 0,
		pendingInputHead: 0,
		pendingInputLength: 0,
		pendingInputLastSeq: null,
	};
	private hasLastReconciliation = false;

	constructor(
		scene: BABYLON.Scene,
		room: COLYSEUS.Room<GameState>,
		playerAssets: ModelAssetLibrary,
	) {
		this.scene = scene;
		this.room = room;
		this.playerAssets = playerAssets;
	}

	setPlayer(player: BABYLON.AbstractMesh) {
		this.player = player;
		this.hasLastReconciliation = false;
		this.weaponAttachments.attachToPlayer(this.room.sessionId);
	}

	sendMovementInput(input: MoveInput): void {
		const pending = this.recycledInputs.pop() ?? { ...input };
		Object.assign(pending, input);
		this.pendingInputs.push(pending);
		this.room.send(ClientMessage.Move, pending);
	}

	setUnsentPrediction(input: MoveInput, deltaTime: number) {
		const pending = this.unsentPredictionInput;
		pending.forward = input.forward;
		pending.backward = input.backward;
		pending.right = input.right;
		pending.left = input.left;
		pending.jump = false;
		pending.deltaTime = deltaTime;
		pending.cameraYaw = input.cameraYaw;
	}

	setCombatHitboxesVisible(visible: boolean) {
		this.combatHitboxesVisible = visible;
		this.combatRenderer?.setHitboxesVisible(visible);
	}

	setDebugImmortal(enabled: boolean) {
		this.room.send(ClientMessage.SetDebugImmortal, { enabled });
	}

	setMonsterStressTest(enabled: boolean) {
		this.room.send(ClientMessage.SetDebugMonsterStress, { enabled });
	}

	getMovementState() {
		return this.movementState;
	}

	setMovementState(state: MovementState) {
		this.movementState = state;
	}

	private async addRemotePlayer(sessionId: string) {
		await this.remotePlayers.add(sessionId, async () => {
			const result = await this.playerAssets.instantiate(
				models.player,
				`remotePlayer:${sessionId}`,
			);
			const model = result.root;
			model.rotationQuaternion = null;
			const animations = createPlayerAnimationController(
				model,
				result.animationGroups,
			);
			animations.playIdle();
			this.mapGen.prepareRenderable(model);
			return new RemotePlayerView(model, animations);
		});
		const view = this.remotePlayers.get(sessionId);
		if (!view) return null;
		this.weaponAttachments.attachToPlayer(sessionId);
		return view;
	}

	updateRemotePlayers(deltaTime: number) {
		const lerpFactor = Math.min(1, deltaTime * 10);
		this.remotePlayers.forEach(({ mesh }, sessionId) => {
			const target = this.remoteTargets.get(sessionId);
			if (!target) return;
			mesh.position.x = BABYLON.Scalar.Lerp(
				mesh.position.x,
				target.x,
				lerpFactor,
			);
			mesh.position.y = BABYLON.Scalar.Lerp(
				mesh.position.y,
				target.y,
				lerpFactor,
			);
			mesh.position.z = BABYLON.Scalar.Lerp(
				mesh.position.z,
				target.z,
				lerpFactor,
			);
			const targetRotation = target.rotationY + Math.PI;
			mesh.rotation.y = BABYLON.Scalar.LerpAngle(
				mesh.rotation.y,
				targetRotation,
				lerpFactor,
			);
		});
	}

	private removeRemotePlayer(sessionId: string) {
		this.weaponAttachments.removePlayer(sessionId);
		this.remotePlayers.remove(sessionId);
		this.remoteTargets.delete(sessionId);
	}

	async connect(seed: number) {
		this.mapGen = new MapGenerator(this.scene, seed);
		this.combatAssets = new CombatAssetLibrary(this.scene, this.mapGen);
		this.weaponAttachments = new WeaponAttachmentRenderer(
			this.combatAssets,
		);
		this.combatRenderer = new CombatRenderer(
			this.scene,
			this.room,
			this.combatAssets,
			this.weaponAttachments,
		);
		this.combatRenderer.listen();
		this.combatRenderer.setHitboxesVisible(this.combatHitboxesVisible);
		this.subscriptions.add(
			this.room.onMessage(ServerMessage.GameOver, () => {
				if (this.gameOverHandled) return;
				this.gameOverHandled = true;
				sessionStorage.removeItem(STORAGE_COLYSEUS_ROOM_ID_STR);
				sessionStorage.removeItem(STORAGE_COLYSEUS_TOKEN_ID_STR);
				document.exitPointerLock();
				SceneManager.toEndScreen(this.room);
			}),
		);
	}

	getMapGen() {
		return this.mapGen;
	}

	getRoom() {
		return this.room;
	}

	collectAuras(): AuraInstance[] {
		let count = 0;
		const players = this.room.state?.players;
		if (!players) {
			this.auras.length = 0;
			return this.auras;
		}
		players.forEach((player, sessionId) => {
			const aura = player.aura;
			if (!aura || aura.radius <= 0) return;
			let x = player.x;
			let z = player.z;
			if (sessionId === this.room.sessionId) {
				if (this.player) {
					x = this.player.position.x;
					z = this.player.position.z;
				}
			} else {
				const view = this.remotePlayers.get(sessionId);
				if (view) {
					x = view.mesh.position.x;
					z = view.mesh.position.z;
				}
			}
			const output = this.auras[count++];
			if (output) {
				output.x = x;
				output.z = z;
				output.radius = aura.radius;
				output.attackSpeed = aura.attackSpeed;
			} else
				this.auras.push({
					x,
					z,
					radius: aura.radius,
					attackSpeed: aura.attackSpeed,
				});
		});
		this.auras.length = count;
		return this.auras;
	}

	getLocalSpawn(): Vec3d | null {
		const player = this.room.state?.players?.get(this.room.sessionId);
		if (
			!player ||
			typeof player.x !== 'number' ||
			typeof player.y !== 'number' ||
			typeof player.z !== 'number'
		)
			return null;
		return { x: player.x, y: player.y, z: player.z };
	}

	private reconcile(serverState: Partial<AuthoritativeMovementState>) {
		if (!this.player || !isAuthoritativeMovementState(serverState)) return;
		const authoritativeState = serverState;
		const player = this.room.state.players.get(this.room.sessionId);
		if (!player) return;
		const moveSpeed = player.stats.moveSpeed;
		if (this.isDuplicateReconciliation(authoritativeState, moveSpeed))
			return;
		let acknowledged = this.pendingInputHead;
		while (
			this.pendingInputs[acknowledged]?.seq <=
			authoritativeState.lastProcessedSeq
		)
			acknowledged++;
		this.discardAcknowledgedInputs(acknowledged);

		const state = this.reconciliationState;
		state.x = authoritativeState.x;
		state.y = authoritativeState.y;
		state.z = authoritativeState.z;
		state.rotationY = authoritativeState.rotationY;
		state.velocityY = authoritativeState.velocityY;
		state.isGrounded = authoritativeState.isGrounded;

		const world = this.mapGen.getWorld();
		this.movementBoundary.centerX = this.room.state.rayX;
		this.movementBoundary.centerZ = this.room.state.rayZ;

		for (
			let index = this.pendingInputHead;
			index < this.pendingInputs.length;
			index++
		) {
			const input = this.pendingInputs[index];
			simulatePlayerMovement(
				world,
				state,
				input,
				player.stats.moveSpeed,
				state,
				this.movementBoundary,
			);
		}
		if (this.unsentPredictionInput.deltaTime > 0)
			simulatePlayerMovement(
				world,
				state,
				this.unsentPredictionInput,
				player.stats.moveSpeed,
				state,
				this.movementBoundary,
			);
		this.movementState = state;
		this.player.position.x = state.x;
		this.player.position.y = state.y;
		this.player.position.z = state.z;
		this.player.rotation.y = state.rotationY;
		const snapshot = this.lastReconciliation;
		snapshot.x = authoritativeState.x;
		snapshot.y = authoritativeState.y;
		snapshot.z = authoritativeState.z;
		snapshot.rotationY = authoritativeState.rotationY;
		snapshot.velocityY = authoritativeState.velocityY;
		snapshot.isGrounded = authoritativeState.isGrounded;
		snapshot.lastProcessedSeq = authoritativeState.lastProcessedSeq;
		snapshot.moveSpeed = moveSpeed;
		snapshot.pendingInputHead = this.pendingInputHead;
		snapshot.pendingInputLength = this.pendingInputs.length;
		snapshot.pendingInputLastSeq =
			this.pendingInputs[this.pendingInputs.length - 1]?.seq ?? null;
		this.hasLastReconciliation = true;
	}

	private isDuplicateReconciliation(
		serverState: AuthoritativeMovementState,
		moveSpeed: number,
	): boolean {
		if (!this.hasLastReconciliation) return false;
		const previous = this.lastReconciliation;
		return (
			Object.is(previous.x, serverState.x) &&
			Object.is(previous.y, serverState.y) &&
			Object.is(previous.z, serverState.z) &&
			Object.is(previous.rotationY, serverState.rotationY) &&
			Object.is(previous.velocityY, serverState.velocityY) &&
			previous.isGrounded === serverState.isGrounded &&
			Object.is(
				previous.lastProcessedSeq,
				serverState.lastProcessedSeq,
			) &&
			Object.is(previous.moveSpeed, moveSpeed) &&
			previous.pendingInputHead === this.pendingInputHead &&
			previous.pendingInputLength === this.pendingInputs.length &&
			previous.pendingInputLastSeq ===
				(this.pendingInputs[this.pendingInputs.length - 1]?.seq ?? null)
		);
	}

	listenToState() {
		const callbacks = COLYSEUS.Callbacks.get(this.room);
		this.subscriptions.add(
			callbacks.onAdd('players', async (player, sessionId) => {
				const subscriptions =
					this.playerSubscriptions.replace(sessionId);
				if (sessionId === this.room.sessionId) {
					if (!this.player) return;
					this.listenToWeapons(
						callbacks,
						player,
						sessionId,
						() => this.player,
						subscriptions,
					);
					this.reconcile(player);
					subscriptions.add(
						callbacks.onChange(player, () =>
							this.reconcile(player),
						),
					);
				} else {
					const view = await this.addRemotePlayer(sessionId);
					if (
						!view ||
						!this.playerSubscriptions.isCurrent(
							sessionId,
							subscriptions,
						)
					)
						return;
					const mesh = view.mesh;
					this.listenToWeapons(
						callbacks,
						player,
						sessionId,
						() => mesh,
						subscriptions,
					);
					this.setRemoteTarget(sessionId, player);
					mesh.position.x = player.x;
					mesh.position.z = player.z;
					mesh.position.y = this.mapGen.getGroundHeight(
						player.x,
						player.z,
					);
					mesh.rotation.y = player.rotationY + Math.PI;
					view.setMoving(player.animState === 'moving');
					subscriptions.add(
						callbacks.onChange(player, () => {
							this.setRemoteTarget(sessionId, player);
							view.setMoving(player.animState === 'moving');
						}),
					);
				}
			}),
		);
		this.subscriptions.add(
			callbacks.onRemove('players', (_player, sessionId) => {
				this.playerSubscriptions.delete(sessionId);
				if (sessionId !== this.room.sessionId)
					this.removeRemotePlayer(sessionId);
			}),
		);
	}

	private listenToWeapons(
		callbacks: ReturnType<typeof COLYSEUS.Callbacks.get<GameState>>,
		player: Player,
		sessionId: string,
		getMesh: () => BABYLON.AbstractMesh,
		subscriptions: CleanupBag,
	): void {
		subscriptions.add(
			callbacks.onAdd(player, 'weapons', (weapon) =>
				this.weaponAttachments.attachWeapon(
					sessionId,
					getMesh(),
					weapon.kind,
				),
			),
		);
	}

	private setRemoteTarget(sessionId: string, player: Player): void {
		const { x, y, z, rotationY } = player;
		const target = this.remoteTargets.get(sessionId);
		if (target) {
			target.x = x;
			target.y = y;
			target.z = z;
			target.rotationY = rotationY;
		} else this.remoteTargets.set(sessionId, { x, y, z, rotationY });
	}

	private discardAcknowledgedInputs(head: number): void {
		for (let index = this.pendingInputHead; index < head; index++)
			this.recycledInputs.push(this.pendingInputs[index]);
		if (head === this.pendingInputs.length) {
			this.pendingInputs.length = 0;
			this.pendingInputHead = 0;
		} else if (head >= 64 && head * 2 >= this.pendingInputs.length) {
			this.pendingInputs.copyWithin(0, head);
			this.pendingInputs.length -= head;
			this.pendingInputHead = 0;
		} else this.pendingInputHead = head;
	}

	dispose() {
		this.subscriptions.dispose();
		this.playerSubscriptions.dispose();
		this.combatRenderer?.dispose();
		this.weaponAttachments?.dispose();
		this.combatAssets?.dispose();
		this.remotePlayers.dispose();
		this.remoteTargets.clear();
		this.pendingInputs.length = 0;
		this.recycledInputs.length = 0;
		this.pendingInputHead = 0;
		this.unsentPredictionInput.deltaTime = 0;
		this.hasLastReconciliation = false;
	}
}
