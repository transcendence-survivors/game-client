interface FrameTimeSample {
	timestampMs: number;
	valueMs: number;
}

export class FrameTimeHistory {
	private samples: FrameTimeSample[] = [];
	private head = 0;
	private size = 0;
	private readonly windowMs: number;
	private totalMs = 0;

	constructor(windowMs: number) {
		this.windowMs = windowMs;
	}

	add(valueMs: number, timestampMs: number): void {
		if (!Number.isFinite(valueMs) || !Number.isFinite(timestampMs)) return;

		this.removeExpired(timestampMs);
		this.ensureCapacity();
		const index = (this.head + this.size) % this.samples.length;
		const sample = this.samples[index];
		if (sample) {
			sample.timestampMs = timestampMs;
			sample.valueMs = valueMs;
		} else this.samples[index] = { timestampMs, valueMs };
		this.size++;
		this.totalMs += valueMs;
	}

	average(timestampMs: number): number | null {
		if (!Number.isFinite(timestampMs)) return null;

		this.removeExpired(timestampMs);
		return this.size > 0 ? this.totalMs / this.size : null;
	}

	private removeExpired(timestampMs: number): void {
		const oldestTimestampMs = timestampMs - this.windowMs;
		while (
			this.size > 0 &&
			this.samples[this.head]!.timestampMs < oldestTimestampMs
		) {
			const expired = this.samples[this.head]!;
			this.head = (this.head + 1) % this.samples.length;
			this.size--;
			this.totalMs -= expired.valueMs;
		}
		if (this.size === 0) this.head = 0;
	}

	private ensureCapacity(): void {
		if (this.size < this.samples.length) return;

		const nextCapacity = Math.max(16, this.samples.length * 2);
		const next = new Array<FrameTimeSample>(nextCapacity);
		for (let index = 0; index < this.size; index++) {
			next[index] =
				this.samples[(this.head + index) % this.samples.length];
		}
		this.samples = next;
		this.head = 0;
	}
}
