import { Color3, Effect, PostProcess, Vector3 } from '@babylonjs/core';
import type { Scene } from '@babylonjs/core';
import {
	bindCameraDepthUniforms,
	CAMERA_DEPTH_GLSL,
	DEPTH_UNIFORMS,
} from './SceneDepthTexture';

export const EFFECT_RENDER_RATIO = 1;

export interface RadialLightingOptions {
	innerRadius: number;
	outerRadius: number;
	penumbra: number;
	lightColor: Color3;
}

const FRAGMENT_SHADER = `
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
${CAMERA_DEPTH_GLSL}
uniform vec3 uRayPosition;
uniform vec4 uLighting;
uniform vec3 uLightColor;

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main(void) {
	vec4 scene = texture2D(textureSampler, vUV);
	float depth = texture2D(depthSampler, vUV).r;

	vec3 rayV;
	vec3 rayDir = cameraWorldRay(vUV, rayV);
	bool hitGeometry = depth < 0.999999;
	float maxDistance = sceneDepthDistance(depth, rayV);

	vec3 worldPosition = uCamPos + rayDir * maxDistance;
	float distanceToRay = length(worldPosition.xz - uRayPosition.xz);
	float radial = hitGeometry
		? 1.0 - smoothstep(uLighting.x, uLighting.y, distanceToRay)
		: 0.0;
	float noise = (hash(gl_FragCoord.xy + uLighting.w) - 0.5) * 0.018;
	float visibility = clamp(mix(uLighting.z, 1.0, radial) + noise * radial, 0.0, 1.0);
	float luminance = dot(scene.rgb, vec3(0.2126, 0.7152, 0.0722));
	vec3 desaturated = mix(vec3(luminance), scene.rgb, mix(0.45, 1.0, radial));
	vec3 tint = mix(vec3(0.62, 0.69, 0.82), uLightColor, radial * 0.24);
	vec3 color = desaturated * tint * visibility;

	vec2 offset = uCamPos.xz - uRayPosition.xz;
	float a = dot(rayDir.xz, rayDir.xz);
	float b = 2.0 * dot(offset, rayDir.xz);
	float c = dot(offset, offset) - uLighting.y * uLighting.y;
	float discriminant = b * b - 4.0 * a * c;
	float atmosphere = 0.0;
	if (discriminant > 0.0 && a > 0.00001) {
		float root = sqrt(discriminant);
		float entry = max(0.0, (-b - root) / (2.0 * a));
		float exit = min(maxDistance, (-b + root) / (2.0 * a));
		if (exit > entry) {
			const int STEPS = 4;
			float stepLength = (exit - entry) / float(STEPS);
			float density = 0.0;
			for (int i = 0; i < STEPS; i++) {
				float t = entry + (float(i) + 0.5) * stepLength;
				vec3 samplePosition = uCamPos + rayDir * t;
				float sampleRadius = length(samplePosition.xz - uRayPosition.xz);
				float sampleLight = 1.0 - smoothstep(
					uLighting.x * 0.7,
					uLighting.y,
					sampleRadius
				);
				density += sampleLight;
			}
			atmosphere = 1.0 - exp(-density * stepLength * 0.008);
		}
	}

	color += uLightColor * atmosphere * 0.34;
	// Do not let bright world pixels leak through the opaque cylinder boundary.
	// The light/fog contribution remains separate and can still be visible.
	vec3 emissive = scene.rgb * smoothstep(0.72, 1.15, luminance) * radial * (1.0 - visibility);
	gl_FragColor = vec4(color + emissive, scene.a);
}
`;

export class RadialLightingPostProcess {
	private readonly scene: Scene;
	private readonly postProcess: PostProcess;
	private readonly rayPosition = Vector3.Zero();
	private readonly options: RadialLightingOptions;
	private frame = 0;

	constructor(scene: Scene, options: RadialLightingOptions) {
		this.scene = scene;
		this.options = options;
		if (Effect.ShadersStore.radialLightingFragmentShader === undefined)
			Effect.ShadersStore.radialLightingFragmentShader = FRAGMENT_SHADER;
		this.postProcess = new PostProcess(
			'radialLighting',
			'radialLighting',
			[...DEPTH_UNIFORMS, 'uRayPosition', 'uLighting', 'uLightColor'],
			['depthSampler'],
			EFFECT_RENDER_RATIO,
			scene.activeCamera,
		);
		this.postProcess.onApplyObservable.add((effect) => {
			const camera = this.scene.activeCamera;
			if (!camera) return;
			bindCameraDepthUniforms(
				effect,
				this.scene,
				camera,
				'radial-lighting-depth',
			);
			effect.setVector3('uRayPosition', this.rayPosition);
			effect.setFloat4(
				'uLighting',
				this.options.innerRadius,
				this.options.outerRadius,
				this.options.penumbra,
				this.frame++,
			);
			effect.setColor3('uLightColor', this.options.lightColor);
		});
	}

	setRayPosition(x: number, y: number, z: number): void {
		this.rayPosition.set(x, y, z);
	}

	dispose(): void {
		this.postProcess.dispose();
	}
}
