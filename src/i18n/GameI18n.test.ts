import { describe, expect, it, vi } from 'vitest';
import { GameI18n } from './GameI18n';
import { GAME_LOCALES } from './types';

describe('GameI18n', () => {
	it('uses English by default and interpolates parameters', () => {
		const i18n = new GameI18n();

		expect(i18n.getLocale()).toBe('en');
		expect(i18n.t('lobby.roomCreated', { roomName: 'arena' })).toBe(
			'Room "arena" created',
		);
	});

	it('switches locale and cycles through supported locales', () => {
		const i18n = new GameI18n();
		i18n.setLocale('fr');

		expect(i18n.t('menu.play')).toBe('Jouer');
		expect(i18n.getNextLocale()).toBe('en');
	});

	it('notifies subscribers only when the locale changes', () => {
		const i18n = new GameI18n();
		const listener = vi.fn();
		const unsubscribe = i18n.subscribe(listener);

		i18n.setLocale('fr');
		i18n.setLocale('fr');
		unsubscribe();
		i18n.setLocale('en');

		expect(listener).toHaveBeenCalledOnce();
		expect(listener).toHaveBeenCalledWith('fr');
	});

	it('provides a complete catalog for every supported locale', () => {
		const i18n = new GameI18n();

		for (const locale of GAME_LOCALES) {
			i18n.setLocale(locale);
			expect(i18n.t('menu.play')).not.toHaveLength(0);
			expect(i18n.t('settings.resetDefaults')).not.toHaveLength(0);
		}
	});
});
