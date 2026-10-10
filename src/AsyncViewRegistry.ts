export class AsyncViewRegistry<TView extends { dispose(): void }> {
	private readonly views = new Map<string, TView>();
	private readonly pending = new Map<string, object>();
	private disposed = false;

	async add(id: string, create: () => Promise<TView>): Promise<void> {
		if (this.disposed) return;
		const token = {};
		this.pending.set(id, token);
		let view: TView;
		try {
			view = await create();
		} catch (error) {
			if (this.pending.get(id) === token) this.pending.delete(id);
			throw error;
		}
		if (this.disposed || this.pending.get(id) !== token)
			return view.dispose();
		this.pending.delete(id);
		this.views.get(id)?.dispose();
		this.views.set(id, view);
	}

	get(id: string): TView | undefined {
		return this.views.get(id);
	}

	remove(id: string): void {
		this.pending.delete(id);
		this.views.get(id)?.dispose();
		this.views.delete(id);
	}

	forEach(callback: (view: TView, id: string) => void): void {
		this.views.forEach(callback);
	}

	dispose(): void {
		this.disposed = true;
		this.pending.clear();
		this.views.forEach((view) => view.dispose());
		this.views.clear();
	}
}
