import type en from './locales/en';

export const GAME_LOCALES = ['fr', 'en', 'de', 'es', 'che', 'it'] as const;
export const DEFAULT_GAME_LOCALE = 'en' as const;

export type GameLocale = (typeof GAME_LOCALES)[number];
export type TranslationKey = keyof typeof en;
export type TranslationCatalog = Record<TranslationKey, string>;
export type TranslationParams = Readonly<Record<string, string | number>>;
