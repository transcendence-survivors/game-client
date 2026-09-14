import { afterEach, describe, expect, it } from 'vitest';
import type { UpgradeOption } from '@transcendence/game-shared';
import { gameI18n } from './GameI18n';
import {
	localizeUpgradeCategory,
	localizeUpgradeDescription,
	localizeUpgradeTitle,
} from './upgradeText';

const vitality: UpgradeOption = {
	id: 'tome_vitality:test',
	iconUrl: 'tomeVitality',
	rarity: 'epic',
	category: 'tome',
	tomeId: 'vitality',
	level: 2,
	effects: [
		{
			source: 'tome',
			stat: 'maxHealth',
			value: 22.5,
			format: 'percent',
		},
	],
};

describe('localized upgrade cards', () => {
	afterEach(() => gameI18n.setLocale('en'));

	it('localizes the complete card in English', () => {
		gameI18n.setLocale('en');
		expect(localizeUpgradeTitle(vitality)).toEqual({
			title: 'Tome of Vitality',
			level: 'LEVEL 2',
		});
		expect(localizeUpgradeDescription(vitality)).toBe('+22.5 % max health');
		expect(localizeUpgradeCategory(vitality)).toBe('Tome · Epic');
	});

	it('localizes weapon bonuses and unlocks in Italian', () => {
		gameI18n.setLocale('it');
		const weapon: UpgradeOption = {
			id: 'weapon_bow:test',
			iconUrl: 'weaponBow',
			rarity: 'rare',
			category: 'weapon',
			weaponKind: 'bow',
			level: 3,
			effects: [
				{
					source: 'weapon',
					stat: 'damageBonus',
					value: 20,
					format: 'percent',
				},
				{
					source: 'weapon',
					stat: 'quantityBonus',
					value: 2,
					format: 'integer',
				},
			],
		};
		expect(localizeUpgradeTitle(weapon)).toEqual({
			title: 'Arco',
			level: 'LIVELLO 3',
		});
		expect(localizeUpgradeDescription(weapon)).toBe(
			'+20 % danni\n+2 proiettili',
		);

		const unlock: UpgradeOption = {
			id: 'unlock_bow:test',
			iconUrl: 'weaponBow',
			rarity: 'common',
			category: 'unlock',
			weaponKind: 'bow',
			effects: [],
		};
		expect(localizeUpgradeTitle(unlock).title).toBe('Sblocca Arco');
		expect(localizeUpgradeDescription(unlock)).toBe(
			'Aggiunta al tuo arsenale',
		);
	});
});
