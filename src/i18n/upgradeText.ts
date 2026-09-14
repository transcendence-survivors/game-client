import type {
	TomeId,
	TomeStat,
	UpgradeDisplayEffect,
	UpgradeOption,
	WeaponKind,
	WeaponUpgradeStat,
} from '@transcendence/game-shared';
import { gameI18n } from './GameI18n';
import type { GameLocale, TranslationKey } from './types';

const TOME_NAME_KEYS: Readonly<Record<TomeId, TranslationKey>> = {
	damage: 'tome.damage',
	cooldown: 'tome.cooldown',
	agility: 'tome.agility',
	vitality: 'tome.vitality',
	armor: 'tome.armor',
	blood: 'tome.blood',
	range: 'tome.range',
	size: 'tome.size',
	duration: 'tome.duration',
	quantity: 'tome.quantity',
	fortune: 'tome.fortune',
};

const WEAPON_NAME_KEYS: Readonly<Record<WeaponKind, TranslationKey>> = {
	aura: 'weapon.aura',
	sword: 'weapon.sword',
	axe: 'weapon.axe',
	staff: 'weapon.staff',
	bow: 'weapon.bow',
};

const TOME_TRAIT_KEYS: Readonly<Record<TomeStat, TranslationKey>> = {
	attackDamage: 'trait.damage',
	attackSpeed: 'trait.attackSpeed',
	moveSpeed: 'trait.moveSpeed',
	lifesteal: 'trait.lifestealPoints',
	range: 'trait.range',
	armor: 'trait.armor',
	maxHealth: 'trait.maxHealth',
	size: 'trait.size',
	duration: 'trait.duration',
	quantity: 'trait.projectile',
	penetration: 'trait.penetration',
	luck: 'trait.rarityChance',
};

const WEAPON_TRAIT_KEYS: Readonly<Record<WeaponUpgradeStat, TranslationKey>> = {
	damageBonus: 'trait.damage',
	attackRateBonus: 'trait.attackSpeed',
	rangeBonus: 'trait.range',
	durationBonus: 'trait.duration',
	sizeBonus: 'trait.size',
	speedBonus: 'trait.projectileSpeed',
	quantityBonus: 'trait.projectile',
	penetrationBonus: 'trait.penetration',
	knockbackBonus: 'trait.knockback',
};

const NUMBER_LOCALES: Readonly<Record<GameLocale, string>> = {
	fr: 'fr-FR',
	en: 'en-US',
	de: 'de-DE',
	es: 'es-ES',
	che: 'de-CH',
	it: 'it-IT',
};
const numberFormatters = new Map<string, Intl.NumberFormat>();

function localizedWeaponName(weaponKind: WeaponKind): string {
	return gameI18n.t(WEAPON_NAME_KEYS[weaponKind]);
}

function traitKey(effect: UpgradeDisplayEffect): TranslationKey {
	if (
		(effect.stat === 'quantity' || effect.stat === 'quantityBonus') &&
		Math.abs(effect.value) !== 1
	)
		return 'trait.projectiles';
	return effect.source === 'tome'
		? TOME_TRAIT_KEYS[effect.stat]
		: WEAPON_TRAIT_KEYS[effect.stat];
}

function formatEffectValue(effect: UpgradeDisplayEffect): string {
	const locale = gameI18n.getLocale();
	const maximumFractionDigits = effect.format === 'integer' ? 0 : 1;
	const cacheKey = `${locale}:${maximumFractionDigits}`;
	let formatter = numberFormatters.get(cacheKey);
	if (!formatter) {
		formatter = new Intl.NumberFormat(NUMBER_LOCALES[locale], {
			maximumFractionDigits,
		});
		numberFormatters.set(cacheKey, formatter);
	}
	const number = formatter.format(effect.value);
	return `+${number}${effect.format === 'percent' ? ' %' : ''}`;
}

export function localizeUpgradeTitle(option: UpgradeOption): {
	title: string;
	level: string;
} {
	if (option.category === 'unlock')
		return {
			title: gameI18n.t('upgrade.unlock', {
				weapon: localizedWeaponName(option.weaponKind),
			}),
			level: '',
		};

	const title =
		option.category === 'tome'
			? gameI18n.t(TOME_NAME_KEYS[option.tomeId])
			: localizedWeaponName(option.weaponKind);
	return {
		title,
		level: gameI18n.t('upgrade.level', { level: option.level }),
	};
}

export function localizeUpgradeDescription(option: UpgradeOption): string {
	if (option.category === 'unlock')
		return gameI18n.t('upgrade.addedToArsenal');
	return option.effects
		.map((effect) =>
			gameI18n.t('upgrade.value', {
				value: formatEffectValue(effect),
				attribute: gameI18n.t(traitKey(effect)),
			}),
		)
		.join('\n');
}

export function localizeUpgradeCategory(option: UpgradeOption): string {
	if (option.category === 'unlock') return gameI18n.t('upgrade.newWeapon');
	return gameI18n.t('upgrade.categoryRarity', {
		category: gameI18n.t(
			option.category === 'tome' ? 'upgrade.tome' : 'upgrade.weapon',
		),
		rarity: gameI18n.t(`rarity.${option.rarity}`),
	});
}
