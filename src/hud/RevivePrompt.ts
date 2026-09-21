import * as BABYLON from '@babylonjs/core';
import * as GUI from '@babylonjs/gui';
import type * as COLYSEUS from '@colyseus/sdk';
import {
	isWithinReviveRange,
	type GameState,
	type Player,
} from '@transcendence/game-shared';
import { createFullscreenUi } from '../assets/ui';
import { HUD_THEME, hudText } from './HudTheme';
import { RadialProgress } from './RadialProgress';

const PROMPT_HEIGHT = 2.4;
const PROMPT_VISIBLE_DISTANCE = 60;
const PROMPT_SIZE = 52;
const ALPHA_IN_RANGE = 1;
const ALPHA_OUT_OF_RANGE = 0.45;

type ResolvePlayerMesh = (
	sessionId: string,
) => BABYLON.AbstractMesh | undefined;

interface PromptView {
	anchor: BABYLON.TransformNode;
	container: GUI.Container;
	ring: RadialProgress;
	label: GUI.TextBlock;
}

export class RevivePrompt {
	private readonly advTex: GUI.AdvancedDynamicTexture;
	private readonly views = new Map<string, PromptView>();
	private readonly cameraDistance = BABYLON.Vector3.Zero();
	private readonly scene: BABYLON.Scene;
	private readonly room: COLYSEUS.Room<GameState>;
	private readonly resolveMesh: ResolvePlayerMesh;
	private keyLabel = '';

	constructor(
		scene: BABYLON.Scene,
		room: COLYSEUS.Room<GameState>,
		resolveMesh: ResolvePlayerMesh,
	) {
		this.scene = scene;
		this.room = room;
		this.resolveMesh = resolveMesh;
		this.advTex = createFullscreenUi('RevivePromptUi', scene);
		this.advTex.useInvalidateRectOptimization = true;
	}

	setKeyLabel(label: string): void {
		if (this.keyLabel === label) return;
		this.keyLabel = label;
		this.views.forEach((view) => {
			view.label.text = label;
		});
	}

	update(): void {
		const players = this.room.state?.players;
		if (!players) {
			this.clear();
			return;
		}
		const localMesh = this.resolveMesh(this.room.sessionId);
		const localPlayer = players.get(this.room.sessionId);
		const canLocalRevive = Boolean(localPlayer && !localPlayer.isDowned);
		players.forEach((player, sessionId) => {
			if (sessionId === this.room.sessionId) return;
			if (!player.isDowned) {
				this.removeView(sessionId);
				return;
			}
			const mesh = this.resolveMesh(sessionId);
			if (!mesh) {
				this.removeView(sessionId);
				return;
			}
			const view = this.views.get(sessionId) ?? this.createView(mesh);
			this.views.set(sessionId, view);
			this.refreshView(view, player, mesh, localMesh, canLocalRevive);
		});
		this.views.forEach((_view, sessionId) => {
			if (!players.get(sessionId)) this.removeView(sessionId);
		});
	}

	dispose(): void {
		this.clear();
		this.advTex.dispose();
	}

	private refreshView(
		view: PromptView,
		player: Player,
		mesh: BABYLON.AbstractMesh,
		localMesh: BABYLON.AbstractMesh | undefined,
		canLocalRevive: boolean,
	): void {
		const camera = this.scene.activeCamera;
		if (camera) {
			mesh.position.subtractToRef(
				camera.globalPosition,
				this.cameraDistance,
			);
			if (this.cameraDistance.length() > PROMPT_VISIBLE_DISTANCE) {
				view.container.isVisible = false;
				return;
			}
		}
		view.container.isVisible = true;
		view.ring.progress = player.reviveProgress;
		const inRange =
			canLocalRevive &&
			localMesh !== undefined &&
			isWithinReviveRange(localMesh.position, mesh.position);
		view.container.alpha = inRange ? ALPHA_IN_RANGE : ALPHA_OUT_OF_RANGE;
	}

	private createView(mesh: BABYLON.AbstractMesh): PromptView {
		const anchor = new BABYLON.TransformNode(
			`${mesh.name}:revivePromptAnchor`,
			this.scene,
		);
		anchor.parent = mesh;
		anchor.position.y = PROMPT_HEIGHT / (mesh.scaling.y || 1);

		const container = new GUI.Container('RevivePrompt');
		container.width = `${PROMPT_SIZE}px`;
		container.height = `${PROMPT_SIZE}px`;
		container.isPointerBlocker = false;
		this.advTex.addControl(container);
		container.linkWithMesh(anchor);

		const ring = new RadialProgress('RevivePromptRing');
		ring.trackColor = '#0B1417CC';
		ring.fillColor = HUD_THEME.goldBright;
		container.addControl(ring);

		const label = hudText(
			'RevivePromptKey',
			this.keyLabel,
			20,
			HUD_THEME.goldBright,
		);
		label.fontWeight = 'bold';
		container.addControl(label);

		return { anchor, container, ring, label };
	}

	private removeView(sessionId: string): void {
		const view = this.views.get(sessionId);
		if (!view) return;
		this.views.delete(sessionId);
		disposeView(view);
	}

	private clear(): void {
		this.views.forEach(disposeView);
		this.views.clear();
	}
}

function disposeView(view: PromptView): void {
	view.container.dispose();
	view.anchor.dispose();
}
