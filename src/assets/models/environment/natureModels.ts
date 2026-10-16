/**
 * Curated models from Quaternius' Stylized Nature MegaKit.
 *
 * The source pack contains many variants. These representative variants keep
 * the procedural stream varied without making every nearby chunk load dozens
 * of large duplicate texture payloads.
 */
export const natureModels = {
	tree: [
		new URL('./stylized-nature/CommonTree_1.glb', import.meta.url).href,
		new URL('./stylized-nature/CommonTree_3.glb', import.meta.url).href,
		new URL('./stylized-nature/Pine_1.glb', import.meta.url).href,
		new URL('./stylized-nature/TwistedTree_1.glb', import.meta.url).href,
	],
	rock: [
		new URL('./stylized-nature/Rock_Medium_1.glb', import.meta.url).href,
		new URL('./stylized-nature/Rock_Medium_2.glb', import.meta.url).href,
		new URL('./stylized-nature/Pebble_Round_1.glb', import.meta.url).href,
		new URL('./stylized-nature/Pebble_Round_3.glb', import.meta.url).href,
	],
	bush: [
		new URL('./stylized-nature/Bush_Common.glb', import.meta.url).href,
		new URL('./stylized-nature/Bush_Common_Flowers.glb', import.meta.url)
			.href,
	],
	grass: [
		new URL('./stylized-nature/Grass_Common_Short.glb', import.meta.url)
			.href,
		new URL('./stylized-nature/Grass_Common_Tall.glb', import.meta.url)
			.href,
		new URL('./stylized-nature/Grass_Wispy_Short.glb', import.meta.url)
			.href,
		new URL('./stylized-nature/Grass_Wispy_Tall.glb', import.meta.url).href,
	],
	flower: [
		new URL('./stylized-nature/Fern_1.glb', import.meta.url).href,
		new URL('./stylized-nature/Flower_3_Group.glb', import.meta.url).href,
		new URL('./stylized-nature/Flower_4_Group.glb', import.meta.url).href,
		new URL('./stylized-nature/Mushroom_Common.glb', import.meta.url).href,
		new URL('./stylized-nature/Plant_1.glb', import.meta.url).href,
		new URL('./stylized-nature/Plant_7.glb', import.meta.url).href,
	],
} as const;
