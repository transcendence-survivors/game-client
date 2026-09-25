import type { Engine, Scene } from '@babylonjs/core';
import * as BABYLON from '@babylonjs/core';
import * as GUI from '@babylonjs/gui';
import { SceneManager } from './SceneManager';
import { createFullscreenUi, getGuiControl, guiImports } from '../assets/ui';
import { GAME_LOCALES, gameI18n, type GameLocale } from '../i18n';
import { setText } from '../i18n/gui';

const MENU_CARD_WIDTH_PX = 380;
const MENU_HORIZONTAL_PADDING_PX = 28;
const MENU_CONTROL_WIDTH = `${MENU_CARD_WIDTH_PX - MENU_HORIZONTAL_PADDING_PX * 2}px`;
const LANGUAGE_OPTION_HEIGHT_PX = 36;
const LANGUAGE_OPTION_SPACING_PX = 2;
const LANGUAGE_OPTIONS_HEIGHT = `${
	GAME_LOCALES.length * LANGUAGE_OPTION_HEIGHT_PX +
	(GAME_LOCALES.length - 1) * LANGUAGE_OPTION_SPACING_PX
}px`;

export class MainMenuScene {
	private engine: Engine;
	private scene: Scene;
	public readonly ready: Promise<void>;
	private advTex!: GUI.AdvancedDynamicTexture;
	private languageButton!: GUI.Button;
	private languageOptions!: GUI.StackPanel;
	private readonly languageOptionButtons = new Map<GameLocale, GUI.Button>();
	private languageOptionsOpen = false;
	private unsubscribeLocale?: () => void;

	constructor(engine: Engine) {
		this.engine = engine;
		this.scene = new BABYLON.Scene(this.engine);
		this.scene.clearColor = new BABYLON.Color4(0.07, 0.06, 0.055, 1);

		new BABYLON.FreeCamera('MenuCam', BABYLON.Vector3.Zero(), this.scene);
		const light = new BABYLON.HemisphericLight(
			'ambientLight',
			new BABYLON.Vector3(0, 1, 0),
			this.scene,
		);
		light.intensity = 0.6;
		light.diffuse = BABYLON.Color3.FromHexString('#E5A832');
		light.groundColor = BABYLON.Color3.FromHexString('#131110');
		this.ready = this.show();
	}

	render() {
		this.scene.render();
	}

	async show() {
		this.advTex = createFullscreenUi('MainMenuUi', this.scene);
		await this.advTex.parseFromURLAsync(guiImports.main);
		this.linkControls();
	}

	dispose() {
		this.unsubscribeLocale?.();
		this.advTex.dispose();
		this.scene.dispose();
	}

	private linkControls() {
		const playButton = getGuiControl<GUI.Button>(this.advTex, 'PlayButton');
		const menuStack = getGuiControl<GUI.StackPanel>(
			this.advTex,
			'menuStack',
		);
		const idleBackground = '#E5A832';
		const hoverBackground = '#D8982A';

		menuStack.paddingLeft = '0px';
		menuStack.paddingRight = '0px';
		for (const controlName of ['title', 'divider']) {
			getGuiControl<GUI.Control>(this.advTex, controlName).width =
				MENU_CONTROL_WIDTH;
		}
		playButton.width = MENU_CONTROL_WIDTH;
		this.configureHover(playButton, idleBackground, hoverBackground);

		playButton.onPointerUpObservable.add(() => {
			SceneManager.toLobby();
		});

		this.languageButton = GUI.Button.CreateSimpleButton(
			'LanguageButton',
			'',
		);
		this.languageButton.width = MENU_CONTROL_WIDTH;
		this.languageButton.height = '48px';
		this.languageButton.paddingTop = '8px';
		this.languageButton.cornerRadius = 4;
		this.languageButton.thickness = 1;
		this.languageButton.color = idleBackground;
		this.languageButton.background = 'transparent';
		this.languageButton.fontFamily =
			'Manrope, ui-sans-serif, system-ui, sans-serif';
		this.languageButton.fontSize = 14;
		this.languageButton.fontWeight = '600';
		this.languageButton.hoverCursor = 'pointer';
		this.configureHover(this.languageButton, 'transparent', '#312E28');
		this.languageButton.onPointerUpObservable.add(() => {
			this.setLanguageOptionsOpen(!this.languageOptionsOpen);
		});
		menuStack.addControl(this.languageButton);

		this.languageOptions = new GUI.StackPanel('LanguageOptions');
		this.languageOptions.width = MENU_CONTROL_WIDTH;
		this.languageOptions.height = '0px';
		this.languageOptions.isVisible = false;
		this.languageOptions.spacing = LANGUAGE_OPTION_SPACING_PX;
		for (const locale of GAME_LOCALES) {
			const option = GUI.Button.CreateSimpleButton(
				`LanguageOption-${locale}`,
				'',
			);
			option.width = '100%';
			option.height = `${LANGUAGE_OPTION_HEIGHT_PX}px`;
			option.thickness = 1;
			option.color = idleBackground;
			option.background = '#171513';
			option.fontFamily = 'Manrope, ui-sans-serif, system-ui, sans-serif';
			option.fontSize = 13;
			option.hoverCursor = 'pointer';
			this.configureHover(option, '#171513', '#312E28');
			option.onPointerUpObservable.add(() => {
				gameI18n.setLocale(locale);
				this.setLanguageOptionsOpen(false);
			});
			this.languageOptionButtons.set(locale, option);
			this.languageOptions.addControl(option);
		}
		menuStack.addControl(this.languageOptions);

		this.unsubscribeLocale = gameI18n.subscribe(() =>
			this.applyTranslations(),
		);
		this.applyTranslations();
	}

	private applyTranslations(): void {
		setText(this.advTex, 'title', gameI18n.t('menu.title'));
		const title = getGuiControl<GUI.TextBlock>(this.advTex, 'title');
		title.fontSize = 22;
		setText(this.advTex, 'btn_play_text', gameI18n.t('menu.play'));

		const localeName = gameI18n.t(`language.${gameI18n.getLocale()}`);
		if (this.languageButton.textBlock) {
			const arrow = this.languageOptionsOpen ? '▴' : '▾';
			this.languageButton.textBlock.text = `${gameI18n.t(
				'menu.language',
				{
					language: localeName,
				},
			)}  ${arrow}`;
		}

		for (const [locale, button] of this.languageOptionButtons) {
			if (!button.textBlock) continue;
			const label = gameI18n.t(`language.${locale}`);
			button.textBlock.text =
				locale === gameI18n.getLocale() ? `✓  ${label}` : label;
		}
	}

	private setLanguageOptionsOpen(open: boolean): void {
		this.languageOptionsOpen = open;
		this.languageOptions.isVisible = open;
		this.languageOptions.height = open ? LANGUAGE_OPTIONS_HEIGHT : '0px';
		this.applyTranslations();
	}

	private configureHover(
		button: GUI.Button,
		idleBackground: string,
		hoverBackground: string,
	): void {
		button.onPointerEnterObservable.add(() => {
			button.background = hoverBackground;
		});
		button.onPointerOutObservable.add(() => {
			button.background = idleBackground;
		});
	}
}
