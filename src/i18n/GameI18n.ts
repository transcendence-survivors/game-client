import en from './locales/en';
import fr from './locales/fr';
import de from './locales/de';
import es from './locales/es';
import che from './locales/che';
import it from './locales/it';
import {
	DEFAULT_GAME_LOCALE,
	type GameLocale,
	type TranslationCatalog,
	type TranslationKey,
	type TranslationParams,
} from './types';

const catalogs = { fr, en, de, es, che, it } as const satisfies Record<
	GameLocale,
	TranslationCatalog
>;

export class GameI18n {
	private locale: GameLocale = DEFAULT_GAME_LOCALE;

	getLocale(): GameLocale {
		return this.locale;
	}

	setLocale(locale: GameLocale): void {
		this.locale = locale;
	}

	t(key: TranslationKey, params: TranslationParams = {}): string {
		const template = catalogs[this.getLocale()][key] ?? catalogs.en[key];
		return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
			const value = params[name];
			return value === undefined ? placeholder : String(value);
		});
	}
}

export const gameI18n = new GameI18n();
