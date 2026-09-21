import type { PlayerStats } from '@transcendence/game-shared';
import { iconsImport } from '../assets/icons';
import type { TranslationKey } from '../i18n';

export interface StatDef {
	key: keyof PlayerStats;
	labelKey: TranslationKey;
	icon: string;
	format?: (value: number) => string;
}

export const STAT_DEFS: readonly StatDef[] = [
	{
		key: 'attackDamage',
		labelKey: 'stats.damage',
		icon: iconsImport.tomeDamage,
	},
	{
		key: 'attackSpeed',
		labelKey: 'stats.attackSpeed',
		icon: iconsImport.attackSpeed,
		format: (v) => `${v.toFixed(2)}/s`,
	},
	{
		key: 'moveSpeed',
		labelKey: 'stats.moveSpeed',
		icon: iconsImport.tomeAgility,
	},
	{
		key: 'armor',
		labelKey: 'stats.armor',
		icon: iconsImport.tomeArmor,
		format: (v) => `${Math.round(v)}`,
	},
	{
		key: 'lifesteal',
		labelKey: 'stats.lifesteal',
		icon: iconsImport.tomeBlood,
		format: (v) => `${v.toFixed(1)}%`,
	},
	{ key: 'range', labelKey: 'stats.range', icon: iconsImport.tomeRange },
	{
		key: 'maxHealth',
		labelKey: 'stats.maxHealth',
		icon: iconsImport.tomeVitality,
	},
	{
		key: 'size',
		labelKey: 'stats.size',
		icon: iconsImport.tomeSize,
		format: (v) => `${(v * 100).toFixed(0)}%`,
	},
	{
		key: 'duration',
		labelKey: 'stats.duration',
		icon: iconsImport.tomeDuration,
		format: (v) => `${(v * 100).toFixed(0)}%`,
	},
	{
		key: 'quantity',
		labelKey: 'stats.quantity',
		icon: iconsImport.tomeQuantity,
		format: (v) => `+${Math.round(v)}`,
	},
	{
		key: 'penetration',
		labelKey: 'stats.penetration',
		icon: iconsImport.penetration,
		format: (v) => `+${Math.round(v)}`,
	},
	{
		key: 'luck',
		labelKey: 'stats.luck',
		icon: iconsImport.tomeFortune,
		format: (v) => `${v.toFixed(2)}x`,
	},
	{
		key: 'killAmount',
		labelKey: 'stats.kills',
		icon: iconsImport.kills,
		format: (v) => `${Math.round(v)}`,
	},
];

function formatStatNumber(value: number): string {
	if (!Number.isFinite(value)) return '-';
	const rounded = Math.round(value * 100) / 100;
	return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

export function readStatValue(stats: PlayerStats, def: StatDef): string {
	const raw = stats[def.key] as number;
	return def.format ? def.format(raw) : formatStatNumber(raw);
}
