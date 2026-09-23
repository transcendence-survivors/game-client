import type { Scene } from '@babylonjs/core';
import * as GUI from '@babylonjs/gui';

export const guiImports = {
	lobby: new URL('./lobby_ui.json', import.meta.url).href,
	main: new URL('./main_menu.json', import.meta.url).href,
	settings: new URL('./settings_menu.json', import.meta.url).href,
	levelup: new URL('./level_up_menu.json', import.meta.url).href,
	endingScreen: new URL('./ending_screen.json', import.meta.url).href,
	waitingScreen: new URL('./waiting_room_ui.json', import.meta.url).href,
	testVideo: new URL('./test.mp4', import.meta.url).href,
} as const;

export function createFullscreenUi(
	name: string,
	scene?: Scene,
): GUI.AdvancedDynamicTexture {
	const ui = GUI.AdvancedDynamicTexture.CreateFullscreenUI(name, true, scene);
	const layer = ui.layer;
	if (layer) layer.applyPostProcess = false;
	ui.idealWidth = 1920;
	ui.idealHeight = 1080;
	ui.useSmallestIdeal = true;
	ui.renderAtIdealSize = true;
	return ui;
}

export function getGuiControls<T>(
	ui: GUI.AdvancedDynamicTexture,
	names: { [K in keyof T]: string },
): T {
	return Object.fromEntries(
		Object.entries(names as Record<string, string>).map(([key, name]) => {
			const control = ui.getControlByName(name);
			if (!control) throw new Error(`Missing GUI control: ${name}`);
			return [key, control];
		}),
	) as T;
}

export function getGuiControl<T extends GUI.Control>(
	ui: GUI.AdvancedDynamicTexture,
	name: string,
): T {
	return getGuiControls<{ control: T }>(ui, { control: name }).control;
}
