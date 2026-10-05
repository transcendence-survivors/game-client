import type { AbstractMesh, AnimationGroup, Scene } from '@babylonjs/core';
import { AssetContainerCache } from './AssetContainerCache';

export interface ModelInstance {
	root: AbstractMesh;
	animationGroups: AnimationGroup[];
}

interface ModelInstantiationOptions {
	doNotInstantiate?: boolean;
}

export class ModelAssetLibrary {
	private readonly assets: AssetContainerCache;

	constructor(scene: Scene, assets = new AssetContainerCache(scene)) {
		this.assets = assets;
	}

	async instantiate(
		url: string,
		name: string,
		options?: ModelInstantiationOptions,
	): Promise<ModelInstance> {
		const container = await this.assets.load(url);
		const nameFunction = (nodeName: string) => `${name}:${nodeName}`;
		const instance = options
			? container.instantiateModelsToScene(nameFunction, false, options)
			: container.instantiateModelsToScene(nameFunction, false);
		return {
			root: instance.rootNodes[0] as AbstractMesh,
			animationGroups: instance.animationGroups,
		};
	}

	dispose(): void {
		this.assets.dispose();
	}
}
