import { describe, expect, test } from 'vitest';
import {
	PLAYER_CLIP_CANDIDATES,
	clipNameMatches,
	findPlayerClip,
} from './PlayerAnimation';

const groups = (...names: string[]) => names.map((name) => ({ name }));

describe('clipNameMatches', () => {
	test('matches the segment after the instantiation prefix', () => {
		expect(clipNameMatches('localPlayer:Walk_Loop', 'Walk_Loop')).toBe(
			true,
		);
		expect(
			clipNameMatches('remotePlayer:abc123:LayToIdle', 'LayToIdle'),
		).toBe(true);
	});

	test('ignores case and rejects partial names', () => {
		expect(clipNameMatches('localPlayer:walk_loop', 'Walk_Loop')).toBe(
			true,
		);
		expect(clipNameMatches('localPlayer:Walk_Loop_Fast', 'Walk_Loop')).toBe(
			false,
		);
	});
});

describe('findPlayerClip', () => {
	test('honours the candidate order', () => {
		const found = findPlayerClip(
			groups('p:Walk_Formal_Loop', 'p:Walk_Loop'),
			PLAYER_CLIP_CANDIDATES.walk,
		);
		expect(found?.name).toBe('p:Walk_Loop');
	});

	test('falls back to the next candidate', () => {
		const found = findPlayerClip(
			groups('p:Walk_Carry_Loop'),
			PLAYER_CLIP_CANDIDATES.walk,
		);
		expect(found?.name).toBe('p:Walk_Carry_Loop');
	});

	test('returns undefined when no candidate is present', () => {
		expect(
			findPlayerClip(groups('p:Yes'), PLAYER_CLIP_CANDIDATES.idle),
		).toBeUndefined();
	});
});

describe('downed clips', () => {
	const shipped = groups(
		'localPlayer:Hit_Knockback',
		'localPlayer:LayToIdle',
		'localPlayer:Walk_Loop',
		'localPlayer:Idle_No_Loop',
	);

	test('resolves the fall and stand-up clips of the shipped model', () => {
		expect(
			findPlayerClip(shipped, PLAYER_CLIP_CANDIDATES.knockdown)?.name,
		).toBe('localPlayer:Hit_Knockback');
		expect(findPlayerClip(shipped, PLAYER_CLIP_CANDIDATES.getUp)?.name).toBe(
			'localPlayer:LayToIdle',
		);
	});
});
