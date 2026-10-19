import { natureModels } from './environment/natureModels';
import { getMonsterDefinition } from '@transcendence/game-shared';

export const models = {
	player: new URL(
		'./players/modular-character/female-peasant.glb',
		import.meta.url,
	).href,
	sword: new URL('./weapons/quaternius/sword.glb', import.meta.url).href,
	axe: new URL('./weapons/quaternius/double-axe.glb', import.meta.url).href,
	staff: new URL('./weapons/quaternius/staff.glb', import.meta.url).href,
	bow: new URL('./weapons/quaternius/wooden-bow.glb', import.meta.url).href,
	arrow: new URL('./weapons/quaternius/arrow.glb', import.meta.url).href,
	fireball: new URL('./weapons/fireball.glb', import.meta.url).href,
	nature: natureModels,
} as const;

const monsters: Record<string, { model: string; animations: string }> = {
	dog: {
		model: new URL('./monster/ultimate/dog.glb', import.meta.url).href,
		animations: new URL('./monster/ultimate/dog.vat.bin', import.meta.url)
			.href,
	},
	blob: {
		model: new URL('./monster/ultimate/green-blob.glb', import.meta.url)
			.href,
		animations: new URL(
			'./monster/ultimate/green-blob.vat.bin',
			import.meta.url,
		).href,
	},
	cactoro: {
		model: new URL('./monster/ultimate/cactoro.glb', import.meta.url).href,
		animations: new URL(
			'./monster/ultimate/cactoro.vat.bin',
			import.meta.url,
		).href,
	},
	ninja: {
		model: new URL('./monster/ultimate/ninja.glb', import.meta.url).href,
		animations: new URL('./monster/ultimate/ninja.vat.bin', import.meta.url)
			.href,
	},
	spikyBlob: {
		model: new URL(
			'./monster/ultimate/green-spiky-blob.glb',
			import.meta.url,
		).href,
		animations: new URL(
			'./monster/ultimate/green-spiky-blob.vat.bin',
			import.meta.url,
		).href,
	},
	orc: {
		model: new URL('./monster/ultimate/orc.glb', import.meta.url).href,
		animations: new URL('./monster/ultimate/orc.vat.bin', import.meta.url)
			.href,
	},
	pinkBlob: {
		model: new URL('./monster/ultimate/pink-blob.glb', import.meta.url)
			.href,
		animations: new URL(
			'./monster/ultimate/pink-blob.vat.bin',
			import.meta.url,
		).href,
	},
	mushnub: {
		model: new URL('./monster/ultimate/mushnub.glb', import.meta.url).href,
		animations: new URL(
			'./monster/ultimate/mushnub.vat.bin',
			import.meta.url,
		).href,
	},
	wizard: {
		model: new URL('./monster/ultimate/wizard.glb', import.meta.url).href,
		animations: new URL(
			'./monster/ultimate/wizard.vat.bin',
			import.meta.url,
		).href,
	},
	ghost: {
		model: new URL('./monster/ultimate/ghost.glb', import.meta.url).href,
		animations: new URL('./monster/ultimate/ghost.vat.bin', import.meta.url)
			.href,
	},
	mushroomKing: {
		model: new URL('./boss/ultimate/mushroom-king.glb', import.meta.url)
			.href,
		animations: new URL(
			'./boss/ultimate/mushroom-king.vat.bin',
			import.meta.url,
		).href,
	},
	orcSkull: {
		model: new URL('./boss/ultimate/orc-skull.glb', import.meta.url).href,
		animations: new URL(
			'./boss/ultimate/orc-skull.vat.bin',
			import.meta.url,
		).href,
	},
	yeti: {
		model: new URL('./boss/ultimate/yeti.glb', import.meta.url).href,
		animations: new URL('./boss/ultimate/yeti.vat.bin', import.meta.url)
			.href,
	},
	demon: {
		model: new URL('./boss/ultimate/demon.glb', import.meta.url).href,
		animations: new URL('./boss/ultimate/demon.vat.bin', import.meta.url)
			.href,
	},
};

export function getMonsterDisplayName(kind: string): string {
	return getMonsterDefinition(kind)?.displayName ?? kind;
}

export function getAllMonsterAssets() {
	return Object.entries(monsters).map(([id, files]) => ({ id, ...files }));
}
