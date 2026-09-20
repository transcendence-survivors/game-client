import * as BABYLON from '@babylonjs/core';

const WALK_FRAME_RATE = 30;
const WALK_CYCLE_FRAMES = 30;
const WALK_SWAY = 0.035;

export const PLAYER_CLIP_CANDIDATES = {
	walk: ['Walk_Loop', 'Walk_Carry_Loop', 'Walk_Formal_Loop'],
	idle: ['Idle_No_Loop', 'Idle_Rail_Loop'],
	knockdown: ['Hit_Knockback'],
	getUp: ['LayToIdle'],
} as const;

/** Controls the idle and walk clips for one instantiated player model. */
export interface PlayerAnimationController {
	/** Starts the walk clip and keeps it looping. */
	playWalk(): void;
	/** Starts the idle clip, if the model provides one. */
	playIdle(): void;
	playDowned(): void;
	playRevive(): void;
	/** Releases all animation groups owned by the model instance. */
	dispose(): void;
}

export function clipNameMatches(groupName: string, clipName: string): boolean {
	return (
		groupName.slice(groupName.lastIndexOf(':') + 1).toLowerCase() ===
		clipName.toLowerCase()
	);
}

export function findPlayerClip<TGroup extends { name: string }>(
	animationGroups: readonly TGroup[],
	candidates: readonly string[],
): TGroup | undefined {
	for (const candidate of candidates) {
		const group = animationGroups.find((entry) =>
			clipNameMatches(entry.name, candidate),
		);
		if (group) return group;
	}
	return undefined;
}

function createProceduralWalkAnimation(
	root: BABYLON.AbstractMesh,
): BABYLON.AnimationGroup {
	const group = new BABYLON.AnimationGroup(
		`${root.name}:proceduralWalk`,
		root.getScene(),
	);
	const sway = new BABYLON.Animation(
		`${root.name}:walkSway`,
		'rotation.z',
		WALK_FRAME_RATE,
		BABYLON.Animation.ANIMATIONTYPE_FLOAT,
		BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE,
	);
	sway.setKeys([
		{ frame: 0, value: -WALK_SWAY },
		{ frame: WALK_CYCLE_FRAMES / 2, value: WALK_SWAY },
		{ frame: WALK_CYCLE_FRAMES, value: -WALK_SWAY },
	]);
	group.addTargetedAnimation(sway, root);
	return group;
}

interface PlayerClips {
	walk: BABYLON.AnimationGroup;
	idle: BABYLON.AnimationGroup | undefined;
	knockdown: BABYLON.AnimationGroup | undefined;
	getUp: BABYLON.AnimationGroup | undefined;
}

type AnimationMode = 'none' | 'walk' | 'idle' | 'downed' | 'revive';

class PlayerAnimationControllerImpl implements PlayerAnimationController {
	private current: BABYLON.AnimationGroup | null = null;
	private pendingEnd: (() => void) | null = null;
	private mode: AnimationMode = 'none';
	private readonly clips: PlayerClips;
	private readonly groups: ReadonlySet<BABYLON.AnimationGroup>;

	constructor(
		clips: PlayerClips,
		animationGroups: readonly BABYLON.AnimationGroup[],
	) {
		this.clips = clips;
		this.groups = new Set([...animationGroups, clips.walk]);
	}

	playWalk(): void {
		if (this.isLocked()) return;
		const walk = this.clips.walk;
		if (this.mode === 'walk' && walk.isPlaying) return;
		this.stopCurrent();
		walk.play(true);
		this.current = walk;
		this.mode = 'walk';
	}

	playIdle(): void {
		if (this.isLocked()) return;
		const idle = this.clips.idle;
		if (!idle) {
			if (this.mode !== 'idle') this.stopCurrent();
			this.mode = 'idle';
			return;
		}
		if (this.mode === 'idle') return;
		this.stopCurrent();
		idle.play(false);
		this.current = idle;
		this.mode = 'idle';
	}

	playDowned(): void {
		if (this.mode === 'downed') return;
		this.stopCurrent();
		this.mode = 'downed';
		const knockdown = this.clips.knockdown;
		if (!knockdown) {
			this.holdFallenPose();
			return;
		}
		knockdown.play(false);
		this.current = knockdown;
		this.onceEnded(knockdown, () => this.holdFallenPose());
	}

	playRevive(): void {
		if (this.mode === 'revive') return;
		const getUp = this.clips.getUp;
		if (!getUp) {
			this.mode = 'none';
			this.playIdle();
			return;
		}
		this.stopCurrent();
		this.mode = 'revive';
		getUp.play(false);
		this.current = getUp;
		this.onceEnded(getUp, () => {
			this.mode = 'none';
			this.playIdle();
		});
	}

	dispose(): void {
		this.mode = 'none';
		this.stopCurrent();
		this.groups.forEach((group) => group.dispose());
	}

	private onceEnded(
		group: BABYLON.AnimationGroup,
		next: () => void,
	): void {
		const observer = group.onAnimationGroupEndObservable.addOnce(() => {
			this.pendingEnd = null;
			next();
		});
		this.pendingEnd = () => {
			group.onAnimationGroupEndObservable.remove(observer);
			this.pendingEnd = null;
		};
	}

	private isLocked(): boolean {
		return this.mode === 'downed' || this.mode === 'revive';
	}

	private holdFallenPose(): void {
		const getUp = this.clips.getUp;
		if (!getUp) {
			this.current = null;
			return;
		}
		this.stopCurrent();
		getUp.play(false);
		getUp.pause();
		getUp.goToFrame(getUp.from);
		this.current = getUp;
	}

	private stopCurrent(): void {
		this.pendingEnd?.();
		this.current?.stop();
		this.current = null;
	}
}

/**
 * Selects the library's real walk and idle clips, with a procedural fallback
 * for older or minimal player assets that do not contain those clips.
 */
export function createPlayerAnimationController(
	root: BABYLON.AbstractMesh,
	animationGroups: readonly BABYLON.AnimationGroup[],
): PlayerAnimationController {
	const walk =
		findPlayerClip(animationGroups, PLAYER_CLIP_CANDIDATES.walk) ??
		animationGroups.find((group) => /walk/i.test(group.name)) ??
		animationGroups[0] ??
		createProceduralWalkAnimation(root);
	const clips: PlayerClips = {
		walk,
		idle: findPlayerClip(animationGroups, PLAYER_CLIP_CANDIDATES.idle),
		knockdown: findPlayerClip(
			animationGroups,
			PLAYER_CLIP_CANDIDATES.knockdown,
		),
		getUp: findPlayerClip(animationGroups, PLAYER_CLIP_CANDIDATES.getUp),
	};
	return new PlayerAnimationControllerImpl(clips, animationGroups);
}
