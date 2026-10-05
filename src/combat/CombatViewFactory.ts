import * as BABYLON from '@babylonjs/core';
import { TAU, type CombatEntity } from '@transcendence/game-shared';
import { weaponModels } from '../assets/models/weapons/weaponModels';
import { CombatAssetLibrary } from './CombatAssetLibrary';
import { CombatEntityView, ProjectileView } from './CombatEntityView';

export class CombatViewFactory {
	private readonly fireballSource: BABYLON.Mesh;
	private readonly fireballMaterial: BABYLON.StandardMaterial;
	private readonly fireballGlowSource: BABYLON.Mesh;
	private readonly fireballGlowMaterial: BABYLON.StandardMaterial;
	private readonly scene: BABYLON.Scene;
	private readonly assets: CombatAssetLibrary;

	constructor(scene: BABYLON.Scene, assets: CombatAssetLibrary) {
		this.scene = scene;
		this.assets = assets;
		[this.fireballSource, this.fireballMaterial] = this.createFireballLayer(
			'fireball',
			0.52,
			[1, 0.2, 0.01],
			[1, 0.3, 0.015],
		);
		[this.fireballGlowSource, this.fireballGlowMaterial] =
			this.createFireballLayer(
				'fireballGlow',
				0.76,
				[0.9, 0.08, 0],
				[1, 0.12, 0.005],
			);
		Object.assign(this.fireballGlowMaterial, {
			alpha: 0.28,
			alphaMode: BABYLON.Constants.ALPHA_ADD,
			backFaceCulling: false,
		});
	}

	private createFireballLayer(
		name: string,
		radius: number,
		diffuse: readonly [number, number, number],
		emissive: readonly [number, number, number],
	): readonly [BABYLON.Mesh, BABYLON.StandardMaterial] {
		const material = new BABYLON.StandardMaterial(
			`${name}Material`,
			this.scene,
		);
		material.disableLighting = true;
		material.diffuseColor.set(...diffuse);
		material.emissiveColor.set(...emissive);
		const source = BABYLON.MeshBuilder.CreateIcoSphere(
			`${name}Source`,
			{ radius, subdivisions: 2 },
			this.scene,
		);
		source.material = material;
		source.isVisible = false;
		source.isPickable = false;
		return [source, material];
	}

	async create(entity: CombatEntity, id: string): Promise<CombatEntityView> {
		switch (entity.kind) {
			case 'sword-slash': {
				const root = new BABYLON.TransformNode(
					`swordSlash:${id}`,
					this.scene,
				);
				return new CombatEntityView(entity, root);
			}
			case 'axe':
			case 'arrow':
				return this.createModelProjectile(entity, id, entity.kind);
			case 'fireball': {
				const root = new BABYLON.TransformNode(
					`fireball:${id}`,
					this.scene,
				);
				const core = this.fireballSource.createInstance(
					`fireballCore:${id}`,
				);
				const glow = this.fireballGlowSource.createInstance(
					`fireballGlow:${id}`,
				);
				core.parent = root;
				glow.parent = root;
				core.isVisible = true;
				glow.isVisible = true;
				const seed = this.hash(id);
				return new ProjectileView(entity, root, (_, combatTimeS) =>
					root.scaling.setAll(
						1 + Math.sin(combatTimeS * 8 + seed * TAU) * 0.08,
					),
				);
			}
		}
	}

	private async createModelProjectile(
		entity: CombatEntity,
		id: string,
		kind: 'arrow' | 'axe',
	): Promise<ProjectileView> {
		const root = new BABYLON.TransformNode(`${kind}:${id}`, this.scene);
		const model = await this.assets.instantiate(kind, `${kind}Model:${id}`);
		let parent = root;
		if (kind === 'axe') {
			parent = new BABYLON.TransformNode(`axeSpinner:${id}`, this.scene);
			parent.parent = root;
		}
		model.parent = parent;
		const transform = weaponModels[kind].combat;
		model.rotationQuaternion = null;
		model.position.set(...transform.position);
		model.rotation.set(...transform.rotation);
		model.scaling.setAll(transform.scale);
		if (kind === 'axe') {
			model.scaling.scaleInPlace(entity.scale);
			return new ProjectileView(entity, root, (deltaTimeS) => {
				parent.rotation.y += deltaTimeS * 12;
			});
		}
		return new ProjectileView(entity, root);
	}

	dispose(): void {
		this.fireballSource.dispose();
		this.fireballMaterial.dispose();
		this.fireballGlowSource.dispose();
		this.fireballGlowMaterial.dispose();
	}

	private hash(value: string): number {
		let hash = 2166136261;
		for (let index = 0; index < value.length; index++) {
			hash ^= value.charCodeAt(index);
			hash = Math.imul(hash, 16777619);
		}
		return (hash >>> 0) / 4294967295;
	}
}
