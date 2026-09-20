import { describe, expect, test } from 'vitest';
import { UpgradeQueue } from './UpgradeQueue';

const MENU_CLOSED = false;
const MENU_OPEN = true;

describe('while standing', () => {
	test('a level-up asks for options when the menu is closed', () => {
		const queue = new UpgradeQueue();
		expect(queue.addLevel(MENU_CLOSED)).toBe(true);
	});

	test('a level-up gained with the menu open only queues', () => {
		const queue = new UpgradeQueue();
		queue.addLevel(MENU_CLOSED);
		queue.markRequested();
		queue.receiveOptions(3);
		expect(queue.addLevel(MENU_OPEN)).toBe(false);
		expect(queue.hasPendingLevels()).toBe(true);
	});

	test('only one request is in flight at a time', () => {
		const queue = new UpgradeQueue();
		queue.addLevel(MENU_CLOSED);
		queue.markRequested();
		expect(queue.addLevel(MENU_CLOSED)).toBe(false);
	});

	test('picking a card chains to the next queued level', () => {
		const queue = new UpgradeQueue();
		queue.addLevel(MENU_CLOSED);
		queue.markRequested();
		queue.receiveOptions(3);
		queue.addLevel(MENU_OPEN);
		expect(queue.consumeLevel()).toBe(true);
	});

	test('picking the last card asks for nothing', () => {
		const queue = new UpgradeQueue();
		queue.addLevel(MENU_CLOSED);
		queue.markRequested();
		queue.receiveOptions(3);
		expect(queue.consumeLevel()).toBe(false);
		expect(queue.hasPendingLevels()).toBe(false);
	});

	test('an empty roll means nothing is left to offer', () => {
		const queue = new UpgradeQueue();
		queue.addLevel(MENU_CLOSED);
		queue.markRequested();
		queue.receiveOptions(0);
		expect(queue.hasPendingLevels()).toBe(false);
	});
});

describe('while downed', () => {
	test('a level-up is kept but never requested', () => {
		const queue = new UpgradeQueue();
		queue.setDowned(true);
		expect(queue.addLevel(MENU_CLOSED)).toBe(false);
		expect(queue.hasPendingLevels()).toBe(true);
	});

	test('the revive claims the levels gained on the ground', () => {
		const queue = new UpgradeQueue();
		queue.setDowned(true);
		queue.addLevel(MENU_CLOSED);
		expect(queue.setDowned(false)).toBe(true);
	});

	test('an unspent level survives the fall and comes back', () => {
		const queue = new UpgradeQueue();
		queue.addLevel(MENU_CLOSED);
		queue.markRequested();
		queue.receiveOptions(3);
		queue.setDowned(true);
		expect(queue.hasPendingLevels()).toBe(true);
		expect(queue.setDowned(false)).toBe(true);
	});

	test('a request lost in the fall does not block the revive', () => {
		const queue = new UpgradeQueue();
		queue.addLevel(MENU_CLOSED);
		queue.markRequested();
		queue.setDowned(true);
		expect(queue.setDowned(false)).toBe(true);
	});

	test('the revive asks for nothing when no level is pending', () => {
		const queue = new UpgradeQueue();
		queue.setDowned(true);
		expect(queue.setDowned(false)).toBe(false);
	});

	test('repeating the same state changes nothing', () => {
		const queue = new UpgradeQueue();
		queue.addLevel(MENU_CLOSED);
		queue.setDowned(true);
		expect(queue.setDowned(true)).toBe(false);
		expect(queue.isDowned()).toBe(true);
	});
});
