export class UpgradeQueue {
	private pending = 0;
	private awaitingOptions = false;
	private downed = false;

	addLevel(menuOpen: boolean): boolean {
		this.pending++;
		return !menuOpen && this.shouldRequest();
	}

	receiveOptions(optionCount: number): void {
		this.awaitingOptions = false;
		if (optionCount === 0) this.pending = 0;
	}

	consumeLevel(): boolean {
		this.pending = Math.max(0, this.pending - 1);
		return this.shouldRequest();
	}

	setDowned(downed: boolean): boolean {
		if (this.downed === downed) return false;
		this.downed = downed;
		if (downed) this.awaitingOptions = false;
		return !downed && this.shouldRequest();
	}

	isDowned(): boolean {
		return this.downed;
	}

	hasPendingLevels(): boolean {
		return this.pending > 0;
	}

	markRequested(): void {
		this.awaitingOptions = true;
	}

	private shouldRequest(): boolean {
		return !this.downed && this.pending > 0 && !this.awaitingOptions;
	}
}
