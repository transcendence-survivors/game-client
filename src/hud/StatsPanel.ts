import type { Scene } from '@babylonjs/core';
import * as GUI from '@babylonjs/gui';
import * as COLYSEUS from '@colyseus/sdk';
import type { GameState } from '@transcendence/game-shared';
import { createFullscreenUi } from '../assets/ui';
import { gameI18n } from '../i18n';
import { formatKeyLabel } from '../settings/KeyBindings';
import { formatGameTime } from './HudFormatting';
import { HUD_THEME, hudText, styleHudPanel } from './HudTheme';
import { readStatValue, STAT_DEFS, type StatDef } from './StatDefinitions';

const PANEL_SCALE = 0.85;
const PANEL_WIDTH = 640;
const HEADER_HEIGHT = 86;
const FOOTER_HEIGHT = 42;
const COLUMN_COUNT = 2;
const COLUMN_WIDTH = 300;
const ROW_HEIGHT = 40;
const ICON_SIZE = 22;

export class StatsPanel {
	private readonly advTex: GUI.AdvancedDynamicTexture;
	private readonly room: COLYSEUS.Room<GameState>;
	private readonly panel: GUI.Rectangle;
	private readonly subtitle: GUI.TextBlock;
	private readonly hint: GUI.TextBlock;
	private readonly values: GUI.TextBlock[] = [];

	constructor(scene: Scene, room: COLYSEUS.Room<GameState>) {
		this.room = room;
		this.advTex = createFullscreenUi('StatsPanelUi', scene);
		this.advTex.useInvalidateRectOptimization = true;
		const rowCount = Math.ceil(STAT_DEFS.length / COLUMN_COUNT);

		this.panel = new GUI.Rectangle('StatsPanel');
		this.panel.width = `${PANEL_WIDTH}px`;
		const bodyHeight = rowCount * ROW_HEIGHT;
		this.panel.height = `${HEADER_HEIGHT + bodyHeight + FOOTER_HEIGHT}px`;
		this.panel.horizontalAlignment =
			GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
		this.panel.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
		this.panel.scaleX = PANEL_SCALE;
		this.panel.scaleY = PANEL_SCALE;
		this.panel.zIndex = 30;
		this.panel.isVisible = false;
		styleHudPanel(this.panel, HUD_THEME.gold);
		this.advTex.rootContainer.addControl(this.panel);

		const title = hudText(
			'StatsPanelTitle',
			gameI18n.t('stats.title').toUpperCase(),
			22,
			HUD_THEME.goldBright,
		);
		title.fontWeight = 'bold';
		title.height = '32px';
		title.top = '16px';
		title.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
		this.panel.addControl(title);

		this.subtitle = hudText('StatsPanelSubtitle', '', 13, HUD_THEME.muted);
		this.subtitle.fontWeight = 'bold';
		this.subtitle.height = '22px';
		this.subtitle.top = '48px';
		this.subtitle.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
		this.panel.addControl(this.subtitle);

		const divider = new GUI.Rectangle('StatsPanelDivider');
		divider.width = `${COLUMN_COUNT * COLUMN_WIDTH}px`;
		divider.height = '1px';
		divider.top = `${HEADER_HEIGHT - 12}px`;
		divider.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
		divider.background = HUD_THEME.border;
		divider.thickness = 0;
		divider.isHitTestVisible = false;
		this.panel.addControl(divider);

		STAT_DEFS.forEach((def, index) => {
			this.values.push(this.createStatRow(def, index));
		});

		this.hint = hudText('StatsPanelHint', '', 12, HUD_THEME.muted);
		this.hint.height = '20px';
		this.hint.top = '-14px';
		this.hint.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
		this.panel.addControl(this.hint);
	}

	private createStatRow(def: StatDef, index: number): GUI.TextBlock {
		const column = index % COLUMN_COUNT;
		const row = Math.floor(index / COLUMN_COUNT);
		const cell = new GUI.Container(`StatsPanelRow${index}`);
		cell.width = `${COLUMN_WIDTH}px`;
		cell.height = `${ROW_HEIGHT}px`;
		cell.top = `${HEADER_HEIGHT + row * ROW_HEIGHT}px`;
		cell.left = `${(column - (COLUMN_COUNT - 1) / 2) * COLUMN_WIDTH}px`;
		cell.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
		this.panel.addControl(cell);

		const icon = new GUI.Image(`StatsPanelRow${index}Icon`, def.icon);
		icon.width = `${ICON_SIZE}px`;
		icon.height = `${ICON_SIZE}px`;
		icon.left = '14px';
		icon.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
		icon.stretch = GUI.Image.STRETCH_UNIFORM;
		icon.isHitTestVisible = false;
		cell.addControl(icon);

		const label = hudText(
			`StatsPanelRow${index}Label`,
			gameI18n.t(def.labelKey),
			14,
			HUD_THEME.text,
		);
		label.width = `${COLUMN_WIDTH - 174}px`;
		label.left = `${ICON_SIZE + 24}px`;
		label.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
		label.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
		cell.addControl(label);

		const value = hudText(
			`StatsPanelRow${index}Value`,
			'-',
			15,
			HUD_THEME.goldBright,
		);
		value.fontWeight = 'bold';
		value.width = '124px';
		value.left = '-14px';
		value.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
		value.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
		cell.addControl(value);
		return value;
	}

	isOpen(): boolean {
		return this.panel.isVisible;
	}

	open(toggleKey: string): void {
		this.hint.text = gameI18n.t('stats.hint', {
			key: formatKeyLabel(toggleKey),
		});
		this.panel.isVisible = true;
		this.update();
	}

	close(): void {
		this.panel.isVisible = false;
	}

	toggle(toggleKey: string): void {
		if (this.isOpen()) this.close();
		else this.open(toggleKey);
	}

	update(): void {
		if (!this.isOpen()) return;
		const player = this.room.state.players.get(this.room.sessionId);
		if (!player) return;
		const level = gameI18n.t('hud.level');
		const time = formatGameTime(this.room.state.combatTimeS);
		setTextIfChanged(
			this.subtitle,
			`${level} ${player.experience.level} · ${time}`.toUpperCase(),
		);
		STAT_DEFS.forEach((def, index) => {
			const value = this.values[index];
			if (value)
				setTextIfChanged(value, readStatValue(player.stats, def));
		});
	}

	dispose(): void {
		this.advTex.dispose();
	}
}

function setTextIfChanged(control: GUI.TextBlock, text: string): void {
	if (control.text !== text) control.text = text;
}
