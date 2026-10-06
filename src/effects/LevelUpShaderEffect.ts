import {
	Constants,
	Mesh,
	MeshBuilder,
	ShaderMaterial,
	type AbstractMesh,
	type Scene,
} from '@babylonjs/core';
import type { Room } from '@colyseus/sdk';
import {
	clamp01,
	ServerMessage,
	type GameState,
} from '@transcendence/game-shared';
import { CleanupBag } from '../CleanupBag';

const EFFECT_DURATION_S = 1.2;
const MAX_QUEUED_PULSES = 3;

const VERTEX_SHADER = `
precision highp float;

attribute vec3 position;
attribute vec2 uv;
uniform mat4 worldViewProjection;
varying vec2 vUV;

void main(void) {
	vUV = uv;
	gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

const FRAGMENT_SHADER = `
precision highp float;

varying vec2 vUV;
uniform float uProgress;
uniform float uTime;

const float PI = 3.14159265359;

void main(void) {
	float intro = smoothstep(0.0, 0.07, uProgress);
	float outro = 1.0 - smoothstep(0.68, 1.0, uProgress);
	float envelope = intro * outro;
	float verticalFade = smoothstep(0.0, 0.12, vUV.y)
		* (1.0 - smoothstep(0.88, 1.0, vUV.y));

	float scanHeight = mix(-0.08, 1.08, smoothstep(0.0, 0.82, uProgress));
	float scanDistance = abs(vUV.y - scanHeight);
	float scanCore = 1.0 - smoothstep(0.0, 0.026, scanDistance);
	float scanGlow = 1.0 - smoothstep(0.02, 0.14, scanDistance);

	float angular = vUV.x * PI * 2.0;
	float rays = pow(
		max(0.0, 0.5 + 0.5 * sin(angular * 12.0 - uTime * 5.0)),
		12.0
	);
	float shimmer = 0.5 + 0.5 * sin(vUV.y * 52.0 - uTime * 11.0);

	vec3 cyan = vec3(0.25, 0.93, 0.84);
	vec3 gold = vec3(1.0, 0.76, 0.28);
	vec3 color = mix(cyan, gold, clamp(scanGlow + scanCore, 0.0, 1.0));
	float alpha = (
		scanCore * 0.72
		+ scanGlow * 0.28
		+ rays * verticalFade * (0.055 + shimmer * 0.035)
	) * envelope;

	gl_FragColor = vec4(color, alpha);
}
`;

function levelUpPulseProgress(elapsedS: number): number {
	if (!Number.isFinite(elapsedS)) return 1;
	return clamp01(elapsedS / EFFECT_DURATION_S);
}

export class LevelUpShaderEffect {
	private readonly mesh: Mesh;
	private readonly material: ShaderMaterial;
	private readonly cleanups = new CleanupBag();
	private elapsedS = EFFECT_DURATION_S;
	private shaderTimeS = 0;
	private queuedPulses = 0;

	constructor(scene: Scene, player: AbstractMesh, room: Room<GameState>) {
		this.material = new ShaderMaterial(
			'levelUpPulseMaterial',
			scene,
			{
				vertexSource: VERTEX_SHADER,
				fragmentSource: FRAGMENT_SHADER,
			},
			{
				attributes: ['position', 'uv'],
				uniforms: ['worldViewProjection', 'uProgress', 'uTime'],
				needAlphaBlending: true,
			},
		);
		this.material.backFaceCulling = false;
		this.material.disableDepthWrite = true;
		this.material.alphaMode = Constants.ALPHA_ADD;
		this.material.setFloat('uProgress', 1);
		this.material.setFloat('uTime', 0);

		this.mesh = MeshBuilder.CreateCylinder(
			'localPlayerLevelUpPulse',
			{
				height: 4.2,
				diameter: 2.7,
				tessellation: 40,
				subdivisions: 1,
				cap: Mesh.NO_CAP,
				sideOrientation: Mesh.DOUBLESIDE,
			},
			scene,
		);
		this.mesh.parent = player;
		this.mesh.position.y = 2.05;
		this.mesh.material = this.material;
		this.mesh.isPickable = false;
		this.mesh.renderingGroupId = 2;
		// Keep the world depth: the lighting post-processes read it after this group renders.
		scene.setRenderingAutoClearDepthStencil(2, false, false, false);
		this.mesh.setEnabled(false);

		this.cleanups.add(
			room.onMessage(ServerMessage.LevelUp, () => this.enqueuePulse()),
		);
		const renderObserver = scene.onBeforeRenderObservable.add(() =>
			this.update(scene.getEngine().getDeltaTime() / 1000),
		);
		this.cleanups.add(() =>
			scene.onBeforeRenderObservable.remove(renderObserver),
		);
	}

	private enqueuePulse(): void {
		if (!this.mesh.isEnabled()) {
			this.startPulse();
			return;
		}
		this.queuedPulses = Math.min(MAX_QUEUED_PULSES, this.queuedPulses + 1);
	}

	private startPulse(): void {
		this.elapsedS = 0;
		this.shaderTimeS = 0;
		this.mesh.setEnabled(true);
		this.material.setFloat('uProgress', 0);
	}

	private update(deltaTimeS: number): void {
		if (!this.mesh.isEnabled()) return;
		const safeDelta = Number.isFinite(deltaTimeS)
			? Math.min(0.1, Math.max(0, deltaTimeS))
			: 0;
		this.elapsedS += safeDelta;
		this.shaderTimeS += safeDelta;
		const progress = levelUpPulseProgress(this.elapsedS);
		this.material.setFloat('uProgress', progress);
		this.material.setFloat('uTime', this.shaderTimeS);
		if (progress < 1) return;
		if (this.queuedPulses > 0) {
			this.queuedPulses--;
			this.startPulse();
			return;
		}
		this.mesh.setEnabled(false);
	}

	dispose(): void {
		this.cleanups.dispose();
		this.mesh.dispose();
		this.material.dispose();
	}
}
