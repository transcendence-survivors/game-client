import * as GUI from '@babylonjs/gui';
import { HUD_THEME, hudText, styleHudPanel } from './HudTheme';
import { HUD_BAR_FILL_PERCENT, HUD_BAR_INSET_PERCENT } from './HudConstants';

const BOTTOM_PANEL_WIDTH = '250px';
const BOTTOM_PANEL_HEIGHT = '102px';
const BOTTOM_PANEL_TOP = '-9.25px';

interface HudBarControls {
	track: GUI.Rectangle;
	fill: GUI.Rectangle;
}

type HudBarTextVariant = 'boss' | 'experience' | 'health';

export function createHudBar(
	name: string,
	parent: GUI.Container,
	width: string,
	height: string,
	top: string,
	background: string,
	fillColor: string,
): HudBarControls {
	const track = new GUI.Rectangle(name);
	track.width = width;
	track.height = height;
	track.top = top;
	track.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
	track.background = background;
	track.color = HUD_THEME.barBorder;
	track.thickness = 1;
	track.cornerRadius = 6;
	track.isPointerBlocker = false;
	parent.addControl(track);

	const fill = new GUI.Rectangle(`${name}Fill`);
	fill.width = `${HUD_BAR_FILL_PERCENT}%`;
	fill.height = '76%';
	fill.left = HUD_BAR_INSET_PERCENT;
	fill.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
	fill.background = fillColor;
	fill.thickness = 0;
	fill.cornerRadius = 4;
	fill.isHitTestVisible = false;
	track.addControl(fill);
	return { track, fill };
}

export function addHudBarHighlight(fill: GUI.Rectangle): void {
	const highlight = new GUI.Rectangle(`${fill.name}Highlight`);
	highlight.width = 1;
	highlight.height = '34%';
	highlight.top = '8%';
	highlight.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
	highlight.background = HUD_THEME.barHighlight;
	highlight.thickness = 0;
	highlight.isHitTestVisible = false;
	fill.addControl(highlight);
}

export function addHudBarText(
	track: GUI.Rectangle,
	name: string,
	labelText: string,
	valueText: string,
	variant: HudBarTextVariant,
): GUI.TextBlock {
	const compact = variant === 'experience';
	const label = hudText(
		`${name}Label`,
		labelText,
		compact ? 10 : variant === 'boss' ? 11 : 12,
		'#FFFFFFFF',
	);
	label.fontWeight = 'bold';
	label.width = compact ? '40px' : '46px';
	if (compact) label.height = '17px';
	else if (variant === 'health') label.height = '32px';
	label.left = compact ? '10px' : '13px';
	label.top = compact ? '2px' : '3px';
	label.outlineColor = compact ? '#061D1ADD' : '#250A0CDD';
	label.outlineWidth = 2;
	label.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
	label.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
	label.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
	track.addControl(label);

	const value = hudText(
		variant === 'boss' ? `${name}Text` : `${name}BarText`,
		valueText,
		compact ? 10 : 16,
		compact ? '#D8F8F3FF' : undefined,
	);
	value.fontWeight = 'bold';
	value.top = compact ? '2px' : '3px';
	value.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
	if (compact) {
		value.width = '110px';
		value.left = '-10px';
		value.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
		value.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
	}
	track.addControl(value);
	return value;
}

export function createBottomHudPanel(
	root: GUI.Container,
	name: string,
	offset: number,
	accent: string,
	scale: number,
): GUI.Rectangle {
	const panel = new GUI.Rectangle(name);
	panel.width = BOTTOM_PANEL_WIDTH;
	panel.height = BOTTOM_PANEL_HEIGHT;
	panel.left = `${offset}px`;
	panel.top = BOTTOM_PANEL_TOP;
	panel.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
	panel.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
	panel.scaleX = scale;
	panel.scaleY = scale;
	panel.zIndex = 20;
	styleHudPanel(panel, accent);
	root.addControl(panel);
	return panel;
}
