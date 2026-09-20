import type { ICanvasRenderingContext } from '@babylonjs/core';
import * as GUI from '@babylonjs/gui';
import { TAU } from '@transcendence/game-shared';

const ARC_START = -Math.PI / 2;

function clampProgress(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.min(1, Math.max(0, value));
}

export class RadialProgress extends GUI.Control {
	private progressValue = 0;

	thickness = 5;
	trackColor = '#00000099';
	fillColor = '#FFFFFFFF';

	constructor(name?: string) {
		super(name);
		this.isHitTestVisible = false;
	}

	get progress(): number {
		return this.progressValue;
	}

	set progress(value: number) {
		const clamped = clampProgress(value);
		if (clamped === this.progressValue) return;
		this.progressValue = clamped;
		this._markAsDirty();
	}

	protected _getTypeName(): string {
		return 'RadialProgress';
	}

	public _draw(context: ICanvasRenderingContext): void {
		context.save();
		this._applyStates(context);
		const measure = this._currentMeasure;
		const centerX = measure.left + measure.width / 2;
		const centerY = measure.top + measure.height / 2;
		const radius =
			Math.min(measure.width, measure.height) / 2 - this.thickness / 2;
		if (radius > 0) {
			context.lineWidth = this.thickness;
			context.beginPath();
			context.strokeStyle = this.trackColor;
			context.arc(centerX, centerY, radius, 0, TAU);
			context.stroke();
			if (this.progressValue > 0) {
				context.beginPath();
				context.strokeStyle = this.fillColor;
				context.arc(
					centerX,
					centerY,
					radius,
					ARC_START,
					ARC_START + TAU * this.progressValue,
				);
				context.stroke();
			}
		}
		context.restore();
	}
}
