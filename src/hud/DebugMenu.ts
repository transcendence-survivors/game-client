import * as GUI from '@babylonjs/gui';
import * as BABYLON from '@babylonjs/core';
import { MONSTER_DIRECTOR_CONFIG } from '@transcendence/game-shared';
import { createFullscreenUi } from '../assets/ui';
import { HUD_THEME, hudText, styleHudPanel } from '../hud/HudTheme';
import type { MonsterRendererStats } from '../monsters/MonsterRenderer';
import { FrameTimeHistory } from '../performance/FrameTimeHistory';
import { gameI18n } from '../i18n';

const FRAME_TIME_WINDOW_MS = 60_000;
const GPU_NANOSECONDS_TO_MILLISECONDS = 1_000_000;
const DEBUG_PANEL_SCALE = 0.75;

interface DebugStats {
	position: GUI.TextBlock;
	rotation: GUI.TextBlock;
	fps: GUI.TextBlock;
	frameTime: GUI.TextBlock;
	cpuFrameTime: GUI.TextBlock;
	cpuFrameAverage: GUI.TextBlock;
	gpuFrameTime: GUI.TextBlock;
	gpuFrameAverage: GUI.TextBlock;
	drawCalls: GUI.TextBlock;
	resources: GUI.TextBlock;
	animations: GUI.TextBlock;
	skinning: GUI.TextBlock;
	animationTime: GUI.TextBlock;
	monsters: GUI.TextBlock;
}

const EMPTY_MONSTER_STATS: Readonly<MonsterRendererStats> = {
	total: 0,
	elites: 0,
	bosses: 0,
	rendered: 0,
};

export class DebugMenu {
	private static readonly UPDATE_INTERVAL_MS = 100;
	private debugStats!: DebugStats;
	private readonly engine: BABYLON.Engine;
	private lastUpdateMs = 0;
	private readonly enabled: boolean;
	private panel: GUI.Rectangle | null = null;
	private panelVisible = false;
	private hitboxesVisible = false;
	private ui: GUI.AdvancedDynamicTexture | null = null;
	private readonly instrumentation: BABYLON.SceneInstrumentation | null;
	private readonly engineInstrumentation: BABYLON.EngineInstrumentation | null;
	private readonly cpuFrameHistory = new FrameTimeHistory(
		FRAME_TIME_WINDOW_MS,
	);
	private readonly gpuFrameHistory = new FrameTimeHistory(
		FRAME_TIME_WINDOW_MS,
	);
	private readonly frameStartObserver: BABYLON.Observer<BABYLON.AbstractEngine> | null;
	private readonly frameEndObserver: BABYLON.Observer<BABYLON.AbstractEngine> | null;
	private readonly gpuTimingSupported: boolean;
	private frameStartMs: number | null = null;
	private currentCpuFrameMs: number | null = null;
	private currentGpuFrameMs: number | null = null;
	private lastDrawCalls = 0;
	private lastGpuCounterCount = 0;
	private readonly onHitboxesChanged: (visible: boolean) => void;
	private readonly onImmortalChanged: (enabled: boolean) => void;
	private readonly onMonsterStressChanged: (enabled: boolean) => void;
	private readonly getMonsterStats: () => Readonly<MonsterRendererStats>;
	private readonly keyDownHandler = (event: KeyboardEvent) => {
		if (event.code !== 'F3' || event.repeat || !this.enabled) return;
		event.preventDefault();
		event.stopPropagation();
		this.setPanelVisible(!this.panelVisible);
	};

	constructor(
		engine: BABYLON.Engine,
		scene: BABYLON.Scene,
		onHitboxesChanged: (visible: boolean) => void = () => {},
		onImmortalChanged: (enabled: boolean) => void = () => {},
		enabled = true,
		onMonsterStressChanged: (enabled: boolean) => void = () => {},
		getMonsterStats: () => Readonly<MonsterRendererStats> = () =>
			EMPTY_MONSTER_STATS,
	) {
		this.engine = engine;
		this.enabled = enabled;
		this.gpuTimingSupported =
			enabled && Boolean(engine.getCaps().timerQuery);
		this.instrumentation = enabled
			? new BABYLON.SceneInstrumentation(scene)
			: null;
		if (this.instrumentation) {
			this.instrumentation.captureAnimationsTime = true;
		}
		this.engineInstrumentation = enabled
			? new BABYLON.EngineInstrumentation(engine)
			: null;
		if (this.engineInstrumentation && this.gpuTimingSupported) {
			this.engineInstrumentation.captureGPUFrameTime = true;
		}
		this.frameStartObserver = enabled
			? engine.onBeginFrameObservable.add(() => {
					if (this.panelVisible)
						this.frameStartMs = performance.now();
				})
			: null;
		this.frameEndObserver = enabled
			? engine.onEndFrameObservable.add(() => this.recordFrameTimes())
			: null;
		this.onHitboxesChanged = onHitboxesChanged;
		this.onImmortalChanged = onImmortalChanged;
		this.onMonsterStressChanged = onMonsterStressChanged;
		this.getMonsterStats = getMonsterStats;
		if (enabled) {
			this.initGUI(scene);
			window.addEventListener('keydown', this.keyDownHandler);
		}
	}

	private initGUI(scene: BABYLON.Scene): void {
		this.ui = createFullscreenUi('DebugUi', scene);
		this.ui.useInvalidateRectOptimization = true;
		const debugMenu = new GUI.Rectangle('debugMenu');
		this.panel = debugMenu;

		debugMenu.width = '430px';
		debugMenu.height = '640px';
		debugMenu.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
		debugMenu.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
		debugMenu.left = '36px';
		debugMenu.top = '-62px';
		debugMenu.scaleX = DEBUG_PANEL_SCALE;
		debugMenu.scaleY = DEBUG_PANEL_SCALE;
		debugMenu.zIndex = 50;
		styleHudPanel(debugMenu, HUD_THEME.xp);
		this.ui.addControl(debugMenu);
		debugMenu.isVisible = this.panelVisible;

		const panel = new GUI.StackPanel('DebugContent');
		panel.paddingTop = '16px';
		panel.paddingRight = '18px';
		panel.paddingLeft = '18px';
		panel.spacing = 0;
		debugMenu.addControl(panel);

		const header = new GUI.StackPanel('DebugHeader');
		header.isVertical = false;
		header.width = '370px';
		header.height = '44px';
		panel.addControl(header);
		const title = hudText(
			'DebugTitle',
			gameI18n.t('debug.title'),
			20,
			HUD_THEME.text,
		);
		title.fontWeight = 'bold';
		title.width = '246px';
		title.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
		header.addControl(title);
		const shortcut = new GUI.Rectangle('DebugShortcut');
		shortcut.width = '108px';
		shortcut.height = '30px';
		shortcut.background = HUD_THEME.xpDark;
		shortcut.color = HUD_THEME.xp;
		shortcut.thickness = 1;
		shortcut.cornerRadius = 6;
		shortcut.isPointerBlocker = false;
		header.addControl(shortcut);
		const shortcutText = hudText(
			'DebugShortcutText',
			`F3  ${gameI18n.t('debug.hide').toUpperCase()}`,
			11,
			HUD_THEME.xp,
		);
		shortcutText.fontWeight = 'bold';
		shortcut.addControl(shortcutText);

		const addSection = (text: string) => {
			const section = hudText(
				`DebugSection${text}`,
				text,
				11,
				HUD_THEME.gold,
			);
			section.fontWeight = 'bold';
			section.height = '28px';
			section.textHorizontalAlignment =
				GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
			panel.addControl(section);
		};
		addSection(gameI18n.t('debug.realTime').toUpperCase());

		const addStatLine = (label: string) => {
			const row = new GUI.StackPanel(`DebugStat${label}`);
			row.isVertical = false;
			row.height = '25px';

			const labelBlock = hudText(
				`DebugStat${label}Label`,
				label,
				13,
				HUD_THEME.muted,
			);
			labelBlock.width = '122px';
			labelBlock.textHorizontalAlignment =
				GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
			row.addControl(labelBlock);

			const valueBlock = hudText(
				`DebugStat${label}Value`,
				'-',
				14,
				HUD_THEME.text,
			);
			valueBlock.width = '254px';
			valueBlock.textHorizontalAlignment =
				GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
			row.addControl(valueBlock);

			panel.addControl(row);
			return valueBlock;
		};
		this.debugStats = {
			position: addStatLine(gameI18n.t('debug.position')),
			rotation: addStatLine(gameI18n.t('debug.rotation')),
			fps: addStatLine(gameI18n.t('debug.fps')),
			frameTime: addStatLine(gameI18n.t('debug.frame')),
			cpuFrameTime: addStatLine(gameI18n.t('debug.cpuFrame')),
			cpuFrameAverage: addStatLine(gameI18n.t('debug.cpuAverage')),
			gpuFrameTime: addStatLine(gameI18n.t('debug.gpuFrame')),
			gpuFrameAverage: addStatLine(gameI18n.t('debug.gpuAverage')),
			drawCalls: addStatLine(gameI18n.t('debug.drawCalls')),
			resources: addStatLine(gameI18n.t('debug.resources')),
			animations: addStatLine(gameI18n.t('debug.animations')),
			skinning: addStatLine(gameI18n.t('debug.skinning')),
			animationTime: addStatLine(gameI18n.t('debug.animationCpu')),
			monsters: addStatLine(gameI18n.t('debug.monsters')),
		};
		addSection(gameI18n.t('debug.testTools').toUpperCase());

		const addToggle = (
			name: string,
			labelText: string,
			labelColor: string,
			toggleColor: string,
			checked: boolean,
			onChanged: (checked: boolean) => void,
		) => {
			const row = new GUI.StackPanel(`${name}Row`);
			row.isVertical = false;
			row.height = '40px';
			const label = hudText(`${name}Label`, labelText, 14, labelColor);
			label.width = '330px';
			label.textHorizontalAlignment =
				GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
			row.addControl(label);
			const toggle = new GUI.Checkbox(name);
			toggle.width = '24px';
			toggle.height = '24px';
			toggle.color = toggleColor;
			toggle.background = HUD_THEME.panelHover;
			toggle.isChecked = checked;
			toggle.onIsCheckedChangedObservable.add(onChanged);
			row.addControl(toggle);
			panel.addControl(row);
		};
		addToggle(
			'hitboxToggle',
			gameI18n.t('debug.hitboxes'),
			'#ff8b72',
			'#ff5c5c',
			this.hitboxesVisible,
			(visible) => {
				this.hitboxesVisible = visible;
				this.onHitboxesChanged(visible);
			},
		);
		addToggle(
			'immortalToggle',
			gameI18n.t('debug.immortalMode'),
			'#ffd166',
			'#ffd166',
			false,
			this.onImmortalChanged,
		);
		addToggle(
			'monsterStressToggle',
			gameI18n.t('debug.stressMonsters', {
				count: MONSTER_DIRECTOR_CONFIG.stressTestPopulation,
			}),
			'#ff7bff',
			'#ff7bff',
			false,
			this.onMonsterStressChanged,
		);
	}

	areHitboxesVisible(): boolean {
		return this.hitboxesVisible;
	}

	private setPanelVisible(visible: boolean): void {
		this.panelVisible = visible;
		if (this.panel) this.panel.isVisible = visible;
		if (this.instrumentation)
			this.instrumentation.captureAnimationsTime = visible;
		if (this.engineInstrumentation && this.gpuTimingSupported)
			this.engineInstrumentation.captureGPUFrameTime = visible;
		if (visible) this.lastUpdateMs = 0;
		else this.frameStartMs = null;
	}

	dispose(): void {
		window.removeEventListener('keydown', this.keyDownHandler);
		this.engine.onBeginFrameObservable.remove(this.frameStartObserver);
		this.engine.onEndFrameObservable.remove(this.frameEndObserver);
		if (this.engineInstrumentation) {
			this.engineInstrumentation.captureGPUFrameTime = false;
			this.engineInstrumentation.dispose();
		}
		this.instrumentation?.dispose();
		this.ui?.dispose();
	}

	updateDebugMenu(player: BABYLON.AbstractMesh): void {
		if (!this.enabled || !this.panelVisible || !this.instrumentation)
			return;
		const now = performance.now();
		if (now - this.lastUpdateMs < DebugMenu.UPDATE_INTERVAL_MS) return;
		this.lastUpdateMs = now;

		const pos = player.position;
		this.debugStats.position.text = `X:${pos.x.toFixed(2)}, Y:${pos.y.toFixed(2)}, Z:${pos.z.toFixed(2)}`;

		const rot = BABYLON.NormalizeRadians(player.rotation.y);
		this.debugStats.rotation.text = `${BABYLON.Tools.ToDegrees(rot).toFixed(1)}°`;

		const fps = this.engine.getFps();
		this.debugStats.fps.text = fps.toFixed(0);
		this.debugStats.frameTime.text = `${(1000 / Math.max(1, fps)).toFixed(1)} ms`;
		const cpuAverageMs = this.cpuFrameHistory.average(now);
		const gpuAverageMs = this.gpuFrameHistory.average(now);
		this.debugStats.cpuFrameTime.text = this.formatMilliseconds(
			this.currentCpuFrameMs,
		);
		this.debugStats.cpuFrameAverage.text =
			this.formatMilliseconds(cpuAverageMs);
		this.debugStats.gpuFrameTime.text = this.formatMilliseconds(
			this.currentGpuFrameMs,
		);
		this.debugStats.gpuFrameAverage.text =
			this.formatMilliseconds(gpuAverageMs);
		const scene = player.getScene();
		const monsterStats = this.getMonsterStats();
		this.debugStats.monsters.text = gameI18n.t('debug.monsterSummary', {
			total: monsterStats.total,
			elites: monsterStats.elites,
			bosses: monsterStats.bosses,
			rendered: monsterStats.rendered,
		});
		this.debugStats.drawCalls.text = String(this.lastDrawCalls);
		this.debugStats.resources.text = gameI18n.t('debug.resourceSummary', {
			meshes: scene.meshes.length,
			materials: scene.materials.length,
		});
		this.debugStats.animations.text = gameI18n.t('debug.animationSummary', {
			animatables: scene.animatables.length,
			bones: scene.getActiveBones(),
		});
		let gpuMeshes = 0;
		let cpuMeshes = 0;
		for (const mesh of scene.meshes) {
			if (!mesh.useBones || !mesh.skeleton) continue;
			if (mesh.computeBonesUsingShaders) gpuMeshes++;
			else cpuMeshes++;
		}
		this.debugStats.skinning.text = gameI18n.t('debug.skinningSummary', {
			gpu: gpuMeshes,
			cpu: cpuMeshes,
		});
		this.debugStats.animationTime.text = `${this.instrumentation.animationsTimeCounter.current.toFixed(2)} ms`;
	}

	private recordFrameTimes(): void {
		if (!this.panelVisible) return;
		const now = performance.now();
		if (this.instrumentation)
			this.lastDrawCalls = this.instrumentation.drawCallsCounter.current;

		if (this.frameStartMs !== null) {
			this.currentCpuFrameMs = Math.max(0, now - this.frameStartMs);
			this.cpuFrameHistory.add(this.currentCpuFrameMs, now);
		}

		if (!this.engineInstrumentation || !this.gpuTimingSupported) return;
		const gpuCounter = this.engineInstrumentation.gpuFrameTimeCounter;
		if (gpuCounter.count <= this.lastGpuCounterCount) return;

		this.lastGpuCounterCount = gpuCounter.count;
		const gpuFrameMs = gpuCounter.current / GPU_NANOSECONDS_TO_MILLISECONDS;
		if (!Number.isFinite(gpuFrameMs) || gpuFrameMs < 0) return;

		this.currentGpuFrameMs = gpuFrameMs;
		this.gpuFrameHistory.add(gpuFrameMs, now);
	}

	private formatMilliseconds(valueMs: number | null): string {
		return valueMs === null
			? gameI18n.t('debug.notAvailable')
			: `${valueMs.toFixed(2)} ms`;
	}
}
