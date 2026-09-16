export interface ForestBounds {
	readonly minX: number;
	readonly maxX: number;
	readonly minY: number;
	readonly maxY: number;
	readonly minZ: number;
	readonly maxZ: number;
}

export interface ForestFrustumPlane {
	readonly normal: {
		readonly x: number;
		readonly y: number;
		readonly z: number;
	};
	readonly d: number;
}

export interface ForestDisplayCircle {
	centerX: number;
	centerZ: number;
	radius: number;
}

interface ForestQuadtreeEntry<T> {
	readonly key: string;
	readonly bounds: ForestBounds;
	readonly value: T;
	active: boolean;
}

interface ForestQuadtreeNode<T> {
	readonly bounds: ForestBounds;
	readonly entries: ForestQuadtreeEntry<T>[];
	children: ForestQuadtreeNode<T>[] | null;
}

const DEFAULT_NODE_CAPACITY = 8;
const DEFAULT_MAX_DEPTH = 12;

export class ForestQuadtree<T> {
	private readonly initialSize: number;
	private readonly nodeCapacity: number;
	private readonly maxDepth: number;
	private readonly entries = new Map<string, ForestQuadtreeEntry<T>>();
	private root: ForestQuadtreeNode<T>;
	private staleEntryCount = 0;
	private queryRadiusSquared = 0;

	constructor(
		initialSize: number,
		nodeCapacity = DEFAULT_NODE_CAPACITY,
		maxDepth = DEFAULT_MAX_DEPTH,
	) {
		this.initialSize = Math.max(1, initialSize);
		this.nodeCapacity = Math.max(1, Math.floor(nodeCapacity));
		this.maxDepth = Math.max(1, Math.floor(maxDepth));
		this.root = this.createNode(this.createRootBounds(this.initialSize));
	}

	insert(key: string, bounds: ForestBounds, value: T): void {
		if (this.entries.has(key)) return;
		const entry: ForestQuadtreeEntry<T> = {
			key,
			bounds,
			value,
			active: true,
		};
		this.entries.set(key, entry);
		if (!this.ensureRootContains(bounds))
			this.insertIntoNode(this.root, entry, 0);
	}

	remove(key: string): void {
		const entry = this.entries.get(key);
		if (!entry) return;
		entry.active = false;
		this.entries.delete(key);
		this.staleEntryCount++;

		if (
			this.entries.size === 0 ||
			(this.staleEntryCount >= this.nodeCapacity * 2 &&
				this.staleEntryCount > this.entries.size)
		)
			this.rebuild();
	}

	query(
		frustumPlanes: readonly ForestFrustumPlane[],
		result: Set<T>,
		displayCircle?: ForestDisplayCircle,
	): void {
		result.clear();
		this.queryRadiusSquared = displayCircle
			? displayCircle.radius * displayCircle.radius
			: 0;
		this.queryNode(this.root, frustumPlanes, result, displayCircle);
	}

	clear(): void {
		this.entries.clear();
		this.staleEntryCount = 0;
		this.root = this.createNode(this.createRootBounds(this.initialSize));
	}

	private createRootBounds(size: number): ForestBounds {
		const halfSize = size * 0.5;
		return {
			minX: -halfSize,
			maxX: halfSize,
			minY: -1_000_000_000,
			maxY: 1_000_000_000,
			minZ: -halfSize,
			maxZ: halfSize,
		};
	}

	private createNode(bounds: ForestBounds): ForestQuadtreeNode<T> {
		return { bounds, entries: [], children: null };
	}

	private ensureRootContains(bounds: ForestBounds): boolean {
		const currentBounds = this.root.bounds;
		let rootBounds = currentBounds;
		while (!this.contains(rootBounds, bounds))
			rootBounds = this.expandedBounds(rootBounds, bounds);
		if (rootBounds === currentBounds) return false;

		this.root = this.createNode(rootBounds);
		for (const entry of this.entries.values())
			this.insertIntoNode(this.root, entry, 0);
		return true;
	}

	private rebuild(): void {
		let bounds = this.createRootBounds(this.initialSize);
		for (const entry of this.entries.values())
			while (!this.contains(bounds, entry.bounds))
				bounds = this.expandedBounds(bounds, entry.bounds);

		this.root = this.createNode(bounds);
		for (const entry of this.entries.values())
			this.insertIntoNode(this.root, entry, 0);
		this.staleEntryCount = 0;
	}

	private expandedBounds(
		current: ForestBounds,
		content: ForestBounds,
	): ForestBounds {
		const size = current.maxX - current.minX;
		return {
			minX:
				content.minX < current.minX
					? current.minX - size
					: current.minX,
			maxX:
				content.maxX > current.maxX
					? current.maxX + size
					: current.maxX,
			minY: current.minY,
			maxY: current.maxY,
			minZ:
				content.minZ < current.minZ
					? current.minZ - size
					: current.minZ,
			maxZ:
				content.maxZ > current.maxZ
					? current.maxZ + size
					: current.maxZ,
		};
	}

	private insertIntoNode(
		node: ForestQuadtreeNode<T>,
		entry: ForestQuadtreeEntry<T>,
		depth: number,
	): void {
		if (node.children) {
			const child = this.childContaining(node, entry.bounds);
			if (child) {
				this.insertIntoNode(child, entry, depth + 1);
				return;
			}
		}

		node.entries.push(entry);
		if (
			node.children ||
			node.entries.length <= this.nodeCapacity ||
			depth >= this.maxDepth
		)
			return;

		this.splitNode(node, depth);
	}

	private splitNode(node: ForestQuadtreeNode<T>, depth: number): void {
		const { minX, maxX, minY, maxY, minZ, maxZ } = node.bounds;
		const midX = (minX + maxX) * 0.5;
		const midZ = (minZ + maxZ) * 0.5;
		node.children = [
			this.createNode({ minX, maxX: midX, minY, maxY, minZ, maxZ: midZ }),
			this.createNode({ minX: midX, maxX, minY, maxY, minZ, maxZ: midZ }),
			this.createNode({ minX, maxX: midX, minY, maxY, minZ: midZ, maxZ }),
			this.createNode({ minX: midX, maxX, minY, maxY, minZ: midZ, maxZ }),
		];
		const entries = node.entries.splice(0);
		for (const entry of entries) {
			const child = this.childContaining(node, entry.bounds);
			if (child) this.insertIntoNode(child, entry, depth + 1);
			else node.entries.push(entry);
		}
	}

	private childContaining(
		node: ForestQuadtreeNode<T>,
		bounds: ForestBounds,
	): ForestQuadtreeNode<T> | null {
		if (!node.children) return null;
		const midX = (node.bounds.minX + node.bounds.maxX) * 0.5;
		const midZ = (node.bounds.minZ + node.bounds.maxZ) * 0.5;
		const isLeft = bounds.maxX <= midX;
		const isRight = bounds.minX >= midX;
		const isTop = bounds.maxZ <= midZ;
		const isBottom = bounds.minZ >= midZ;
		if ((!isLeft && !isRight) || (!isTop && !isBottom)) return null;
		const childIndex = isRight ? (isBottom ? 3 : 1) : isBottom ? 2 : 0;
		return node.children[childIndex] ?? null;
	}

	private queryNode(
		node: ForestQuadtreeNode<T>,
		frustumPlanes: readonly ForestFrustumPlane[],
		result: Set<T>,
		displayCircle?: ForestDisplayCircle,
	): void {
		if (
			this.isOutside(node.bounds, frustumPlanes) ||
			(displayCircle && this.isOutsideCircle(node.bounds, displayCircle))
		)
			return;
		for (const entry of node.entries)
			if (
				entry.active &&
				!this.isOutside(entry.bounds, frustumPlanes) &&
				(!displayCircle ||
					!this.isOutsideCircle(entry.bounds, displayCircle))
			)
				result.add(entry.value);
		if (!node.children) return;
		for (const child of node.children)
			this.queryNode(child, frustumPlanes, result, displayCircle);
	}

	private isOutside(
		bounds: ForestBounds,
		frustumPlanes: readonly ForestFrustumPlane[],
	): boolean {
		for (const plane of frustumPlanes) {
			const x = plane.normal.x >= 0 ? bounds.maxX : bounds.minX;
			const y = plane.normal.y >= 0 ? bounds.maxY : bounds.minY;
			const z = plane.normal.z >= 0 ? bounds.maxZ : bounds.minZ;
			if (
				plane.normal.x * x +
					plane.normal.y * y +
					plane.normal.z * z +
					plane.d <
				0
			)
				return true;
		}
		return false;
	}

	private isOutsideCircle(
		bounds: ForestBounds,
		circle: ForestDisplayCircle,
	): boolean {
		const closestX =
			circle.centerX < bounds.minX
				? bounds.minX
				: circle.centerX > bounds.maxX
					? bounds.maxX
					: circle.centerX;
		const closestZ =
			circle.centerZ < bounds.minZ
				? bounds.minZ
				: circle.centerZ > bounds.maxZ
					? bounds.maxZ
					: circle.centerZ;
		const dx = closestX - circle.centerX;
		const dz = closestZ - circle.centerZ;
		return dx * dx + dz * dz > this.queryRadiusSquared;
	}

	private contains(container: ForestBounds, content: ForestBounds): boolean {
		return (
			content.minX >= container.minX &&
			content.maxX <= container.maxX &&
			content.minZ >= container.minZ &&
			content.maxZ <= container.maxZ
		);
	}
}
