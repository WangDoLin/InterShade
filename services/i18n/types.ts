export type SupportedLocale =
  | 'en'
  | 'vi'
  | 'ja'
  | 'zh'
  | 'es'
  | 'fr'
  | 'de'
  | 'ko'
  | 'ru';

export const SUPPORTED_LOCALES: readonly SupportedLocale[] = [
  'en',
  'vi',
  'ja',
  'zh',
  'es',
  'fr',
  'de',
  'ko',
  'ru',
] as const;

export type TranslationDictionary = Record<string, string>;

export interface I18nCatalog {
  locale: SupportedLocale;
  messages: TranslationDictionary;
}
