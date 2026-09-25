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

const catalogs = { fr, en, de, es, che, it } as const satisfies Record<
	GameLocale,
	TranslationCatalog
>;

type LocaleListener = (locale: GameLocale) => void;

export class GameI18n {
	private locale: GameLocale = DEFAULT_GAME_LOCALE;
	private readonly listeners = new Set<LocaleListener>();

	getLocale(): GameLocale {
		return this.locale;
	}

	setLocale(locale: GameLocale): void {
		if (locale === this.locale) return;

		this.locale = locale;
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
}

export const gameI18n = new GameI18n();
