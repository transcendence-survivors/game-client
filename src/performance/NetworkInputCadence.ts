import { MAX_DT } from '@transcendence/game-shared';

export const NETWORK_MOVE_INTERVAL_S = 1 / 30;
export const NETWORK_HEARTBEAT_INTERVAL_S = 1 / 5;

export class NetworkInputCadence {
	private elapsedS = 0;
	private previousStateDeltaTimeS = 0;
	private lastMoving = false;
	private started = false;

	advance(deltaTimeS: number, moving: boolean, force = false): number | null {
		this.previousStateDeltaTimeS = 0;
		const frameDeltaTime =
			Number.isFinite(deltaTimeS) && deltaTimeS > 0
				? Math.min(deltaTimeS, MAX_DT)
				: 0;
		this.elapsedS += frameDeltaTime;

		const interval = moving
			? NETWORK_MOVE_INTERVAL_S
			: NETWORK_HEARTBEAT_INTERVAL_S;
		const transitioned = this.started && moving !== this.lastMoving;
		if (
			!force &&
			this.started &&
			!transitioned &&
			this.elapsedS + Number.EPSILON < interval
		)
			return null;

		this.started = true;
		this.lastMoving = moving;
		const changesInputState = transitioned || force;
		if (changesInputState)
			this.previousStateDeltaTimeS = Math.min(
				Math.max(0, this.elapsedS - frameDeltaTime),
				MAX_DT,
			);
		const packetDeltaTime = changesInputState
			? Math.max(frameDeltaTime, Number.EPSILON)
			: Math.min(Math.max(this.elapsedS, Number.EPSILON), MAX_DT);
		this.elapsedS = changesInputState
			? 0
			: Math.max(0, this.elapsedS - packetDeltaTime);
		return packetDeltaTime;
	}

	takePreviousStateDeltaTime(): number {
		const deltaTime = this.previousStateDeltaTimeS;
		this.previousStateDeltaTimeS = 0;
		return deltaTime;
	}

	pendingDeltaTime(): number {
		return Math.min(this.elapsedS, MAX_DT);
	}

	reset(): void {
		this.elapsedS = 0;
		this.previousStateDeltaTimeS = 0;
		this.lastMoving = false;
		this.started = false;
	}
}
