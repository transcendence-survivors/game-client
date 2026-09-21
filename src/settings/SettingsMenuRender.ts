import type { Scene } from '@babylonjs/core';
import * as BABYLON from '@babylonjs/core';
import * as GUI from '@babylonjs/gui';
import { createFullscreenUi, getGuiControls, guiImports } from '../assets/ui';
import {
	DEFAULT_KEY_BINDINGS,
	KEY_ACTIONS,
	formatKeyLabel,
	type KeyBindings,
} from './KeyBindings';
import { gameI18n } from '../i18n';
import { setText } from '../i18n/gui';
import { STORAGE_KEY } from '../scenes/GameScene';

interface SettingsControls {
	fovSlider: GUI.Slider;
	fovValue: GUI.TextBlock;
	buttonBack: GUI.Button;
	buttonReset: GUI.Button;
}

type KeyButtons = Record<keyof KeyBindings, GUI.Button>;

const KEY_BUTTON_NAMES: { [K in keyof KeyBindings]: string } = {
	forward: 'Key_Forward',
	backward: 'Key_Backward',
	right: 'Key_Right',
	left: 'Key_Left',
	jump: 'Key_Jump',
	stats: 'Key_Stats',
	revive: 'Key_Revive',
};

export class SettingsMenuRender {
	private readonly scene: Scene;
	private advTex!: GUI.AdvancedDynamicTexture;
	public readonly ready: Promise<void>;
	private readonly camera: BABYLON.ArcRotateCamera;
	private keybinds: KeyBindings;
	private keyButtons!: KeyButtons;
	private awaitingBindFor: keyof KeyBindings | null = null;

	constructor(scene: Scene, camera: BABYLON.ArcRotateCamera) {
		this.scene = scene;
		this.camera = camera;
		this.keybinds = this.loadKeybindings();
		this.ready = this.init();
	}

	async init() {
		this.advTex = createFullscreenUi('SettingsUi', this.scene);
		const canvas = this.advTex.getContext().canvas;
		if (canvas instanceof HTMLCanvasElement) {
			canvas.style.zIndex = '1000';
		}
		await this.advTex.parseFromURLAsync(guiImports.settings);
		this.advTex.rootContainer.isVisible = false;
		this.applyTranslations();
		this.updatePointerEvents();
		this.linkControls();
	}

	public getKeybindings(): Readonly<KeyBindings> {
		return this.keybinds;
	}

	private saveKeybindings(bindings: Readonly<KeyBindings>) {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
		} catch (error) {
			console.warn('Failed to save keybindings:', error);
		}
	}

	private resetKeybindings() {
		localStorage.removeItem(STORAGE_KEY);
		return { ...DEFAULT_KEY_BINDINGS };
	}

	private loadKeybindings(): KeyBindings {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (!raw) {
				return { ...DEFAULT_KEY_BINDINGS };
			}
			const parsed = JSON.parse(raw);
			if (typeof parsed !== 'object' || parsed === null)
				return { ...DEFAULT_KEY_BINDINGS };

			const result = { ...DEFAULT_KEY_BINDINGS };
			for (const action of KEY_ACTIONS) {
				const value = (parsed as Record<string, unknown>)[action];
				if (typeof value === 'string' && value.length > 0) {
					result[action] = value;
				}
			}
			return result;
		} catch (error) {
			console.warn('Failed to load keybindings, using defaults:', error);
			return { ...DEFAULT_KEY_BINDINGS };
		}
	}

	private applyReset() {
		const defaults = this.resetKeybindings();
		Object.assign(this.keybinds, defaults);

		for (const action of KEY_ACTIONS) {
			this.setButtonLabel(this.keyButtons[action], this.keybinds[action]);
		}
	}

	dispose() {
		document.removeEventListener('keydown', this.boundKeyDown);
		this.advTex.dispose();
	}

	isOpen() {
		return this.advTex.rootContainer.isVisible;
	}

	open() {
		this.advTex.rootContainer.isVisible = true;
		this.updatePointerEvents();
	}

	close() {
		this.advTex.rootContainer.isVisible = false;
		this.updatePointerEvents();
	}

	private updatePointerEvents() {
		const layer = this.advTex.getContext().canvas;
		if (layer instanceof HTMLCanvasElement)
			layer.style.pointerEvents = this.isOpen() ? 'auto' : 'none';
	}

	private linkControls() {
		const { fovSlider, fovValue, buttonBack, buttonReset } =
			getGuiControls<SettingsControls>(this.advTex, {
				fovSlider: 'FovSlider',
				fovValue: 'FovValue',
				buttonBack: 'ButtonBack',
				buttonReset: 'ButtonReset',
			});
		this.keyButtons = getGuiControls<KeyButtons>(
			this.advTex,
			KEY_BUTTON_NAMES,
		);

		fovSlider.onValueChangedObservable.add((value) => {
			const rounded = Math.round(value);
			fovValue.text = rounded + '°';
			this.camera.fov = BABYLON.Tools.ToRadians(rounded);
		});

		buttonBack.onPointerUpObservable.add(() => this.close());

		buttonReset.onPointerUpObservable.add(() => this.applyReset());

		for (const action of KEY_ACTIONS) {
			const button = this.keyButtons[action];
			this.setButtonLabel(button, this.keybinds[action]);
			button.onPointerUpObservable.add(() =>
				this.beginRebind(action, button),
			);
		}
		document.addEventListener('keydown', this.boundKeyDown);
	}

	private beginRebind(action: keyof KeyBindings, button: GUI.Button) {
		this.awaitingBindFor = action;
		this.setButtonLabel(button, '...');
	}

	private handleRebindKeyDown(e: KeyboardEvent) {
		if (!this.awaitingBindFor) return;
		e.preventDefault();

		const action = this.awaitingBindFor;
		const key = e.key.toLowerCase();

		if (key === 'escape') {
			this.cancelRebind(action);
			return;
		}

		if (key === 'p') {
			this.showRebindError(action);
			return;
		}

		this.keybinds[action] = key;
		this.awaitingBindFor = null;

		this.setButtonLabel(this.keyButtons[action], key);
		this.saveKeybindings(this.keybinds);
	}

	private setButtonLabel(button: GUI.Button, label: string) {
		const textBlock =
			button.textBlock ??
			button.children.find((child) => child instanceof GUI.TextBlock);
		if (textBlock) textBlock.text = formatKeyLabel(label);
	}

	private cancelRebind(action: keyof KeyBindings) {
		this.awaitingBindFor = null;

		this.setButtonLabel(this.keyButtons[action], this.keybinds[action]);
	}

	private showRebindError(action: keyof KeyBindings) {
		const button = this.keyButtons[action];

		this.setButtonLabel(button, gameI18n.t('settings.reserved'));

		setTimeout(() => {
			if (this.awaitingBindFor === action) {
				this.setButtonLabel(button, '...');
			}
		}, 700);
	}

	private boundKeyDown = (e: KeyboardEvent) => this.handleRebindKeyDown(e);

	private applyTranslations(): void {
		const labels = {
			Title: 'settings.title',
			FovLabel: 'settings.fieldOfView',
			KeysLabel: 'settings.keyBindings',
			Label_Forward: 'settings.moveForward',
			Label_Backward: 'settings.moveBackward',
			Label_Left: 'settings.moveLeft',
			Label_Right: 'settings.moveRight',
			Label_Jump: 'settings.jump',
			Label_Stats: 'settings.stats',
			Label_Revive: 'settings.revive',
			ButtonReset_text: 'settings.resetDefaults',
			ButtonBack_text: 'settings.back',
		} as const;

		for (const [controlName, key] of Object.entries(labels)) {
			setText(this.advTex, controlName, gameI18n.t(key));
		}
	}
}
