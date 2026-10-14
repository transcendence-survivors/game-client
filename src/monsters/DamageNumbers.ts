import * as BABYLON from '@babylonjs/core';
import * as GUI from '@babylonjs/gui';
import type { MonsterDamageEvent } from '@transcendence/game-shared';
import { createFullscreenUi } from '../assets/ui';

const LABEL_ABOVE_HEAD = 1.5;
const FONT_SIZE = 22;
const COLOR = '#ffe14d';
const FATAL_COLOR = '#ff5a3c';
const LIFETIME_S = 0.9;
const RISE_PX = 58;
const START_OFFSET_PX = -8;
const JITTER_PX = 26;
const MAX_VISIBLE_LABELS = 72;

interface DamageLabel {
	text: GUI.TextBlock;
	anchor: BABYLON.TransformNode;
	elapsedS: number;
}

export class DamageNumbers {
	private readonly scene: BABYLON.Scene;
	private readonly ui: GUI.AdvancedDynamicTexture;
	private readonly activeLabels: DamageLabel[] = [];
	private readonly labelPool: DamageLabel[] = [];

	constructor(scene: BABYLON.Scene) {
		this.scene = scene;
		this.ui = createFullscreenUi('monsterOverlay', scene);
	}

	spawn(event: MonsterDamageEvent, headHeight: number): void {
		const roundedAmount = Math.round(event.amount);
		const isFull = this.activeLabels.length >= MAX_VISIBLE_LABELS;
		if (roundedAmount <= 0 || (isFull && !event.fatal)) return;
		const label = this.labelPool.pop() ?? this.createLabel();
		label.anchor.position.set(
			event.x,
			event.y + headHeight + LABEL_ABOVE_HEAD,
			event.z,
		);
		label.elapsedS = 0;
		Object.assign(label.text, {
			text: `-${roundedAmount}`,
			color: event.fatal ? FATAL_COLOR : COLOR,
			fontSize: FONT_SIZE,
			linkOffsetX: (Math.random() - 0.5) * JITTER_PX,
			linkOffsetY: START_OFFSET_PX,
			alpha: 1,
			isVisible: true,
		});
		this.activeLabels.push(label);
	}

	update(deltaTime: number): void {
		for (let i = this.activeLabels.length - 1; i >= 0; i--) {
			const label = this.activeLabels[i];
			label.elapsedS += deltaTime;
			const progress = label.elapsedS / LIFETIME_S;
			if (progress >= 1) {
				label.text.isVisible = false;
				this.activeLabels[i] =
					this.activeLabels[this.activeLabels.length - 1];
				this.activeLabels.pop();
				this.labelPool.push(label);
				continue;
			}
			label.text.linkOffsetY = START_OFFSET_PX - RISE_PX * progress;
			label.text.alpha = progress < 0.5 ? 1 : 2 - 2 * progress;
		}
	}

	dispose(): void {
		for (const label of [...this.activeLabels, ...this.labelPool])
			label.anchor.dispose();
		this.ui.dispose();
	}

	private createLabel(): DamageLabel {
		const anchor = new BABYLON.TransformNode(
			'damageLabelAnchor',
			this.scene,
		);
		const text = Object.assign(new GUI.TextBlock('damageLabel'), {
			fontWeight: 'bold',
			outlineColor: 'black',
			outlineWidth: 4,
			resizeToFit: true,
		});
		this.ui.addControl(text);
		text.linkWithMesh(anchor);
		return { text, anchor, elapsedS: 0 };
	}
}
