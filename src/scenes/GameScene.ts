import type { Engine, Scene } from '@babylonjs/core';
import * as BABYLON from '@babylonjs/core';
import * as COLYSEUS from '@colyseus/sdk';
import '@babylonjs/loaders/glTF/2.0';
import { InputManager } from '../server/InputManager';
import { MapGenerator } from '../map/MapGenerator';
import { DebugMenu } from '../hud/DebugMenu';
import { ServerOrchestrator } from '../server/ServerOrchestrator';
import { ForestRenderer } from '../map/nature/ForestRenderer';
import { MonsterRenderer } from '../monsters';

import {
	type MovementBoundary,
	GameState,
	MAX_DT,
	PLAYER_ACCESS_RADIUS,
	createMoveInput,
	createMovementState,
	getCameraYaw,
	simulatePlayerMovement,
} from '@transcendence/game-shared';
import { SettingsMenuRender } from '../settings/SettingsMenuRender';
import { ModelAssetLibrary } from '../assets/ModelAssetLibrary';
import {
	createPlayerAnimationController,
	type PlayerAnimationController,
} from '../assets/PlayerAnimation';
import { models } from '../assets/models';
import { Hud } from '../hud/Hud';
import { LevelUpMenu } from '../hud/LevelUpMenu';
import { StatsPanel } from '../hud/StatsPanel';
import { RevivePrompt } from '../hud/RevivePrompt';

import {
	DEFAULT_KEY_BINDINGS,
	formatKeyLabel,
	KEY_ACTIONS,
	type KeyBindings,
} from '../settings/KeyBindings';

import { CleanupBag } from '../CleanupBag';
import { NetworkInputCadence } from '../performance/NetworkInputCadence';
import { LevelUpShaderEffect } from '../effects/LevelUpShaderEffect';
import { createGameMusic } from '../audio/GameMusic';

const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 600;
const CAMERA_RADIUS = 5;
const CAMERA_MIN_RADIUS = 2.5;
const CAMERA_GROUND_CLEARANCE = 0.8;
const CAMERA_PROBES = 8;
const CAMERA_RETURN_SPEED = 6;
const JOYSTICK_DEADZONE = 0.35;
export const STORAGE_KEY = 'game_keyBindings';

export class GameScene {
	private readonly cleanups = new CleanupBag();
	private disposed = false;
	private scene!: Scene;
	private readonly engine: Engine;
	private camera!: BABYLON.ArcRotateCamera;
	private input!: InputManager;
	private player!: BABYLON.AbstractMesh;
	private mapGen!: MapGenerator;
	private forest!: ForestRenderer;
	private debugMenu!: DebugMenu;
	private playerAssets!: ModelAssetLibrary;

	public keybinds: KeyBindings = { ...DEFAULT_KEY_BINDINGS };

	private settings!: SettingsMenuRender;

	private playerAnimations!: PlayerAnimationController;

	private seq = 0;
	private jumpKeyWasPressed = false;
	private readonly networkInputCadence = new NetworkInputCadence();
	private readonly simulationInput = createMoveInput();
	private readonly networkInput = createMoveInput();
	private readonly movementBoundary: MovementBoundary = {
		centerX: 0,
		centerZ: 0,
		radius: PLAYER_ACCESS_RADIUS,
	};

	private settingsKeyWasPressed = false;
	private statsKeyWasPressed = false;
	private reviveIntentSent = false;
	private lastReviveKey = '';
	private downedLastFrame = false;
	private readonly cameraForwardAxis = BABYLON.Vector3.Forward();
	private readonly cameraForward = BABYLON.Vector3.Zero();
	private cameraProbeInitialized = false;
	private lastProbeTargetX = Number.NaN;
	private lastProbeTargetY = Number.NaN;
	private lastProbeTargetZ = Number.NaN;
	private lastProbeAlpha = Number.NaN;
	private lastProbeBeta = Number.NaN;
	private desiredCameraRadius = CAMERA_RADIUS;
	private readonly nextMovementState = createMovementState();

	private server!: ServerOrchestrator;
	private monsters!: MonsterRenderer;
	private hud!: Hud;
	private statsPanel!: StatsPanel;
	private revivePrompt!: RevivePrompt;
	private levelUpMenu!: LevelUpMenu;
	public readonly ready: Promise<void>;

	private moveJoystick: BABYLON.VirtualJoystick | null = null; // to remove

	constructor(engine: Engine, room: COLYSEUS.Room<GameState>, seed: number) {
		this.engine = engine;
		this.ready = this.init(room, seed);
	}

	private async init(room: COLYSEUS.Room<GameState>, seed: number) {
		try {
			this.scene = this.track(new BABYLON.Scene(this.engine));
			const music = this.track(createGameMusic());
			this.createCamera();

			this.playerAssets = this.track(new ModelAssetLibrary(this.scene));
			this.defer(() => room.leave());
			this.server = this.track(
				new ServerOrchestrator(this.scene, room, this.playerAssets),
			);
			const seedReady = this.server.connect(seed);

			if (this.disposed) return;
			const urlParams = new URLSearchParams(window.location.search);
			this.debugMenu = this.track(
				new DebugMenu(
					this.engine,
					this.scene,
					(visible) => {
						this.monsters?.setHitboxesVisible(visible);
						this.server.setCombatHitboxesVisible(visible);
					},
					(enabled) => this.server.setDebugImmortal(enabled),
					!urlParams.has('noDebug'),
					(enabled) => this.server.setMonsterStressTest(enabled),
					() =>
						this.monsters?.getDebugStats() ?? {
							total: room.state.monsters.size,
							elites: 0,
							bosses: 0,
							rendered: 0,
						},
				),
			);

			await seedReady;
			if (this.disposed) return;
			this.mapGen = this.track(this.server.getMapGen());

			await this.addPlayer();
			if (this.disposed) return;

			this.server.setPlayer(this.player);
			this.track(new LevelUpShaderEffect(this.scene, this.player, room));
			this.forest = this.track(
				new ForestRenderer(this.scene, this.mapGen, this.playerAssets),
			);
			this.forest.update(this.player.position);
			this.input = this.track(new InputManager(this.scene));
			this.server.listenToState();
			this.monsters = this.track(
				new MonsterRenderer(this.scene, room, this.mapGen),
			);
			this.monsters.listen();
			const hitboxesVisible = this.debugMenu.areHitboxesVisible();
			this.monsters.setHitboxesVisible(hitboxesVisible);
			this.server.setCombatHitboxesVisible(hitboxesVisible);

			this.hud = this.track(new Hud(this.scene, room));
			this.statsPanel = this.track(new StatsPanel(this.scene, room));
			this.revivePrompt = this.track(
				new RevivePrompt(this.scene, room, (sessionId) =>
					this.server.getPlayerMesh(sessionId),
				),
			);
			this.levelUpMenu = this.track(new LevelUpMenu(this.scene, room));
			this.settings = this.track(
				new SettingsMenuRender(this.scene, this.camera),
			);
			await this.settings.ready;
			this.settings.close();
			this.keybinds = this.settings.getKeybindings();

			const canvas = this.scene.getEngine().getRenderingCanvas();
			canvas?.addEventListener('pointerdown', this.boundOnClick);
			document.addEventListener('mousemove', this.boundOnMouseMove);
			this.defer(() => {
				canvas?.removeEventListener('pointerdown', this.boundOnClick);
				document.removeEventListener(
					'mousemove',
					this.boundOnMouseMove,
				);
			});

			// To remove
			if (navigator.maxTouchPoints > 0) {
				this.moveJoystick = new BABYLON.VirtualJoystick(true);
				this.defer(() => {
					this.moveJoystick?.releaseCanvas();
					this.moveJoystick = null;
				});
			}
			//
			music.play();
			this.renderLoop();
		} catch (e) {
			this.dispose();
			throw e;
		}
	}

	render() {
		this.scene.render();
	}

	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		this.cleanups.dispose();
	}

	private createCamera() {
		this.camera = new BABYLON.ArcRotateCamera(
			'Player-Camera',
			-Math.PI / 2,
			1.0,
			CAMERA_RADIUS,
			new BABYLON.Vector3(0, 0, 0),
			this.scene,
		);
		this.camera.inputs.clear();
		this.camera.lowerBetaLimit = 0.2;
		this.camera.upperBetaLimit = 1.4;
		this.camera.lowerRadiusLimit = CAMERA_MIN_RADIUS;
		this.camera.upperRadiusLimit = CAMERA_RADIUS;
		this.camera.inertia = 0.85;
		this.camera.minZ = CAMERA_NEAR;
		this.camera.maxZ = CAMERA_FAR;
		this.scene.activeCamera = this.camera;
		this.camera.fov = 1.5;
	}

	private clampCameraToTerrain(deltaTime: number) {
		const target = this.camera.target;
		const targetChanged =
			!this.cameraProbeInitialized ||
			target.x !== this.lastProbeTargetX ||
			target.y !== this.lastProbeTargetY ||
			target.z !== this.lastProbeTargetZ ||
			this.camera.alpha !== this.lastProbeAlpha ||
			this.camera.beta !== this.lastProbeBeta;

		if (targetChanged) {
			const sinBeta = Math.sin(this.camera.beta);
			const dirX = Math.cos(this.camera.alpha) * sinBeta;
			const dirY = Math.cos(this.camera.beta);
			const dirZ = Math.sin(this.camera.alpha) * sinBeta;

			let radius = CAMERA_RADIUS;
			for (let i = 1; i <= CAMERA_PROBES; i++) {
				const probe = (CAMERA_RADIUS * i) / CAMERA_PROBES;
				const ground = this.mapGen.getGroundHeight(
					target.x + dirX * probe,
					target.z + dirZ * probe,
				);
				const clearance =
					(CAMERA_GROUND_CLEARANCE * probe) / CAMERA_RADIUS;
				if (target.y + dirY * probe < ground + clearance) {
					radius = (CAMERA_RADIUS * (i - 1)) / CAMERA_PROBES;
					break;
				}
			}
			this.desiredCameraRadius = Math.max(CAMERA_MIN_RADIUS, radius);
			this.lastProbeTargetX = target.x;
			this.lastProbeTargetY = target.y;
			this.lastProbeTargetZ = target.z;
			this.lastProbeAlpha = this.camera.alpha;
			this.lastProbeBeta = this.camera.beta;
			this.cameraProbeInitialized = true;
		}
		const desired = this.desiredCameraRadius;
		const nextRadius =
			desired < this.camera.radius
				? desired
				: BABYLON.Scalar.Lerp(
						this.camera.radius,
						desired,
						Math.min(1, deltaTime * CAMERA_RETURN_SPEED),
					);
		if (this.camera.radius !== nextRadius) this.camera.radius = nextRadius;
	}

	private track<T extends { dispose(): void }>(resource: T): T {
		this.defer(() => resource.dispose());
		return resource;
	}

	private defer(cleanup: () => void): void {
		this.cleanups.add(cleanup);
	}

	private renderLoop() {
		let lastTime = performance.now();
		this.scene.onBeforeRenderObservable.add(() => {
			const now = performance.now();
			const deltaTime = (now - lastTime) / 1000;
			lastTime = now;
			this.camera.getDirectionToRef(
				this.cameraForwardAxis,
				this.cameraForward,
			);
			const cameraYaw = getCameraYaw(this.cameraForward);
			const jumpKeyPressed = this.input.isPressed(this.keybinds.jump);
			const jumpTriggered = jumpKeyPressed && !this.jumpKeyWasPressed;
			this.jumpKeyWasPressed = jumpKeyPressed;
			const input = this.simulationInput;
			const previousForward = input.forward;
			const previousBackward = input.backward;
			const previousRight = input.right;
			const previousLeft = input.left;
			const previousCameraYaw = input.cameraYaw;
			input.seq = this.seq;

			// Mobile Joystick test but don't want to keep it
			let joyForward = false;
			let joyBackward = false;
			let joyLeft = false;
			let joyRight = false;
			if (this.moveJoystick?.pressed) {
				const dx = this.moveJoystick.deltaPosition.x;
				const dy = this.moveJoystick.deltaPosition.y;
				joyForward = dy > JOYSTICK_DEADZONE;
				joyBackward = dy < -JOYSTICK_DEADZONE;
				joyRight = dx > JOYSTICK_DEADZONE;
				joyLeft = dx < -JOYSTICK_DEADZONE;
			}
			//
			input.forward =
				this.input.isPressed(this.keybinds.forward) || joyForward; // to remove
			input.backward =
				this.input.isPressed(this.keybinds.backward) || joyBackward; // to remove
			input.right = this.input.isPressed(this.keybinds.right) || joyRight; // to remove
			input.left = this.input.isPressed(this.keybinds.left) || joyLeft; // to remove
			input.jump = jumpTriggered;
			input.deltaTime = deltaTime;
			input.cameraYaw = cameraYaw;
			const room = this.server.getRoom();
			const playerInRoom = room.state.players.get(room.sessionId);
			if (!playerInRoom) return;
			const downed = playerInRoom.isDowned;
			if (downed) {
				input.forward = false;
				input.backward = false;
				input.right = false;
				input.left = false;
				input.jump = false;
			}
			const moving =
				input.forward || input.backward || input.right || input.left;
			if (downed) {
				this.playerAnimations.playDowned();
				if (!this.downedLastFrame) this.networkInputCadence.reset();
			} else {
				if (this.downedLastFrame) this.playerAnimations.playRevive();
				if (moving) {
					this.playerAnimations.playWalk();
				} else {
					this.playerAnimations.playIdle();
					if (this.player.rotation.z !== 0)
						this.player.rotation.z = 0;
				}
			}
			this.downedLastFrame = downed;
			const currentState = this.server.getMovementState();
			const world = this.mapGen.getWorld();
			this.movementBoundary.centerX = room.state.rayX;
			this.movementBoundary.centerZ = room.state.rayZ;
			const newState = simulatePlayerMovement(
				world,
				currentState,
				input,
				playerInRoom.stats.moveSpeed,
				this.nextMovementState,
				this.movementBoundary,
			);
			this.server.setMovementState(newState);
			const playerPosition = this.player.position;
			if (playerPosition.x !== newState.x) playerPosition.x = newState.x;
			if (playerPosition.y !== newState.y) playerPosition.y = newState.y;
			if (playerPosition.z !== newState.z) playerPosition.z = newState.z;
			if (this.player.rotation.y !== newState.rotationY)
				this.player.rotation.y = newState.rotationY;
			const networkDeltaTime = downed
				? null
				: this.networkInputCadence.advance(
						deltaTime,
						moving || !newState.isGrounded,
						jumpTriggered,
					);
			const previousStateDeltaTime =
				this.networkInputCadence.takePreviousStateDeltaTime();
			if (previousStateDeltaTime > 0) {
				const networkInput = this.networkInput;
				networkInput.seq = ++this.seq;
				networkInput.forward = previousForward;
				networkInput.backward = previousBackward;
				networkInput.right = previousRight;
				networkInput.left = previousLeft;
				networkInput.jump = false;
				networkInput.deltaTime = previousStateDeltaTime;
				networkInput.cameraYaw = previousCameraYaw;
				this.server.sendMovementInput(networkInput);
			}
			if (networkDeltaTime !== null) {
				const networkInput = this.networkInput;
				networkInput.seq = ++this.seq;
				networkInput.forward = input.forward;
				networkInput.backward = input.backward;
				networkInput.right = input.right;
				networkInput.left = input.left;
				networkInput.jump = input.jump;
				networkInput.deltaTime = Math.min(networkDeltaTime, MAX_DT);
				networkInput.cameraYaw = input.cameraYaw;
				this.server.sendMovementInput(networkInput);
			}
			this.server.setUnsentPrediction(
				input,
				this.networkInputCadence.pendingDeltaTime(),
			);
			const { rayX, rayY, rayZ } = room.state;
			this.mapGen.syncFromRoom(rayX, rayY, rayZ);
			this.server.updateRemotePlayers(deltaTime);
			this.mapGen.updateAuras(this.server.collectAuras(), deltaTime);
			this.monsters.update(deltaTime);
			const cameraTarget = this.camera.target;
			if (
				cameraTarget.x !== playerPosition.x ||
				cameraTarget.y !== playerPosition.y ||
				cameraTarget.z !== playerPosition.z
			)
				cameraTarget.copyFrom(playerPosition);
			this.clampCameraToTerrain(deltaTime);
			this.forest.update(this.player.position);
			this.hud.update();
			this.statsPanel.update();
			this.updateReviveIntent(downed);
			if (this.lastReviveKey !== this.keybinds.revive) {
				this.lastReviveKey = this.keybinds.revive;
				const keyLabel = formatKeyLabel(this.keybinds.revive);
				this.revivePrompt.setKeyLabel(keyLabel);
				this.hud.setReviveKeyLabel(keyLabel);
			}
			this.revivePrompt.update();
			this.debugMenu.updateDebugMenu(this.player);
			const statsKeyPressed = this.input.isPressed(this.keybinds.stats);
			const toggleStats = statsKeyPressed && !this.statsKeyWasPressed;
			this.statsKeyWasPressed = statsKeyPressed;
			const settingsOpen = this.settings.isOpen();
			this.levelUpMenu.setInteractionBlocked(settingsOpen);
			const menuOpen =
				this.settings.isOpen() || this.levelUpMenu.isOpen();
			if (menuOpen) this.statsPanel.close();
			else if (toggleStats) this.statsPanel.toggle(this.keybinds.stats);
			const pKeyPressed = this.input.isPressed('p');
			const toggleSettings = pKeyPressed && !this.settingsKeyWasPressed;
			this.settingsKeyWasPressed = pKeyPressed;
			if (toggleSettings) {
				if (navigator.maxTouchPoints > 0) return;
				if (!this.settings.isOpen()) {
					this.settings.open();
					document.exitPointerLock();
				} else {
					this.settings.close();
					void this.engine.getRenderingCanvas()?.requestPointerLock();
				}
			}
		});
	}

	private updateReviveIntent(downed: boolean): void {
		const holding =
			!downed &&
			!this.settings.isOpen() &&
			this.input.isPressed(this.keybinds.revive);
		if (holding === this.reviveIntentSent) return;
		this.reviveIntentSent = holding;
		this.server.setReviveIntent(holding);
	}

	private async addPlayer() {
		const result = await this.playerAssets.instantiate(
			models.player,
			'localPlayer',
		);
		const model = result.root;
		const spawn = this.server.getLocalSpawn();
		const startX = spawn?.x ?? 0;
		const startZ = spawn?.z ?? 0;
		const startY = spawn?.y ?? this.mapGen.getGroundHeight(startX, startZ);
		model.position = new BABYLON.Vector3(startX, startY, startZ);
		model.scaling = new BABYLON.Vector3(1, 1, 1);
		model.isVisible = true;
		model.rotationQuaternion = null;
		this.camera.lockedTarget = model;
		this.player = model;
		this.playerAnimations = createPlayerAnimationController(
			model,
			result.animationGroups,
		);
		this.playerAnimations.playIdle();
		this.defer(() => this.playerAnimations.dispose());
		this.mapGen.prepareRenderable(model);
		this.server.setMovementState(
			createMovementState(startX, startY, startZ),
		);
	}

	private boundOnClick = () => {
		if (this.settings.isOpen()) return;
		const canvas = this.engine.getRenderingCanvas();
		if (!canvas) return;
		try {
			canvas.requestPointerLock();
		} catch (error) {
			console.log('Pointer Lock unavailable', error);
		}
	};

	private boundOnMouseMove = (e: MouseEvent) => {
		if (this.settings.isOpen()) return;
		const canvas = this.engine.getRenderingCanvas();

		const sensitivity = 0.0025;

		if (document.pointerLockElement === canvas) {
			this.camera.alpha -= e.movementX * sensitivity;
			this.camera.beta -= e.movementY * sensitivity;
			this.camera.beta = Math.max(
				this.camera.lowerBetaLimit as number,
				Math.min(
					this.camera.upperBetaLimit as number,
					this.camera.beta,
				),
			);
		}
	};
}
