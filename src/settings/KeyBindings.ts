import { gameI18n } from '../i18n';

export const KEY_ACTIONS = [
	'forward',
	'backward',
	'right',
	'left',
	'jump',
	'stats',
	'revive',
	'upgrade1',
	'upgrade2',
	'upgrade3',
	'fov',
] as const;

export type KeyBindings = Record<(typeof KEY_ACTIONS)[number], string>;

export const DEFAULT_KEY_BINDINGS: Readonly<KeyBindings> = {
	forward: 'w',
	backward: 's',
	left: 'a',
	right: 'd',
	jump: ' ',
	stats: 'c',
	revive: 'f',
	upgrade1: '1',
	upgrade2: '2',
	upgrade3: '3',
	fov: '90',
};

export function formatKeyLabel(key: string): string {
	return key === ' ' ? gameI18n.t('settings.space') : key.toUpperCase();
}
