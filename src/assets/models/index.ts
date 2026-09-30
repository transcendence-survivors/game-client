import { forestModels } from './environment/forestModels';
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
	monster: {
		dog: new URL('./monster/ultimate/dog.glb', import.meta.url).href,
		blob: new URL('./monster/ultimate/green-blob.glb', import.meta.url)
			.href,
		cactoro: new URL('./monster/ultimate/cactoro.glb', import.meta.url)
			.href,
		ninja: new URL('./monster/ultimate/ninja.glb', import.meta.url).href,
		spikyBlob: new URL(
			'./monster/ultimate/green-spiky-blob.glb',
			import.meta.url,
		).href,
		orc: new URL('./monster/ultimate/orc.glb', import.meta.url).href,
		pinkBlob: new URL('./monster/ultimate/pink-blob.glb', import.meta.url)
			.href,
		mushnub: new URL('./monster/ultimate/mushnub.glb', import.meta.url)
			.href,
		wizard: new URL('./monster/ultimate/wizard.glb', import.meta.url).href,
		ghost: new URL('./monster/ultimate/ghost.glb', import.meta.url).href,
		mushroomKing: new URL(
			'./boss/ultimate/mushroom-king.glb',
			import.meta.url,
		).href,
		orcSkull: new URL('./boss/ultimate/orc-skull.glb', import.meta.url)
			.href,
		yeti: new URL('./boss/ultimate/yeti.glb', import.meta.url).href,
		demon: new URL('./boss/ultimate/demon.glb', import.meta.url).href,
	},
	environment: {
		forest: forestModels,
	},
} as const;

export function getMonsterDisplayName(kind: string): string {
	return getMonsterDefinition(kind)?.displayName ?? kind;
}

export function getMonsterModelUrl(kind: string): string | undefined {
	const modelId = getMonsterDefinition(kind)?.modelId;
	return modelId ? models.monster[modelId] : undefined;
}
