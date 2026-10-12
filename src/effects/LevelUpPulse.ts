import {
	Constants,
	Effect,
	Mesh,
	MeshBuilder,
	ShaderMaterial,
	type AbstractMesh,
	type Scene,
} from '@babylonjs/core';
import type { Room } from '@colyseus/sdk';
import { ServerMessage, type GameState } from '@transcendence/game-shared';
import { CleanupBag } from '../CleanupBag';

const DURATION_S = 1.2;
const RENDERING_GROUP = 2;

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
uniform float uTime;

const float PI = 3.14159265359;
const vec3 CYAN = vec3(0.25, 0.93, 0.84);
const vec3 GOLD = vec3(1.0, 0.76, 0.28);

void main(void) {
	float progress = uTime / ${DURATION_S.toFixed(1)};
	float fade = smoothstep(0.0, 0.07, progress) * (1.0 - smoothstep(0.68, 1.0, progress));

	float lineHeight = mix(-0.08, 1.08, smoothstep(0.0, 0.82, progress));
	float distanceToLine = abs(vUV.y - lineHeight);
	float line = 1.0 - smoothstep(0.0, 0.026, distanceToLine);
	float glow = 1.0 - smoothstep(0.02, 0.14, distanceToLine);

	float rays = pow(0.5 + 0.5 * sin(vUV.x * 24.0 * PI - uTime * 5.0), 12.0);
	float raysFade = sin(vUV.y * PI);

	vec3 color = mix(CYAN, GOLD, glow);
	float alpha = line * 0.72 + glow * 0.28 + rays * raysFade * 0.07;
	gl_FragColor = vec4(color, alpha * fade);
}
`;

export class LevelUpPulse {
	private readonly mesh: Mesh;
	private readonly material: ShaderMaterial;
	private readonly cleanups = new CleanupBag();
	private elapsedS = DURATION_S;

	constructor(scene: Scene, player: AbstractMesh, room: Room<GameState>) {
		Effect.ShadersStore.levelUpPulseVertexShader ??= VERTEX_SHADER;
		Effect.ShadersStore.levelUpPulseFragmentShader ??= FRAGMENT_SHADER;
		this.material = new ShaderMaterial(
			'levelUpPulseMaterial',
			scene,
			'levelUpPulse',
			{
				attributes: ['position', 'uv'],
				uniforms: ['worldViewProjection', 'uTime'],
				needAlphaBlending: true,
			},
		);
		Object.assign(this.material, {
			backFaceCulling: false,
			disableDepthWrite: true,
			alphaMode: Constants.ALPHA_ADD,
		});
		this.mesh = MeshBuilder.CreateCylinder(
			'localPlayerLevelUpPulse',
			{
				height: 4.2,
				diameter: 2.7,
				tessellation: 40,
				cap: Mesh.NO_CAP,
				sideOrientation: Mesh.DOUBLESIDE,
			},
			scene,
		);
		Object.assign(this.mesh, {
			parent: player,
			material: this.material,
			isPickable: false,
			renderingGroupId: RENDERING_GROUP,
		});
		this.mesh.position.y = 2.05;
		this.mesh.setEnabled(false);
		scene.setRenderingAutoClearDepthStencil(
			RENDERING_GROUP,
			false,
			false,
			false,
		);

		const observer = scene.onBeforeRenderObservable.add(() =>
			this.update(scene.getEngine().getDeltaTime() / 1000),
		);
		this.cleanups.add(
			room.onMessage(ServerMessage.LevelUp, () => {
				this.elapsedS = 0;
				this.mesh.setEnabled(true);
			}),
			() => scene.onBeforeRenderObservable.remove(observer),
		);
	}

	dispose(): void {
		this.cleanups.dispose();
		this.mesh.dispose();
		this.material.dispose();
	}

	private update(deltaTimeS: number): void {
		if (this.elapsedS >= DURATION_S) {
			this.mesh.setEnabled(false);
			return;
		}
		this.elapsedS += Math.min(deltaTimeS, 0.1);
		this.material.setFloat('uTime', this.elapsedS);
	}
}
