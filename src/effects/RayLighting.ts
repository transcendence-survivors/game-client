import {
	Color3,
	Constants,
	Effect,
	Matrix,
	PostProcess,
	Vector3,
	type Camera,
	type Scene,
} from '@babylonjs/core';
import { ACCESS_RADIUS } from '@transcendence/game-shared';

const LIGHT_COLOR = new Color3(1.0, 0.9, 0.62);
const INNER_RADIUS = ACCESS_RADIUS * 0.45;
const OUTER_RADIUS = ACCESS_RADIUS;
const BEAM_RADIUS = 8;
const BEAM_HEIGHT = 140;

const FRAGMENT_SHADER = `
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform highp sampler2D depthSampler;
uniform mat4 uInvViewProjection;
uniform vec3 uCamPos;
uniform vec3 uRayPosition;
uniform vec3 uLightColor;
uniform float uInnerRadius;
uniform float uOuterRadius;
uniform float uBeamRadius;
uniform float uBeamHeight;

void main(void) {
	vec4 scene = texture2D(textureSampler, vUV);

	float depth = texture2D(depthSampler, vUV).r;
	vec4 world = uInvViewProjection * vec4(vUV * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
	vec3 worldPosition = world.xyz / world.w;
	vec3 viewDir = normalize(worldPosition - uCamPos);
	float distanceToPixel = distance(worldPosition, uCamPos);

	float light = 1.0 - smoothstep(uInnerRadius, uOuterRadius, distance(worldPosition.xz, uRayPosition.xz));
	float gray = dot(scene.rgb, vec3(0.2126, 0.7152, 0.0722));
	vec3 color = mix(vec3(gray), scene.rgb, mix(0.45, 1.0, light));
	color *= mix(vec3(0.62, 0.69, 0.82), uLightColor, light * 0.24) * light;

	float flatLength = max(dot(viewDir.xz, viewDir.xz), 1e-5);
	float along = dot(uRayPosition.xz - uCamPos.xz, viewDir.xz) / flatLength;
	vec3 closest = uCamPos + viewDir * along;
	float axisDistance = distance(closest.xz, uRayPosition.xz);

	float halfChord = sqrt(max(uOuterRadius * uOuterRadius - axisDistance * axisDistance, 0.0) / flatLength);
	float fogLength = max(min(along + halfChord, distanceToPixel) - max(along - halfChord, 0.0), 0.0);
	color += uLightColor * (1.0 - exp(-fogLength * 0.006)) * 0.34;

	float height = (closest.y - uRayPosition.y) / uBeamHeight;
	float heightFade = smoothstep(0.0, 0.05, height) * (1.0 - smoothstep(0.5, 1.0, height));
	float visible = step(0.0, along) * step(along, distanceToPixel);
	float beam = exp(-2.5 * pow(axisDistance / uBeamRadius, 2.0)) * heightFade * visible;

	gl_FragColor = vec4(color + uLightColor * beam * 0.25, scene.a);
}
`;

export class RayLighting {
	private readonly scene: Scene;
	private readonly postProcess: PostProcess;
	private readonly position: Vector3;
	private readonly invViewProjection = new Matrix();

	constructor(scene: Scene, strikeY: number) {
		this.scene = scene;
		this.position = new Vector3(0, strikeY, 0);
		Effect.ShadersStore.rayLightingFragmentShader ??= FRAGMENT_SHADER;
		this.postProcess = new PostProcess(
			'rayLighting',
			'rayLighting',
			[
				'uInvViewProjection',
				'uCamPos',
				'uRayPosition',
				'uLightColor',
				'uInnerRadius',
				'uOuterRadius',
				'uBeamRadius',
				'uBeamHeight',
			],
			['depthSampler'],
			1,
			scene.activeCamera,
		);
		this.postProcess.onApplyObservable.add((effect) => {
			const camera = this.scene.activeCamera;
			if (camera) this.bind(effect, camera);
		});
	}

	setPosition(x: number, y: number, z: number): void {
		this.position.set(x, y, z);
	}

	dispose(): void {
		this.postProcess.dispose();
	}

	private bind(effect: Effect, camera: Camera): void {
		const engine = this.scene.getEngine();
		const target = (
			camera as unknown as { _getFirstPostProcess(): PostProcess | null }
		)._getFirstPostProcess()?.inputTexture;
		if (target && !target.depthStencilTexture)
			target.createDepthStencilTexture(
				0,
				false,
				engine.isStencilEnable,
				1,
				Constants.TEXTUREFORMAT_DEPTH24_STENCIL8,
				'ray-lighting-depth',
			);
		if (target?.depthStencilTexture)
			effect._bindTexture('depthSampler', target.depthStencilTexture);
		camera.getTransformationMatrix().invertToRef(this.invViewProjection);
		effect.setMatrix('uInvViewProjection', this.invViewProjection);
		effect.setVector3('uCamPos', camera.globalPosition);
		effect.setVector3('uRayPosition', this.position);
		effect.setColor3('uLightColor', LIGHT_COLOR);
		effect.setFloat('uInnerRadius', INNER_RADIUS);
		effect.setFloat('uOuterRadius', OUTER_RADIUS);
		effect.setFloat('uBeamRadius', BEAM_RADIUS);
		effect.setFloat('uBeamHeight', BEAM_HEIGHT);
	}
}
