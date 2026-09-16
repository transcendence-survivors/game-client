export interface MusicTrack {
	readonly id: string;
	readonly src: string;
	readonly volume?: number;
}

interface AudioPlayback {
	src: string;
	preload: string;
	volume: number;
	loop: boolean;
	currentTime: number;
	play(): Promise<void>;
	pause(): void;
	load(): void;
	addEventListener(type: 'ended', listener: EventListener): void;
	removeEventListener(type: 'ended', listener: EventListener): void;
}

type AudioFactory = () => AudioPlayback;

const AUTOPLAY_UNLOCK_EVENTS = ['pointerdown', 'keydown'] as const;

export class MusicPlayer {
	private readonly tracks: readonly MusicTrack[];
	private readonly audio: AudioPlayback;
	private readonly unlockTarget: EventTarget;
	private currentTrack = 0;
	private wantsToPlay = false;
	private waitingForUnlock = false;
	private disposed = false;

	constructor(
		tracks: readonly MusicTrack[],
		audioFactory: AudioFactory = () => new Audio(),
		unlockTarget: EventTarget = document,
	) {
		this.tracks = tracks;
		this.audio = audioFactory();
		this.unlockTarget = unlockTarget;
		this.audio.preload = 'auto';
		this.audio.addEventListener('ended', this.onTrackEnded);
		this.loadCurrentTrack();
	}

	play(): void {
		if (this.disposed || this.tracks.length === 0) return;
		this.wantsToPlay = true;
		void this.tryToPlay();
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.wantsToPlay = false;
		this.removeUnlockListeners();
		this.audio.removeEventListener('ended', this.onTrackEnded);
		this.audio.pause();
		this.audio.currentTime = 0;
		this.audio.src = '';
		this.audio.load();
	}

	private loadCurrentTrack(): void {
		const track = this.tracks[this.currentTrack];
		if (!track) return;
		this.audio.src = track.src;
		this.audio.volume = Math.min(1, Math.max(0, track.volume ?? 1));
		this.audio.loop = this.tracks.length === 1;
		this.audio.load();
	}

	private async tryToPlay(): Promise<void> {
		if (!this.wantsToPlay || this.disposed) return;
		try {
			await this.audio.play();
			this.removeUnlockListeners();
		} catch {
			this.addUnlockListeners();
		}
	}

	private readonly onTrackEnded: EventListener = () => {
		if (!this.wantsToPlay || this.disposed || this.tracks.length === 0)
			return;
		this.currentTrack = (this.currentTrack + 1) % this.tracks.length;
		this.loadCurrentTrack();
		void this.tryToPlay();
	};

	private readonly onAutoplayUnlock: EventListener = () => {
		this.removeUnlockListeners();
		void this.tryToPlay();
	};

	private addUnlockListeners(): void {
		if (this.waitingForUnlock || this.disposed) return;
		this.waitingForUnlock = true;
		for (const event of AUTOPLAY_UNLOCK_EVENTS)
			this.unlockTarget.addEventListener(event, this.onAutoplayUnlock);
	}

	private removeUnlockListeners(): void {
		if (!this.waitingForUnlock) return;
		this.waitingForUnlock = false;
		for (const event of AUTOPLAY_UNLOCK_EVENTS)
			this.unlockTarget.removeEventListener(event, this.onAutoplayUnlock);
	}
}
