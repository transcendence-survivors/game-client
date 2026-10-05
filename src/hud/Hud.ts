import * as GUI from '@babylonjs/gui';
import type { Scene } from '@babylonjs/core';
import * as COLYSEUS from '@colyseus/sdk';
import {
	COMBAT_LIMITS,
	TOME_DEFINITIONS,
	TOME_SLOT_LIMIT,
	WEAPON_ICONS,
	WEAPON_KINDS,
	type GameState,
	type Monster,
	type Player,
	type TomeId,
	type WeaponKind,
} from '@transcendence/game-shared';
import { createFullscreenUi } from '../assets/ui';
import { iconsImport } from '../assets/icons';
import { getMonsterDisplayName } from '../assets/models';
import { CleanupBag, CleanupRegistry } from '../CleanupBag';
import { HUD_THEME, hudText, styleHudPanel } from './HudTheme';
import {
	addHudBarHighlight,
	addHudBarText,
	createBottomHudPanel,
	createHudBar,
} from './HudPrimitives';
import { formatGameTime, hudBarWidth, isLivingBoss } from './HudFormatting';
import { gameI18n } from '../i18n';

interface HudControls {
	hpBar: GUI.Rectangle;
	hpText: GUI.TextBlock;
	xpBar: GUI.Rectangle;
	xpText: GUI.TextBlock;
	levelText: GUI.TextBlock;
	killText: GUI.TextBlock;
	timerText: GUI.TextBlock;
	bossPanel: GUI.Rectangle;
	bossName: GUI.TextBlock;
	bossHealthFill: GUI.Rectangle;
	bossHealthText: GUI.TextBlock;
	weaponCountText: GUI.TextBlock;
	weaponSlots: ItemSlotControls[];
	tomeCountText: GUI.TextBlock;
	tomeSlots: ItemSlotControls[];
	teamPanel: GUI.Rectangle;
	teamCountText: GUI.TextBlock;
	teammateSlots: TeammateSlotControls[];
	downedPanel: GUI.Rectangle;
	downedHint: GUI.TextBlock;
}

type StateCallbacks = ReturnType<typeof COLYSEUS.Callbacks.get<GameState>>;

interface ItemSlotControls {
	panel: GUI.Rectangle;
	icon: GUI.Image;
	name: GUI.TextBlock;
	level: GUI.TextBlock;
}

interface TeammateSlotControls {
	panel: GUI.Container;
	status: GUI.Ellipse;
	name: GUI.TextBlock;
	healthFill: GUI.Rectangle;
	healthText: GUI.TextBlock;
}

interface ItemSlotPanelControls {
	countText: GUI.TextBlock;
	slots: ItemSlotControls[];
}

const HUD_SCALE = 0.75;
const BOTTOM_PANEL_OFFSET = 316;
const COUNTER_PANEL_HEIGHT = 68;
const COUNTER_PANEL_TOP = 15.5;
const KILL_PANEL_WIDTH = 176;
const TIMER_PANEL_WIDTH = 212;
const TIMER_PANEL_LEFT = 139.5;
const ITEM_SLOT_SPACING = 7;
const ITEM_SLOT_ROW_WIDTH = 226;
const WEAPON_SLOT_WIDTH = 70;
const TOME_SLOT_WIDTH = 51;
const EMPTY_SLOT_BACKGROUND = '#0B1417D9';
const FILLED_SLOT_BACKGROUND = '#172326F2';
const TEAM_HEADER_HEIGHT = 36;
const TEAM_SLOT_HEIGHT = 44;
const compareIds = (first: string, second: string): number =>
	first.localeCompare(second);
const TOME_ICONS = new Map(
	TOME_DEFINITIONS.map(({ id, iconUrl }) => [id, iconUrl] as const),
);

export class Hud {
	private readonly advTex: GUI.AdvancedDynamicTexture;
	private readonly room: COLYSEUS.Room<GameState>;
	private readonly subscriptions = new CleanupBag();
	private readonly playerSubscriptions = new CleanupRegistry<string>();
	private readonly bossSubscriptions = new CleanupRegistry<string>();
	private readonly controls: HudControls;
	private readonly teammateIds: string[] = [];
	private activeBossId = '';
	private reviveKeyLabel = '';
	private teamDirty = true;
	private weaponsDirty = true;
	private tomesDirty = true;
	private bossDirty = true;
	private playerDirty = true;
	private killsDirty = true;
	private lastTimerSecond = Number.NaN;
	private readonly markPlayerDirty = (): void => {
		this.playerDirty = true;
	};
	private readonly markTeamDirty = (): void => {
		this.teamDirty = true;
	};
	private readonly markWeaponsDirty = (): void => {
		this.weaponsDirty = true;
	};
	private readonly markTomesDirty = (): void => {
		this.tomesDirty = true;
	};
	private readonly markBossDirty = (): void => {
		this.bossDirty = true;
	};
	private readonly markKillsDirty = (): void => {
		this.killsDirty = true;
	};

	constructor(scene: Scene, room: COLYSEUS.Room<GameState>) {
		this.room = room;
		this.advTex = createFullscreenUi('Hud', scene);
		this.advTex.useInvalidateRectOptimization = true;
		this.controls = this.buildHud();
		this.bindStateCallbacks();
	}

	private bindStateCallbacks(): void {
		const callbacks = COLYSEUS.Callbacks.get(this.room);
		this.subscriptions.add(
			callbacks.onAdd('players', (player, sessionId) =>
				this.bindPlayer(callbacks, player, sessionId),
			),
		);
		this.subscriptions.add(
			callbacks.onRemove('players', (_player, sessionId) => {
				this.playerSubscriptions.delete(sessionId);
				if (sessionId === this.room.sessionId) {
					this.weaponsDirty = true;
					this.tomesDirty = true;
					this.playerDirty = true;
				} else this.teamDirty = true;
			}),
		);
		this.subscriptions.add(
			callbacks.onAdd('monsters', (monster, monsterId) => {
				if (monster.isBoss)
					this.bindBoss(callbacks, monster, monsterId);
			}),
		);
		this.subscriptions.add(
			callbacks.onRemove('monsters', (_monster, monsterId) => {
				if (monsterId !== this.activeBossId) return;
				this.bossSubscriptions.delete(monsterId);
				this.activeBossId = '';
				this.markBossDirty();
			}),
		);
		this.subscriptions.add(
			callbacks.listen('totalKills', this.markKillsDirty),
		);
	}

	private updateKillHud() {
		this.killsDirty = false;
		this.controls.killText.text = String(this.room.state.totalKills);
	}

	private bindPlayer(
		callbacks: StateCallbacks,
		player: Player,
		sessionId: string,
	): void {
		const subscriptions = this.playerSubscriptions.replace(sessionId);
		if (sessionId === this.room.sessionId)
			this.bindLocalPlayer(callbacks, player, subscriptions);
		else this.bindTeammate(callbacks, player, subscriptions);
	}

	private bindLocalPlayer(
		callbacks: StateCallbacks,
		player: Player,
		subscriptions: CleanupBag,
	): void {
		subscriptions.add(
			callbacks.onChange(player.life, this.markPlayerDirty),
			callbacks.onChange(player.experience, this.markPlayerDirty),
			callbacks.listen(player, 'isDowned', this.markPlayerDirty),
		);
		const weaponSubscriptions = new CleanupRegistry<string>();
		subscriptions.add(
			() => weaponSubscriptions.dispose(),
			callbacks.onAdd(player, 'weapons', (weapon, weaponId) => {
				const weaponScope = weaponSubscriptions.replace(weaponId);
				weaponScope.add(
					callbacks.listen(weapon, 'level', this.markWeaponsDirty),
				);
				this.markWeaponsDirty();
			}),
			callbacks.onRemove(player, 'weapons', (_weapon, weaponId) => {
				weaponSubscriptions.delete(weaponId);
				this.markWeaponsDirty();
			}),
			callbacks.onChange(player.stats, 'tomeLevels', this.markTomesDirty),
			callbacks.onRemove(player.stats, 'tomeLevels', this.markTomesDirty),
		);
		this.markTomesDirty();
		this.markPlayerDirty();
	}

	private bindTeammate(
		callbacks: StateCallbacks,
		player: Player,
		subscriptions: CleanupBag,
	): void {
		subscriptions.add(
			callbacks.listen(player.life, 'current', this.markTeamDirty),
			callbacks.listen(player.life, 'max', this.markTeamDirty),
			callbacks.listen(player, 'isDowned', this.markTeamDirty),
		);
		this.markTeamDirty();
	}

	private bindBoss(
		callbacks: StateCallbacks,
		monster: Monster,
		monsterId: string,
	): void {
		this.bossSubscriptions.delete(this.activeBossId);
		this.activeBossId = monsterId;
		const subscriptions = this.bossSubscriptions.replace(monsterId);
		subscriptions.add(
			callbacks.listen(monster.life, 'current', this.markBossDirty),
			callbacks.listen(monster.life, 'max', this.markBossDirty),
		);
		this.markBossDirty();
	}

	private buildHud(): HudControls {
		const root = this.advTex.rootContainer;

		const killText = this.createCounterPanel(
			root,
			'KillCounter',
			gameI18n.t('hud.kills'),
			'0',
			KILL_PANEL_WIDTH,
			2,
		);
		const timerText = this.createCounterPanel(
			root,
			'GameTimer',
			gameI18n.t('hud.survivalTime'),
			'00:00',
			TIMER_PANEL_WIDTH,
			TIMER_PANEL_LEFT,
		);

		const teamPanel = new GUI.Rectangle('NetworkTeamPanel');
		teamPanel.width = '244px';
		teamPanel.height = '80px';
		teamPanel.left = '2px';
		teamPanel.top = '88px';
		teamPanel.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
		teamPanel.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
		teamPanel.scaleX = HUD_SCALE;
		teamPanel.scaleY = HUD_SCALE;
		teamPanel.zIndex = 20;
		teamPanel.isVisible = false;
		styleHudPanel(teamPanel, HUD_THEME.xp);
		root.addControl(teamPanel);

		const teamLabel = hudText(
			'NetworkTeamLabel',
			gameI18n.t('hud.onlineTeam').toUpperCase(),
			11,
			HUD_THEME.xp,
		);
		teamLabel.fontWeight = 'bold';
		teamLabel.width = '150px';
		teamLabel.height = '22px';
		teamLabel.left = '12px';
		teamLabel.top = '7px';
		teamLabel.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
		teamLabel.textHorizontalAlignment =
			GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
		teamLabel.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
		teamPanel.addControl(teamLabel);

		const teamCountText = hudText(
			'NetworkTeamCount',
			'1 / 4',
			11,
			HUD_THEME.muted,
		);
		teamCountText.fontWeight = 'bold';
		teamCountText.width = '60px';
		teamCountText.height = '22px';
		teamCountText.left = '-12px';
		teamCountText.top = '7px';
		teamCountText.horizontalAlignment =
			GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
		teamCountText.textHorizontalAlignment =
			GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
		teamCountText.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
		teamPanel.addControl(teamCountText);

		const teammateSlots = Array.from(
			{ length: COMBAT_LIMITS.maxPlayers - 1 },
			(_, index) => this.createTeammateSlot(teamPanel, index),
		);

		const bossPanel = new GUI.Rectangle('BossHealthPanel');
		bossPanel.width = '720px';
		bossPanel.height = '92px';
		bossPanel.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
		bossPanel.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
		bossPanel.top = '6.5px';
		bossPanel.scaleX = HUD_SCALE;
		bossPanel.scaleY = HUD_SCALE;
		bossPanel.zIndex = 20;
		bossPanel.isVisible = false;
		styleHudPanel(bossPanel, HUD_THEME.boss);
		root.addControl(bossPanel);
		const bossName = hudText(
			'BossNameText',
			gameI18n.t('hud.boss').toUpperCase(),
			21,
			HUD_THEME.boss,
		);
		bossName.fontWeight = 'bold';
		bossName.height = '34px';
		bossName.top = '6px';
		bossName.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
		bossPanel.addControl(bossName);
		const bossBar = createHudBar(
			'BossHealthBarBack',
			bossPanel,
			'664px',
			'34px',
			'45px',
			HUD_THEME.bossDark,
			HUD_THEME.boss,
		);
		bossBar.track.color = '#A86668CC';
		const bossHealthText = addHudBarText(
			bossBar.track,
			'BossHealth',
			gameI18n.t('hud.health').toUpperCase(),
			'0 / 0',
			'boss',
		);
		addHudBarHighlight(bossBar.fill);

		const vitalsPanel = new GUI.Rectangle('PlayerVitalsPanel');
		vitalsPanel.width = '560px';
		vitalsPanel.height = '102px';
		vitalsPanel.horizontalAlignment =
			GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
		vitalsPanel.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
		vitalsPanel.top = '-9.25px';
		vitalsPanel.scaleX = HUD_SCALE;
		vitalsPanel.scaleY = HUD_SCALE;
		vitalsPanel.zIndex = 20;
		styleHudPanel(vitalsPanel, HUD_THEME.xp);
		root.addControl(vitalsPanel);

		const levelBadge = new GUI.Rectangle('PlayerLevelBadge');
		levelBadge.width = '66px';
		levelBadge.height = '74px';
		levelBadge.left = '15px';
		levelBadge.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
		levelBadge.background = '#1D2B2BFF';
		levelBadge.color = HUD_THEME.gold;
		levelBadge.thickness = 2;
		levelBadge.cornerRadius = 9;
		levelBadge.isPointerBlocker = false;
		vitalsPanel.addControl(levelBadge);
		const levelLabel = hudText(
			'PlayerLevelLabel',
			gameI18n.t('hud.level').toUpperCase(),
			10,
			HUD_THEME.muted,
		);
		levelLabel.height = '20px';
		levelLabel.top = '8px';
		levelLabel.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
		levelBadge.addControl(levelLabel);
		const levelText = hudText(
			'PlayerLevelText',
			'1',
			30,
			HUD_THEME.goldBright,
		);
		levelText.fontWeight = 'bold';
		levelText.height = '40px';
		levelText.top = '27px';
		levelText.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
		levelBadge.addControl(levelText);

		const hpBar = createHudBar(
			'HealthBarBack',
			vitalsPanel,
			'458px',
			'38px',
			'14px',
			HUD_THEME.healthDark,
			HUD_THEME.health,
		);
		hpBar.track.left = '41px';
		const hpText = addHudBarText(
			hpBar.track,
			'Health',
			gameI18n.t('hud.health').toUpperCase(),
			'100 / 100',
			'health',
		);
		addHudBarHighlight(hpBar.fill);
		const xpBar = createHudBar(
			'XPBarBack',
			vitalsPanel,
			'458px',
			'18px',
			'67px',
			HUD_THEME.xpDark,
			HUD_THEME.xp,
		);
		xpBar.track.left = '41px';
		const xpText = addHudBarText(
			xpBar.track,
			'Experience',
			gameI18n.t('hud.experience').toUpperCase(),
			'0 / 100',
			'experience',
		);
		addHudBarHighlight(xpBar.fill);

		const arsenal = this.createItemSlotPanel(
			root,
			'PlayerArsenal',
			'PlayerWeaponSlot',
			gameI18n.t('hud.arsenal'),
			-BOTTOM_PANEL_OFFSET,
			COMBAT_LIMITS.maxWeaponsPerPlayer,
			WEAPON_SLOT_WIDTH,
		);
		const tomes = this.createItemSlotPanel(
			root,
			'PlayerTomes',
			'PlayerTomeSlot',
			gameI18n.t('hud.tomes'),
			BOTTOM_PANEL_OFFSET,
			TOME_SLOT_LIMIT,
			TOME_SLOT_WIDTH,
		);

		const downedPanel = new GUI.Rectangle('PlayerDownedPanel');
		downedPanel.width = '520px';
		downedPanel.height = '96px';
		downedPanel.horizontalAlignment =
			GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
		downedPanel.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
		downedPanel.top = '150px';
		downedPanel.scaleX = HUD_SCALE;
		downedPanel.scaleY = HUD_SCALE;
		downedPanel.zIndex = 25;
		downedPanel.isVisible = false;
		styleHudPanel(downedPanel, HUD_THEME.boss);
		root.addControl(downedPanel);
		const downedTitle = hudText(
			'PlayerDownedTitle',
			gameI18n.t('hud.downed').toUpperCase(),
			24,
			HUD_THEME.boss,
		);
		downedTitle.fontWeight = 'bold';
		downedTitle.height = '34px';
		downedTitle.top = '16px';
		downedTitle.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
		downedPanel.addControl(downedTitle);
		const downedHint = hudText('PlayerDownedHint', '', 14, HUD_THEME.muted);
		downedHint.height = '26px';
		downedHint.top = '52px';
		downedHint.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
		downedPanel.addControl(downedHint);

		return {
			hpBar: hpBar.fill,
			hpText,
			xpBar: xpBar.fill,
			xpText,
			levelText,
			killText,
			timerText,
			bossPanel,
			bossName,
			bossHealthFill: bossBar.fill,
			bossHealthText,
			weaponCountText: arsenal.countText,
			weaponSlots: arsenal.slots,
			tomeCountText: tomes.countText,
			tomeSlots: tomes.slots,
			teamPanel,
			teamCountText,
			teammateSlots,
			downedPanel,
			downedHint,
		};
	}

	private createCounterPanel(
		root: GUI.Container,
		name: string,
		label: string,
		value: string,
		width: number,
		left: number,
	): GUI.TextBlock {
		const panel = new GUI.Rectangle(`${name}Panel`);
		panel.width = `${width}px`;
		panel.height = `${COUNTER_PANEL_HEIGHT}px`;
		panel.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
		panel.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
		panel.left = `${left}px`;
		panel.top = `${COUNTER_PANEL_TOP}px`;
		panel.scaleX = HUD_SCALE;
		panel.scaleY = HUD_SCALE;
		styleHudPanel(panel, HUD_THEME.gold);
		root.addControl(panel);
		const labelText = hudText(
			`${name}Label`,
			label.toUpperCase(),
			13,
			HUD_THEME.muted,
		);
		labelText.fontWeight = '600';
		labelText.height = '22px';
		labelText.top = '7px';
		labelText.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
		panel.addControl(labelText);
		const valueText = hudText(
			`${name}Text`,
			value,
			28,
			HUD_THEME.goldBright,
		);
		valueText.fontWeight = 'bold';
		valueText.height = '35px';
		valueText.top = '27px';
		valueText.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
		panel.addControl(valueText);
		return valueText;
	}

	private createItemSlotPanel(
		root: GUI.Container,
		name: string,
		slotName: string,
		label: string,
		offset: number,
		capacity: number,
		slotWidth: number,
	): ItemSlotPanelControls {
		const panel = createBottomHudPanel(
			root,
			`${name}Panel`,
			offset,
			HUD_THEME.gold,
			HUD_SCALE,
		);

		const labelText = hudText(
			`${name}Label`,
			label.toUpperCase(),
			11,
			HUD_THEME.gold,
		);
		labelText.fontWeight = 'bold';
		labelText.width = '120px';
		labelText.height = '20px';
		labelText.left = '12px';
		labelText.top = '5px';
		labelText.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
		labelText.textHorizontalAlignment =
			GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
		labelText.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
		panel.addControl(labelText);

		const countText = hudText(
			`${name}Count`,
			`0 / ${capacity}`,
			11,
			HUD_THEME.muted,
		);
		countText.fontWeight = 'bold';
		countText.width = '70px';
		countText.height = '20px';
		countText.left = '-12px';
		countText.top = '5px';
		countText.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
		countText.textHorizontalAlignment =
			GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
		countText.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
		panel.addControl(countText);

		const row = new GUI.StackPanel(`${slotName}s`);
		row.isVertical = false;
		row.spacing = ITEM_SLOT_SPACING;
		row.width = `${ITEM_SLOT_ROW_WIDTH}px`;
		row.height = '67px';
		row.top = '27px';
		row.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
		panel.addControl(row);

		const slots = Array.from({ length: capacity }, (_, index) =>
			this.createItemSlot(row, `${slotName}${index}`, slotWidth),
		);
		return { countText, slots };
	}

	setReviveKeyLabel(label: string): void {
		if (this.reviveKeyLabel === label) return;
		this.reviveKeyLabel = label;
		this.controls.downedHint.text = gameI18n.t('hud.downedHint', {
			key: label,
		});
	}

	private createTeammateSlot(
		parent: GUI.Container,
		index: number,
	): TeammateSlotControls {
		const panel = new GUI.Container(`NetworkTeammate${index}`);
		panel.width = '220px';
		panel.height = '43px';
		panel.top = `${31 + index * TEAM_SLOT_HEIGHT}px`;
		panel.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
		panel.isVisible = false;
		parent.addControl(panel);

		const status = new GUI.Ellipse(`NetworkTeammate${index}Status`);
		status.width = '8px';
		status.height = '8px';
		status.left = '1px';
		status.top = '8px';
		status.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
		status.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
		status.background = HUD_THEME.xp;
		status.color = HUD_THEME.allyOnline;
		status.thickness = 1;
		status.isHitTestVisible = false;
		panel.addControl(status);

		const name = hudText(
			`NetworkTeammate${index}Name`,
			gameI18n.t('hud.ally', { number: index + 1 }).toUpperCase(),
			11,
			HUD_THEME.text,
		);
		name.fontWeight = 'bold';
		name.width = '130px';
		name.height = '21px';
		name.left = '16px';
		name.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
		name.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
		name.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
		panel.addControl(name);

		const healthText = hudText(
			`NetworkTeammate${index}HealthText`,
			'100 / 100',
			10,
			HUD_THEME.text,
		);
		healthText.fontWeight = 'bold';
		healthText.width = '90px';
		healthText.height = '21px';
		healthText.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
		healthText.textHorizontalAlignment =
			GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
		healthText.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
		panel.addControl(healthText);

		const healthBar = createHudBar(
			`NetworkTeammate${index}HealthBar`,
			panel,
			'220px',
			'14px',
			'23px',
			HUD_THEME.healthDark,
			HUD_THEME.health,
		);

		return {
			panel,
			status,
			name,
			healthFill: healthBar.fill,
			healthText,
		};
	}

	private createItemSlot(
		parent: GUI.StackPanel,
		name: string,
		width: number,
	): ItemSlotControls {
		const panel = new GUI.Rectangle(name);
		panel.width = `${width}px`;
		panel.height = '64px';
		panel.background = EMPTY_SLOT_BACKGROUND;
		panel.color = HUD_THEME.emptyBorder;
		panel.thickness = 1;
		panel.cornerRadius = 7;
		panel.isPointerBlocker = false;
		parent.addControl(panel);

		const icon = new GUI.Image(`${name}Icon`);
		icon.width = '36px';
		icon.height = '36px';
		icon.top = '2px';
		icon.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
		icon.stretch = GUI.Image.STRETCH_UNIFORM;
		icon.isHitTestVisible = false;
		icon.isVisible = false;
		panel.addControl(icon);

		const label = hudText(
			`${name}Name`,
			gameI18n.t('hud.empty').toUpperCase(),
			9,
			HUD_THEME.empty,
		);
		label.fontWeight = 'bold';
		label.height = '18px';
		label.top = '42px';
		label.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
		panel.addControl(label);

		const level = hudText(`${name}Level`, '1', 10, HUD_THEME.goldBright);
		level.fontWeight = 'bold';
		level.width = '24px';
		level.height = '18px';
		level.left = '-4px';
		level.top = '3px';
		level.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
		level.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
		level.isVisible = false;
		panel.addControl(level);

		return { panel, icon, name: label, level };
	}

	dispose(): void {
		this.subscriptions.dispose();
		this.playerSubscriptions.dispose();
		this.bossSubscriptions.dispose();
		this.advTex.dispose();
	}

	update(): void {
		const timerSecond = Number.isFinite(this.room.state.combatTimeS)
			? Math.max(0, Math.floor(this.room.state.combatTimeS))
			: 0;
		if (timerSecond !== this.lastTimerSecond) {
			this.lastTimerSecond = timerSecond;
			this.controls.timerText.text = formatGameTime(timerSecond);
		}
		if (this.bossDirty) this.updateBossHealth();
		if (this.killsDirty) this.updateKillHud();
		const player = this.room.state.players.get(this.room.sessionId);
		if (!player) return;
		if (this.teamDirty) this.updateTeamHud();
		if (this.weaponsDirty) this.updateWeaponHud(player);
		if (this.tomesDirty) this.updateTomeHud(player);
		if (this.playerDirty) this.updatePlayerHud(player);
	}

	private updatePlayerHud(player: Player): void {
		this.playerDirty = false;
		this.controls.downedPanel.isVisible = player.isDowned;
		const { hpBar, hpText, xpBar, xpText, levelText, killText } =
			this.controls;
		const { current, max } = player.life;
		hpBar.width = hudBarWidth(current, max);
		hpText.text = `${Math.round(current)} / ${Math.round(max)}`;
		const { xp, xpToNextLevel, level } = player.experience;
		xpBar.width = hudBarWidth(xp, xpToNextLevel);
		xpText.text = `${Math.floor(xp)} / ${Math.floor(xpToNextLevel)}`;
		levelText.text = String(level);
		killText.text = String(this.room.state.totalKills);
	}

	private updateTeamHud(): void {
		this.teamDirty = false;
		const { teamPanel, teamCountText, teammateSlots } = this.controls;
		const teammateIds = this.teammateIds;
		teammateIds.length = 0;
		this.room.state.players.forEach((_candidate, id) => {
			if (id !== this.room.sessionId) teammateIds.push(id);
		});
		teammateIds.sort(compareIds);
		teamPanel.isVisible = teammateIds.length > 0;
		teamPanel.height = `${TEAM_HEADER_HEIGHT + teammateIds.length * TEAM_SLOT_HEIGHT}px`;
		teamCountText.text = `${teammateIds.length + 1} / ${COMBAT_LIMITS.maxPlayers}`;
		for (let index = 0; index < teammateSlots.length; index++) {
			const slot = teammateSlots[index]!;
			const teammate = this.room.state.players.get(teammateIds[index]);
			slot.panel.isVisible = Boolean(teammate);
			if (!teammate) continue;
			const { current, max } = teammate.life;
			const living = !teammate.isDowned;
			slot.status.background = living ? HUD_THEME.xp : HUD_THEME.boss;
			slot.status.color = living
				? HUD_THEME.allyOnline
				: HUD_THEME.allyDown;
			slot.name.text = `${teammate.username}  ${living ? '' : ` · ${gameI18n.t('hud.knockedOut').toUpperCase()}`}`;
			slot.name.color = living ? HUD_THEME.text : HUD_THEME.boss;
			slot.healthText.text = `${Math.round(current)} / ${Math.round(max)}`;
			slot.healthFill.width = hudBarWidth(current, max);
		}
	}

	private updateWeaponHud(player: Player): void {
		this.weaponsDirty = false;
		const { weaponCountText, weaponSlots } = this.controls;
		let slotIndex = 0;
		for (const kind of WEAPON_KINDS) {
			const weapon = player.weapons.get(kind);
			if (!weapon) continue;
			this.updateWeaponSlot(
				weaponSlots[slotIndex++]!,
				kind,
				weapon.level,
			);
		}
		for (; slotIndex < weaponSlots.length; slotIndex++)
			this.updateWeaponSlot(weaponSlots[slotIndex]!);
		weaponCountText.text = `${player.weapons.size} / ${COMBAT_LIMITS.maxWeaponsPerPlayer}`;
	}

	private updateWeaponSlot(
		slot: ItemSlotControls,
		kind?: WeaponKind,
		level = 0,
	): void {
		if (!kind) {
			this.clearItemSlot(slot);
			return;
		}
		this.fillItemSlot(
			slot,
			iconsImport[WEAPON_ICONS[kind]],
			gameI18n.t(`weapon.${kind}`).toUpperCase(),
			HUD_THEME.text,
		);
		slot.level.text = String(level);
		slot.level.isVisible = true;
	}

	private updateTomeHud(player: Player): void {
		this.tomesDirty = false;
		const { tomeCountText, tomeSlots } = this.controls;
		const { tomeLevels } = player.stats;
		if (!tomeLevels) return;
		let slotIndex = 0;
		tomeLevels.forEach((level, tomeId) => {
			const slot = tomeSlots[slotIndex++];
			if (slot) this.updateTomeSlot(slot, tomeId as TomeId, level);
		});
		for (; slotIndex < tomeSlots.length; slotIndex++)
			this.updateTomeSlot(tomeSlots[slotIndex]!);
		tomeCountText.text = `${tomeLevels.size} / ${TOME_SLOT_LIMIT}`;
	}

	private updateTomeSlot(
		slot: ItemSlotControls,
		tomeId?: TomeId,
		level = 0,
	): void {
		const icon = tomeId && TOME_ICONS.get(tomeId);
		if (!icon) {
			this.clearItemSlot(slot);
			return;
		}
		this.fillItemSlot(
			slot,
			iconsImport[icon],
			gameI18n.t('hud.tomeLevel', { level }).toUpperCase(),
			HUD_THEME.goldBright,
		);
		slot.level.isVisible = false;
	}

	private clearItemSlot(slot: ItemSlotControls): void {
		slot.panel.color = HUD_THEME.emptyBorder;
		slot.panel.background = EMPTY_SLOT_BACKGROUND;
		slot.icon.isVisible = false;
		slot.name.text = gameI18n.t('hud.empty').toUpperCase();
		slot.name.color = HUD_THEME.empty;
		slot.level.isVisible = false;
	}

	private fillItemSlot(
		slot: ItemSlotControls,
		iconSource: string,
		label: string,
		labelColor: string,
	): void {
		slot.panel.color = HUD_THEME.gold;
		slot.panel.background = FILLED_SLOT_BACKGROUND;
		slot.icon.source = iconSource;
		slot.icon.isVisible = true;
		slot.name.text = label;
		slot.name.color = labelColor;
	}

	private updateBossHealth(): void {
		this.bossDirty = false;
		const {
			bossPanel: panel,
			bossName: name,
			bossHealthFill: fill,
			bossHealthText: text,
		} = this.controls;
		const boss = this.room.state.monsters.get(this.activeBossId);
		if (!boss || !isLivingBoss(boss)) {
			panel.isVisible = false;
			return;
		}

		panel.isVisible = true;
		name.text = `${gameI18n.t('hud.boss').toUpperCase()} · ${getMonsterDisplayName(boss.kind)}`;
		const current = boss.life.current;
		const max = boss.life.max;
		fill.width = hudBarWidth(current, max);
		text.text = `${Math.round(Math.max(0, current))} / ${Math.round(Math.max(0, max))}`;
	}
}
