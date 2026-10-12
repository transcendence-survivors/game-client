import {
	MaterialPluginBase,
	type Material,
	type UniformBuffer,
} from '@babylonjs/core';
import { COMBAT_LIMITS, type Vec2d } from '@transcendence/game-shared';

const MAX_AURAS = COMBAT_LIMITS.maxPlayers;

const UNIFORMS = `
uniform vec4 uAuras[${MAX_AURAS}];
uniform float uAuraCount;
uniform float uTime;
`;

const FRAGMENT_SHADER = `
const vec3 AURA_COLOR = vec3(0.35, 0.85, 1.0);

vec3 playerAura(vec2 position) {
	vec3 color = vec3(0.0);
	for (int i = 0; i < ${MAX_AURAS}; i++) {
		if (float(i) >= uAuraCount) break;
		vec4 aura = uAuras[i];
		if (aura.z <= 0.0) continue;
		float distanceToCenter = distance(position, aura.xy) / aura.z;
		if (distanceToCenter > 1.0) continue;

		float wavePosition = fract(uTime * aura.w);
		float fill = (1.0 - distanceToCenter) * 0.10;
		float ring = smoothstep(0.82, 1.0, distanceToCenter) * 0.7;
		float wave = smoothstep(0.07, 0.0, abs(distanceToCenter - wavePosition)) * (1.0 - wavePosition) * 0.9;
		color += AURA_COLOR * (fill + ring + wave);
	}
	return color;
}
`;

export interface AuraInstance extends Vec2d {
	radius: number;
	attackSpeed: number;
}

export class PlayerAura extends MaterialPluginBase {
	private readonly auras = new Float32Array(MAX_AURAS * 4);
	private count = 0;
	private elapsedS = 0;

	constructor(material: Material) {
		super(material, 'PlayerAura', 250);
		this._enable(true);
	}

	update(auras: readonly AuraInstance[], deltaTimeS: number): void {
		this.elapsedS += deltaTimeS;
		this.count = Math.min(auras.length, MAX_AURAS);
		for (let i = 0; i < this.count; i++) {
			const aura = auras[i];
			this.auras.set(
				[aura.x, aura.z, aura.radius, aura.attackSpeed],
				i * 4,
			);
		}
	}

	getClassName(): string {
		return 'PlayerAura';
	}

	getUniforms() {
		return {
			ubo: [
				{ name: 'uAuras', size: 4, type: 'vec4', arraySize: MAX_AURAS },
				{ name: 'uAuraCount', size: 1, type: 'float' },
				{ name: 'uTime', size: 1, type: 'float' },
			],
			fragment: UNIFORMS,
		};
	}

	bindForSubMesh(uniformBuffer: UniformBuffer): void {
		uniformBuffer.updateFloatArray('uAuras', this.auras);
		uniformBuffer.updateFloat('uAuraCount', this.count);
		uniformBuffer.updateFloat('uTime', this.elapsedS);
	}

	getCustomCode(shaderType: string) {
		if (shaderType !== 'fragment') return null;
		return {
			CUSTOM_FRAGMENT_DEFINITIONS: FRAGMENT_SHADER,
			CUSTOM_FRAGMENT_MAIN_END:
				'gl_FragColor.rgb += playerAura(vPositionW.xz);',
		};
	}
}
