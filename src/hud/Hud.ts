import * as GUI from '@babylonjs/gui';
import type { Scene } from '@babylonjs/core';
import * as COLYSEUS from '@colyseus/sdk';
import {
	COMBAT_LIMITS,
	WEAPON_ICONS,
	WEAPON_KINDS,
	type GameState,
	type Monster,
	type Player,
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
import { gameI18n, type TranslationKey } from '../i18n';

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
	weaponSlots: WeaponSlotControls[];
	teamPanel: GUI.Rectangle;
	teamCountText: GUI.TextBlock;
	teammateSlots: TeammateSlotControls[];
	downedPanel: GUI.Rectangle;
	downedHint: GUI.TextBlock;
}

type StateCallbacks = ReturnType<typeof COLYSEUS.Callbacks.get<GameState>>;

interface WeaponSlotControls {
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

const HUD_SCALE = 0.75;
const BOTTOM_PANEL_OFFSET = 316;
const TEAM_HEADER_HEIGHT = 36;
const TEAM_SLOT_HEIGHT = 44;
const compareIds = (first: string, second: string): number =>
	first.localeCompare(second);
const WEAPON_NAME_KEYS: Readonly<Record<WeaponKind, TranslationKey>> = {
	aura: 'weapon.aura',
	sword: 'weapon.sword',
	axe: 'weapon.axe',
	staff: 'weapon.staff',
	bow: 'weapon.bow',
};

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
	private bossDirty = true;
	private playerDirty = true;
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
	private readonly markBossDirty = (): void => {
		this.bossDirty = true;
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
			callbacks.listen(player.stats, 'killAmount', this.markPlayerDirty),
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
		);
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

		const killPanel = new GUI.Rectangle('KillCounterPanel');
		killPanel.width = '176px';
		killPanel.height = '68px';
		killPanel.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
		killPanel.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
		killPanel.left = '2px';
		killPanel.top = '15.5px';
		killPanel.scaleX = HUD_SCALE;
		killPanel.scaleY = HUD_SCALE;
		styleHudPanel(killPanel, HUD_THEME.gold);
		root.addControl(killPanel);
		const killLabel = hudText(
			'KillCounterLabel',
			gameI18n.t('hud.kills').toUpperCase(),
			13,
			HUD_THEME.muted,
		);
		killLabel.fontWeight = '600';
		killLabel.height = '22px';
		killLabel.top = '7px';
		killLabel.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
		killPanel.addControl(killLabel);
		const killText = hudText(
			'KillCounterText',
			'0',
			28,
			HUD_THEME.goldBright,
		);
		killText.fontWeight = 'bold';
		killText.height = '35px';
		killText.top = '27px';
		killText.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
		killPanel.addControl(killText);

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

		const timerPanel = createBottomHudPanel(
			root,
			'GameTimerPanel',
			BOTTOM_PANEL_OFFSET,
			HUD_THEME.gold,
			HUD_SCALE,
		);
		const timerLabel = hudText(
			'GameTimerLabel',
			gameI18n.t('hud.survivalTime').toUpperCase(),
			11,
			HUD_THEME.gold,
		);
		timerLabel.fontWeight = 'bold';
		timerLabel.height = '22px';
		timerLabel.top = '10px';
		timerLabel.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
		timerPanel.addControl(timerLabel);
		const timerText = hudText(
			'GameTimerText',
			'00:00',
			28,
			HUD_THEME.goldBright,
		);
		timerText.fontWeight = 'bold';
		timerText.height = '48px';
		timerText.top = '36px';
		timerText.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
		timerPanel.addControl(timerText);

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

		const arsenalPanel = createBottomHudPanel(
			root,
			'PlayerArsenalPanel',
			-BOTTOM_PANEL_OFFSET,
			HUD_THEME.gold,
			HUD_SCALE,
		);

		const arsenalLabel = hudText(
			'PlayerArsenalLabel',
			gameI18n.t('hud.arsenal').toUpperCase(),
			11,
			HUD_THEME.gold,
		);
		arsenalLabel.fontWeight = 'bold';
		arsenalLabel.width = '120px';
		arsenalLabel.height = '20px';
		arsenalLabel.left = '12px';
		arsenalLabel.top = '5px';
		arsenalLabel.horizontalAlignment =
			GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
		arsenalLabel.textHorizontalAlignment =
			GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
		arsenalLabel.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
		arsenalPanel.addControl(arsenalLabel);

		const weaponCountText = hudText(
			'PlayerArsenalCount',
			`0 / ${COMBAT_LIMITS.maxWeaponsPerPlayer}`,
			11,
			HUD_THEME.muted,
		);
		weaponCountText.fontWeight = 'bold';
		weaponCountText.width = '70px';
		weaponCountText.height = '20px';
		weaponCountText.left = '-12px';
		weaponCountText.top = '5px';
		weaponCountText.horizontalAlignment =
			GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
		weaponCountText.textHorizontalAlignment =
			GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
		weaponCountText.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
		arsenalPanel.addControl(weaponCountText);

		const weaponRow = new GUI.StackPanel('PlayerWeaponSlots');
		weaponRow.isVertical = false;
		weaponRow.spacing = 7;
		weaponRow.width = '226px';
		weaponRow.height = '67px';
		weaponRow.top = '27px';
		weaponRow.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
		arsenalPanel.addControl(weaponRow);

		const weaponSlots = Array.from(
			{ length: COMBAT_LIMITS.maxWeaponsPerPlayer },
			(_, index) => this.createWeaponSlot(weaponRow, index),
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
		const downedHint = hudText(
			'PlayerDownedHint',
			'',
			14,
			HUD_THEME.muted,
		);
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
			weaponCountText,
			weaponSlots,
			teamPanel,
			teamCountText,
			teammateSlots,
			downedPanel,
			downedHint,
		};
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

	private createWeaponSlot(
		parent: GUI.StackPanel,
		index: number,
	): WeaponSlotControls {
		const panel = new GUI.Rectangle(`PlayerWeaponSlot${index}`);
		panel.width = '70px';
		panel.height = '64px';
		panel.background = '#0B1417D9';
		panel.color = HUD_THEME.emptyBorder;
		panel.thickness = 1;
		panel.cornerRadius = 7;
		panel.isPointerBlocker = false;
		parent.addControl(panel);

		const icon = new GUI.Image(`PlayerWeaponSlot${index}Icon`);
		icon.width = '36px';
		icon.height = '36px';
		icon.top = '2px';
		icon.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
		icon.stretch = GUI.Image.STRETCH_UNIFORM;
		icon.isHitTestVisible = false;
		icon.isVisible = false;
		panel.addControl(icon);

		const name = hudText(
			`PlayerWeaponSlot${index}Name`,
			gameI18n.t('hud.empty').toUpperCase(),
			9,
			HUD_THEME.empty,
		);
		name.fontWeight = 'bold';
		name.height = '18px';
		name.top = '42px';
		name.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
		panel.addControl(name);

		const level = hudText(
			`PlayerWeaponSlot${index}Level`,
			'1',
			10,
			HUD_THEME.goldBright,
		);
		level.fontWeight = 'bold';
		level.width = '24px';
		level.height = '18px';
		level.left = '-4px';
		level.top = '3px';
		level.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
		level.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
		level.isVisible = false;
		panel.addControl(level);

		return { panel, icon, name, level };
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
		const player = this.room.state.players.get(this.room.sessionId);
		if (!player) return;
		if (this.teamDirty) this.updateTeamHud();
		if (this.weaponsDirty) this.updateWeaponHud(player);
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
		killText.text = String(player.stats.killAmount);
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
			slot.name.text = `${gameI18n
				.t('hud.ally', { number: index + 1 })
				.toUpperCase()}${living ? '' : ` · ${gameI18n.t('hud.knockedOut').toUpperCase()}`}`;
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
		slot: WeaponSlotControls,
		kind?: WeaponKind,
		level = 0,
	): void {
		if (!kind) {
			slot.panel.color = HUD_THEME.emptyBorder;
			slot.panel.background = '#0B1417D9';
			slot.icon.isVisible = false;
			slot.name.text = gameI18n.t('hud.empty').toUpperCase();
			slot.name.color = HUD_THEME.empty;
			slot.level.isVisible = false;
			return;
		}
		slot.panel.color = HUD_THEME.gold;
		slot.panel.background = '#172326F2';
		slot.icon.source = iconsImport[WEAPON_ICONS[kind]];
		slot.icon.isVisible = true;
		slot.name.text = gameI18n.t(WEAPON_NAME_KEYS[kind]).toUpperCase();
		slot.name.color = HUD_THEME.text;
		slot.level.text = String(level);
		slot.level.isVisible = true;
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
		fill.width = hudBarWidth(current, max, 96);
		text.text = `${Math.round(Math.max(0, current))} / ${Math.round(Math.max(0, max))}`;
	}
}
