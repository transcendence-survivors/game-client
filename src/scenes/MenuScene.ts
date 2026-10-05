import * as BABYLON from '@babylonjs/core';
import * as GUI from '@babylonjs/gui';
import { guiImports } from '../assets/ui';

export abstract class MenuScene {
	protected scene!: BABYLON.Scene;
	protected advTex!: GUI.AdvancedDynamicTexture;
	private videoTexture?: BABYLON.VideoTexture;
	private backgroundLayer?: BABYLON.Layer;
	protected disposed = false;

	protected createScene(engine: BABYLON.Engine, cameraName: string) {
		this.scene = new BABYLON.Scene(engine);
		new BABYLON.FreeCamera(cameraName, BABYLON.Vector3.Zero(), this.scene);
	}

	protected createUi(name: string) {
		this.advTex = GUI.AdvancedDynamicTexture.CreateFullscreenUI(
			name,
			true,
			this.scene,
		);
		this.advTex.idealWidth = 1920;
		this.advTex.idealHeight = 1080;
		this.advTex.renderAtIdealSize = true;
	}

	protected async loadBackground(isDisposed: () => boolean) {
		const bg = await createBackgroundVideo(this.scene, isDisposed);
		if (!bg || isDisposed()) return false;
		this.videoTexture = bg.videoTexture;
		this.backgroundLayer = bg.backgroundLayer;
		return true;
	}

	dispose() {
		this.disposed = true;
		if (this.videoTexture) this.videoTexture.dispose();
		if (this.backgroundLayer) this.backgroundLayer.dispose();
		if (this.advTex) this.advTex.dispose();
		if (this.scene) this.scene.dispose();
	}
}

async function createBackgroundVideo(
	scene: BABYLON.Scene,
	isDisposed: () => boolean,
) {
	const video = document.createElement('video');
	video.muted = true;
	video.loop = true;
	video.playsInline = true;
	video.crossOrigin = 'anonymous';
	video.src = guiImports.testVideo;

	const loaded = await new Promise<boolean>((resolve) => {
		video.addEventListener('canplay', () => resolve(true), { once: true });
		video.addEventListener('error', () => resolve(false), { once: true });
	});

	if (!loaded || isDisposed()) {
		video.removeAttribute('src');
		video.load();
		return null;
	}
	const videoTexture = new BABYLON.VideoTexture(
		'menuTrailer',
		video,
		scene,
		true,
		false,
		BABYLON.VideoTexture.TRILINEAR_SAMPLINGMODE,
		{
			autoPlay: true,
			muted: true,
			loop: true,
			autoUpdateTexture: true,
		},
	);

	const backgroundLayer = new BABYLON.Layer(
		'menuBackground',
		null,
		scene,
		true,
	);
	backgroundLayer.texture = videoTexture;

	return { videoTexture, backgroundLayer };
}
