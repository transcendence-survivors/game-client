import { MusicPlayer, type MusicTrack } from './MusicPlayer';

export const GAME_MUSIC_TRACKS: readonly MusicTrack[] = [
	{
		id: 'cursed-crown-run',
		src: new URL('../assets/music/cursed-crown-run.wav', import.meta.url)
			.href,
		volume: 0.1,
	},
];

export function createGameMusic(): MusicPlayer {
	return new MusicPlayer(GAME_MUSIC_TRACKS);
}
