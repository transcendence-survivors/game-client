import {
	LoadAssetContainerAsync,
	type AbstractMesh,
	type AnimationGroup,
	type AssetContainer,
	type Scene,
} from '@babylonjs/core';

export interface ModelInstance {
	root: AbstractMesh;
	animationGroups: AnimationGroup[];
}

interface ModelInstantiationOptions {
	doNotInstantiate?: boolean;
}

export class ModelAssetLibrary {
	private readonly containers = new Map<string, Promise<AssetContainer>>();
	private readonly scene: Scene;

	constructor(scene: Scene) {
		this.scene = scene;
	}

	private load(url: string): Promise<AssetContainer> {
		const cached = this.containers.get(url);
		if (cached) return cached;
		const pending = LoadAssetContainerAsync(url, this.scene);
		this.containers.set(url, pending);
		void pending.catch(() => {
			if (this.containers.get(url) === pending)
				this.containers.delete(url);
		});
		return pending;
	}

	async instantiate(
		url: string,
		name: string,
		options?: ModelInstantiationOptions,
	): Promise<ModelInstance> {
		const container = await this.load(url);
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
		this.containers.forEach((pending) =>
			pending.then((container) => container.dispose()).catch(() => {}),
		);
		this.containers.clear();
	}
}
