import type { AnimationGroup, Observer } from '@babylonjs/core';
import type { ModelAssetLibrary } from './ModelAssetLibrary';
import { applyTransform } from './Transform';
import { models } from './models';

type Mode = 'idle' | 'walk' | 'downed' | 'revive';

export class PlayerAnimations {
	private readonly groups: readonly AnimationGroup[];
	private readonly walk: AnimationGroup;
	private readonly idle: AnimationGroup;
	private readonly knockdown: AnimationGroup;
	private readonly getUp: AnimationGroup;
	private current: AnimationGroup | null = null;
	private onEnd: Observer<AnimationGroup> | null = null;
	private mode: Mode | null = null;

	constructor(groups: readonly AnimationGroup[]) {
		const clip = (name: string) => {
			const group = groups.find((entry) =>
				entry.name.endsWith(`:${name}`),
			);
			if (!group)
				throw new Error(`player animation '${name}' is missing`);
			return group;
		};
		this.groups = groups;
		this.walk = clip('Walk_Loop');
		this.idle = clip('Idle_No_Loop');
		this.knockdown = clip('Hit_Knockback');
		this.getUp = clip('LayToIdle');
	}

	playWalk(): void {
		if (!this.isLocked()) this.play('walk', this.walk, true);
	}

	playIdle(): void {
		if (!this.isLocked()) this.play('idle', this.idle, false);
	}

	playDowned(): void {
		this.play('downed', this.knockdown, false, () => {
			this.stop();
			this.getUp.play(false);
			this.getUp.pause();
			this.getUp.goToFrame(this.getUp.from);
			this.current = this.getUp;
		});
	}

	playRevive(): void {
		this.play('revive', this.getUp, false, () => {
			this.mode = null;
			this.playIdle();
		});
	}

	dispose(): void {
		this.stop();
		this.groups.forEach((group) => group.dispose());
	}

	private play(
		mode: Mode,
		group: AnimationGroup,
		loop: boolean,
		then?: () => void,
	): void {
		if (this.mode === mode) return;
		this.stop();
		this.mode = mode;
		this.current = group;
		group.play(loop);
		if (then)
			this.onEnd = group.onAnimationGroupEndObservable.addOnce(() => {
				this.onEnd = null;
				then();
			});
	}

	private stop(): void {
		this.current?.onAnimationGroupEndObservable.remove(this.onEnd);
		this.onEnd = null;
		this.current?.stop();
		this.current = null;
	}

	private isLocked(): boolean {
		return this.mode === 'downed' || this.mode === 'revive';
	}
}

export async function createPlayerModel(
	assets: ModelAssetLibrary,
	name: string,
) {
	const { root, animationGroups } = await assets.instantiate(
		models.player,
		name,
	);
	applyTransform(root);
	const animations = new PlayerAnimations(animationGroups);
	animations.playIdle();
	return { root, animations };
}
