import en from './locales/en';
import fr from './locales/fr';
import de from './locales/de';
import es from './locales/es';
import che from './locales/che';
import it from './locales/it';
import {
	DEFAULT_GAME_LOCALE,
	GAME_LOCALES,
	type GameLocale,
	type TranslationCatalog,
	type TranslationKey,
	type TranslationParams,
} from './types';

const STORAGE_KEY = 'transcendence-survivors.game-locale';

const catalogs = { fr, en, de, es, che, it } as const satisfies Record<
	GameLocale,
	TranslationCatalog
>;

type LocaleListener = (locale: GameLocale) => void;

const isGameLocale = (value: unknown): value is GameLocale =>
	typeof value === 'string' &&
	(GAME_LOCALES as readonly string[]).includes(value);

export class GameI18n {
	private locale: GameLocale = DEFAULT_GAME_LOCALE;
	private hydrated = false;
	private readonly listeners = new Set<LocaleListener>();

	getLocale(): GameLocale {
		this.hydrate();
		return this.locale;
	}

	setLocale(locale: GameLocale): void {
		this.hydrate();
		if (locale === this.locale) return;

		this.locale = locale;
		this.persist(locale);
		for (const listener of this.listeners) listener(locale);
	}

	getNextLocale(): GameLocale {
		const currentIndex = GAME_LOCALES.indexOf(this.getLocale());
		return (
			GAME_LOCALES[(currentIndex + 1) % GAME_LOCALES.length] ??
			DEFAULT_GAME_LOCALE
		);
	}

	t(key: TranslationKey, params: TranslationParams = {}): string {
		const template = catalogs[this.getLocale()][key] ?? catalogs.en[key];
		return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
			const value = params[name];
			return value === undefined ? placeholder : String(value);
		});
	}

	subscribe(listener: LocaleListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private hydrate(): void {
		if (this.hydrated) return;
		this.hydrated = true;

		try {
			if (typeof window === 'undefined') return;
			const storedLocale = window.localStorage.getItem(STORAGE_KEY);
			if (isGameLocale(storedLocale)) this.locale = storedLocale;
		} catch {
			// Storage can be unavailable in privacy-restricted browser contexts.
		}
	}

	private persist(locale: GameLocale): void {
		try {
			if (typeof window !== 'undefined') {
				window.localStorage.setItem(STORAGE_KEY, locale);
			}
		} catch {
			// The in-memory preference remains usable when persistence is blocked.
		}
	}
}

export const gameI18n = new GameI18n();
