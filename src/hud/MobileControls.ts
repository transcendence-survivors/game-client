import type { Scene } from '@babylonjs/core';
import * as GUI from '@babylonjs/gui';
import { createFullscreenUi } from '../assets/ui';
import { HUD_THEME, styleHudPanel } from './HudTheme';

export type MobileAction = 'jump' | 'stats' | 'revive';

const BUTTON_SIZE = 68;
const BUTTON_GAP = 20;
const BUTTON_MARGIN = 24;
const PRESSED_ALPHA = 0.55;

export class MobileControls {
	private readonly advTex: GUI.AdvancedDynamicTexture;
	private readonly pressed = new Set<MobileAction>();

	constructor(scene: Scene) {
		this.advTex = createFullscreenUi('MobileControls', scene);

		const jumpButton = this.createButton(
			'MobileJumpButton',
			'⬆',
			HUD_THEME.gold,
		);
		jumpButton.leftInPixels = -BUTTON_MARGIN;
		jumpButton.topInPixels = -BUTTON_MARGIN;
		this.bindButton(jumpButton, 'jump');

		const reviveButton = this.createButton(
			'MobileReviveButton',
			'♥',
			HUD_THEME.boss,
		);
		reviveButton.leftInPixels = -(BUTTON_MARGIN + BUTTON_SIZE + BUTTON_GAP);
		reviveButton.topInPixels = -BUTTON_MARGIN;
		this.bindButton(reviveButton, 'revive');

		const statsButton = this.createButton(
			'MobileStatsButton',
			'☰',
			HUD_THEME.xp,
		);
		statsButton.leftInPixels = -(
			BUTTON_MARGIN +
			2 * (BUTTON_SIZE + BUTTON_GAP)
		);
		statsButton.topInPixels = -BUTTON_MARGIN;
		this.bindButton(statsButton, 'stats');
	}

	isPressed(action: MobileAction) {
		return this.pressed.has(action);
	}

	dispose() {
		this.pressed.clear();
		this.advTex.dispose();
	}

	private createButton(name: string, label: string, color: string) {
		const btn = GUI.Button.CreateSimpleButton(name, label);
		styleHudPanel(btn, color);
		btn.widthInPixels = BUTTON_SIZE;
		btn.heightInPixels = BUTTON_SIZE;
		btn.cornerRadius = BUTTON_SIZE / 2;
		btn.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
		btn.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
		btn.isPointerBlocker = true;
		if (btn.textBlock) {
			btn.textBlock.fontWeight = 'bold';
			btn.textBlock.fontSizeInPixels = 28;
			btn.textBlock.color = HUD_THEME.text;
		}
		this.advTex.addControl(btn);
		return btn;
	}

	private bindButton(btn: GUI.Button, action: MobileAction) {
		btn.onPointerDownObservable.add(() =>
			this.setPressed(btn, action, true),
		);
		btn.onPointerUpObservable.add(() =>
			this.setPressed(btn, action, false),
		);
		btn.onPointerOutObservable.add(() =>
			this.setPressed(btn, action, false),
		);
	}

	private setPressed(
		btn: GUI.Button,
		action: MobileAction,
		isPressed: boolean,
	) {
		if (isPressed) this.pressed.add(action);
		else this.pressed.delete(action);
		btn.alpha = isPressed ? PRESSED_ALPHA : 1;
	}
}
