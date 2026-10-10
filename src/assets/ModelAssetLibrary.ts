import {
	LoadAssetContainerAsync,
	PBRMaterial,
	StandardMaterial,
	type AbstractMesh,
	type AnimationGroup,
	type AssetContainer,
	type Scene,
} from '@babylonjs/core';

export interface ModelInstance {
	root: AbstractMesh;
	animationGroups: AnimationGroup[];
}

export class ModelAssetLibrary {
	private readonly scene: Scene;
	private readonly containers = new Map<string, Promise<AssetContainer>>();

	constructor(scene: Scene) {
		this.scene = scene;
	}

	load(url: string): Promise<AssetContainer> {
		let container = this.containers.get(url);
		if (!container) {
			container = LoadAssetContainerAsync(url, this.scene).then(
				(loaded) => {
					for (const material of loaded.materials) {
						if (material instanceof StandardMaterial)
							material.disableLighting = true;
						if (material instanceof PBRMaterial)
							material.unlit = true;
					}
					return loaded;
				},
			);
			this.containers.set(url, container);
			container.catch(() => this.containers.delete(url));
		}
		return container;
	}

	async instantiate(url: string, name: string): Promise<ModelInstance> {
		const container = await this.load(url);
		const instance = container.instantiateModelsToScene(
			(nodeName) => `${name}:${nodeName}`,
		);
		return {
			root: instance.rootNodes[0] as AbstractMesh,
			animationGroups: instance.animationGroups,
		};
	}

	dispose(): void {
		this.containers.forEach((container) =>
			container.then((loaded) => loaded.dispose()).catch(() => {}),
		);
		this.containers.clear();
	}
}
