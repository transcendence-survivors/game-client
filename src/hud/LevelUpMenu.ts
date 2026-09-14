import type { Scene } from '@babylonjs/core';
import * as GUI from '@babylonjs/gui';
import { createFullscreenUi } from '../assets/ui';
import type { Room } from '@colyseus/sdk';
import {
	ClientMessage,
	ServerMessage,
	UPGRADE_CHOICE_COUNT,
	type UpgradeOption,
} from '@transcendence/game-shared';
import { iconsImport } from '../assets/icons';
import { CleanupBag } from '../CleanupBag';
import { HUD_THEME } from '../hud/HudTheme';
import { guiImports } from '../assets/ui';
import {
	gameI18n,
	localizeUpgradeCategory,
	localizeUpgradeDescription,
	localizeUpgradeTitle,
} from '../i18n';

interface UpgradeCardControls {
	panel: GUI.Rectangle;
	accent: GUI.Rectangle;
	iconFrame: GUI.Ellipse;
	icon: GUI.Image;
	title: GUI.TextBlock;
	level: GUI.TextBlock;
	description: GUI.TextBlock;
	separator: GUI.Rectangle;
	rarityBadge: GUI.Rectangle;
	rarityText: GUI.TextBlock;
	accentColor: string;
}

const RARITY_COLORS: Readonly<Record<UpgradeOption['rarity'], string>> = {
	common: '#B8C4C0FF',
	uncommon: '#58D68DFF',
	rare: '#4DA8FFFF',
	epic: '#C56CFFFF',
	legendary: HUD_THEME.goldBright,
};

export class LevelUpMenu {
	private advTex!: GUI.AdvancedDynamicTexture;
	private levelUpRootContainer!: GUI.Rectangle;
	private currentOptions: readonly UpgradeOption[] = [];
	private pendingLevels = 0;
	private awaitingOptions = false;
	private readonly room: Room;
	private cards: UpgradeCardControls[] = [];
	private readonly subscriptions = new CleanupBag();
	private disposed = false;

	constructor(scene: Scene, room: Room) {
		this.room = room;
		this.init(scene);
	}

	private async init(scene: Scene) {
		this.advTex = createFullscreenUi('LevelUpUI', scene);
		this.advTex.useInvalidateRectOptimization = true;
		await this.advTex.parseFromURLAsync(guiImports.levelup);
		this.levelUpRootContainer = this.advTex.getControlByName(
			'LevelUpRoot',
		) as GUI.Rectangle;
		this.levelUpRootContainer.isVisible = false;
		(this.advTex.getControlByName('LevelUpHeading') as GUI.TextBlock).text =
			gameI18n.t('upgrade.heading');
		(
			this.advTex.getControlByName('LevelUpSubtitle') as GUI.TextBlock
		).text = gameI18n.t('upgrade.subtitle');
		this.cards = Array.from({ length: UPGRADE_CHOICE_COUNT }, (_, index) =>
			this.getCardControls(index),
		);
		this.linkControls();
	}

	private getCardControls(index: number): UpgradeCardControls {
		const panel = this.advTex.getControlByName(
			`UpgradeCard${index}`,
		) as GUI.Rectangle;
		const accent = this.advTex.getControlByName(
			`UpgradeCard${index}Accent`,
		) as GUI.Rectangle;
		const iconFrame = this.advTex.getControlByName(
			`UpgradeCard${index}IconFrame`,
		) as GUI.Ellipse;
		const icon = this.advTex.getControlByName(
			`UpgradeCard${index}Icon`,
		) as GUI.Image;
		const title = this.advTex.getControlByName(
			`UpgradeCard${index}Title`,
		) as GUI.TextBlock;
		const level = this.advTex.getControlByName(
			`UpgradeCard${index}Level`,
		) as GUI.TextBlock;
		const description = this.advTex.getControlByName(
			`UpgradeCard${index}Description`,
		) as GUI.TextBlock;
		const separator = this.advTex.getControlByName(
			`UpgradeCard${index}Separator`,
		) as GUI.Rectangle;
		const rarityBadge = this.advTex.getControlByName(
			`UpgradeCard${index}RarityBadge`,
		) as GUI.Rectangle;
		const rarityText = this.advTex.getControlByName(
			`UpgradeCard${index}Rarity`,
		) as GUI.TextBlock;

		return {
			panel,
			accent,
			iconFrame,
			icon,
			title,
			level,
			description,
			separator,
			rarityBadge,
			rarityText,
			accentColor: HUD_THEME.gold,
		};
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.subscriptions.dispose();
		this.advTex.dispose();
	}

	private updateCards(options: readonly UpgradeOption[]): void {
		this.cards.forEach((card, index) => {
			const {
				panel,
				accent,
				iconFrame,
				icon,
				title,
				level,
				description,
				separator,
				rarityBadge,
				rarityText,
			} = card;
			const option = options[index];
			panel.isVisible = Boolean(option);
			if (!option) return;
			icon.source = iconsImport[option.iconUrl];
			const cardTitle = localizeUpgradeTitle(option);
			title.text = cardTitle.title;
			title.top = cardTitle.level ? '141px' : '153px';
			level.text = cardTitle.level;
			level.isVisible = Boolean(cardTitle.level);
			description.text = localizeUpgradeDescription(option);
			const color =
				option.category === 'unlock'
					? HUD_THEME.goldBright
					: RARITY_COLORS[option.rarity];
			card.accentColor = color;
			panel.color = color;
			accent.background = color;
			iconFrame.color = color;
			iconFrame.shadowColor = `${color.slice(0, 7)}66`;
			separator.background = color;
			rarityBadge.color = color;
			rarityText.color = color;
			rarityText.text = localizeUpgradeCategory(option).toUpperCase();
		});
	}

	private requestNextOptions(): void {
		if (this.pendingLevels <= 0) {
			this.levelUpRootContainer.isVisible = false;
			return;
		}
		if (this.awaitingOptions) return;
		this.awaitingOptions = true;
		this.room.send(ClientMessage.RequestUpgradeOptions);
	}

	private linkControls(): void {
		this.cards.forEach((card, index) => {
			const { panel } = card;
			const clickObserver = panel.onPointerClickObservable.add(() =>
				this.selectUpgrade(index),
			);
			const enterObserver = panel.onPointerEnterObservable.add(() => {
				panel.background = HUD_THEME.panelHover;
				panel.color = HUD_THEME.goldBright;
				panel.scaleX = 1.025;
				panel.scaleY = 1.025;
			});
			const outObserver = panel.onPointerOutObservable.add(() => {
				panel.background = HUD_THEME.panelSoft;
				panel.color = card.accentColor;
				panel.scaleX = 1;
				panel.scaleY = 1;
			});
			this.subscriptions.add(() => {
				panel.onPointerClickObservable.remove(clickObserver);
				panel.onPointerEnterObservable.remove(enterObserver);
				panel.onPointerOutObservable.remove(outObserver);
			});
		});
		const keyDownHandler = (e: KeyboardEvent) => {
			if (!this.levelUpRootContainer.isVisible) return;
			const selectionIndex = Number(e.key) - 1;
			if (
				Number.isInteger(selectionIndex) &&
				selectionIndex >= 0 &&
				selectionIndex < UPGRADE_CHOICE_COUNT
			)
				this.selectUpgrade(selectionIndex);
		};
		window.addEventListener('keydown', keyDownHandler);
		this.subscriptions.add(() =>
			window.removeEventListener('keydown', keyDownHandler),
		);
		this.subscriptions.add(
			this.room.onMessage(ServerMessage.LevelUp, () => this.onLevelUp()),
		);
		this.subscriptions.add(
			this.room.onMessage(
				ServerMessage.UpgradeOptions,
				(options: readonly UpgradeOption[]) => {
					this.awaitingOptions = false;
					this.currentOptions = options;
					if (options.length === 0) {
						this.pendingLevels = 0;
						this.levelUpRootContainer.isVisible = false;
						return;
					}
					this.updateCards(options);
					this.levelUpRootContainer.isVisible = true;
				},
			),
		);
	}

	private onLevelUp(): void {
		this.pendingLevels++;
		if (!this.levelUpRootContainer.isVisible) this.requestNextOptions();
	}

	private selectUpgrade(index: number): void {
		if (!this.levelUpRootContainer.isVisible) return;

		const chosen = this.currentOptions[index];
		if (!chosen) return;

		this.room.send(ClientMessage.SelectUpgrade, { id: chosen.id });

		this.pendingLevels--;
		this.levelUpRootContainer.isVisible = false;
		this.requestNextOptions();
	}
}
