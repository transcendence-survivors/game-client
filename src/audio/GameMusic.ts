import {
	CreateAudioEngineAsync,
	CreateStreamingSoundAsync,
} from '@babylonjs/core';

const MUSIC_URL = new URL(
	'../assets/music/cursed-crown-run.wav',
	import.meta.url,
).href;

export class GameMusic {
	private readonly ready = CreateAudioEngineAsync({
		disableDefaultUI: true,
	}).then(async (engine) => ({
		engine,
		sound: await CreateStreamingSoundAsync(
			'gameMusic',
			MUSIC_URL,
			{ loop: true, volume: 0.1 },
			engine,
		),
	}));

	play(): void {
		this.ready.then(({ sound }) => sound.play()).catch(() => {});
	}

	dispose(): void {
		this.ready.then(({ engine }) => engine.dispose()).catch(() => {});
	}
}
