import * as GUI from '@babylonjs/gui';

export const setText = (
	ui: GUI.AdvancedDynamicTexture,
	controlName: string,
	text: string,
): void => {
	const control = ui.getControlByName(controlName);
	if (control instanceof GUI.TextBlock) control.text = text;
};

export const setInputPlaceholder = (
	ui: GUI.AdvancedDynamicTexture,
	controlName: string,
	text: string,
): void => {
	const control = ui.getControlByName(controlName);
	if (control instanceof GUI.InputText) control.placeholderText = text;
};
