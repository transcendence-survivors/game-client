import { clamp01 } from '@transcendence/game-shared';
import { HUD_BAR_FILL_PERCENT } from './HudConstants';

interface BossHealthCandidate {
	isBoss: boolean;
	life: { current: number };
}

const padTimeComponent = (value: number): string =>
	String(value).padStart(2, '0');

export function isLivingBoss(monster: BossHealthCandidate): boolean {
	return (
		monster.isBoss &&
		Number.isFinite(monster.life.current) &&
		monster.life.current > 0
	);
}

function normalizedLifeRatio(current: number, max: number): number {
	if (!Number.isFinite(current) || !Number.isFinite(max) || max <= 0)
		return 0;
	return clamp01(current / max);
}

export function hudBarWidth(
	current: number,
	max: number,
	fillPercent = HUD_BAR_FILL_PERCENT,
): string {
	return `${(normalizedLifeRatio(current, max) * fillPercent).toFixed(2)}%`;
}

export function formatGameTime(totalSeconds: number): string {
	const safeSeconds = Number.isFinite(totalSeconds)
		? Math.max(0, Math.floor(totalSeconds))
		: 0;
	const seconds = safeSeconds % 60;
	const totalMinutes = Math.floor(safeSeconds / 60);
	const minutes = totalMinutes % 60;
	const hours =
		totalMinutes >= 60
			? `${padTimeComponent(Math.floor(totalMinutes / 60))}:`
			: '';
	return `${hours}${padTimeComponent(minutes)}:${padTimeComponent(seconds)}`;
}
