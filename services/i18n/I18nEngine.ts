import fs from 'fs';
import path from 'path';
import type { SupportedLocale, TranslationDictionary } from './types.js';
import { SUPPORTED_LOCALES } from './types.js';

export class I18nEngine {
  private activeLocale: SupportedLocale = 'en';
  private catalogs: Map<SupportedLocale, TranslationDictionary> = new Map();

  constructor(defaultLocale?: string) {
    this.loadAllCatalogs();
    if (defaultLocale) {
      this.setLocale(defaultLocale);
    } else {
      this.detectSystemLocale();
    }
  }

  getLocale(): SupportedLocale {
    return this.activeLocale;
  }

  setLocale(rawLocale: string): boolean {
    const normalized = rawLocale.toLowerCase().trim().replace(/_/g, '-') as SupportedLocale;
    if (SUPPORTED_LOCALES.includes(normalized)) {
      this.activeLocale = normalized;
      return true;
    }
    // Prefix match (e.g. "vi-VN" -> "vi", "en-US" -> "en", "ja-JP" -> "ja")
    const prefix = normalized.split('-')[0] as SupportedLocale;
    if (SUPPORTED_LOCALES.includes(prefix)) {
      this.activeLocale = prefix;
      return true;
    }
    return false;
  }

  t(key: string, params?: Record<string, unknown> | unknown[]): string {
    const activeDict = this.catalogs.get(this.activeLocale);
    const enDict = this.catalogs.get('en');

    let template = activeDict ? activeDict[key] : undefined;

    // Fallback 1: English
    if (!template && enDict) {
      template = enDict[key];
    }

    // Fallback 2: Raw key
    if (!template) {
      return key;
    }

    if (!params) {
      return template;
    }

    // Array / Positional replacement: {0}, {1}, {2}
    if (Array.isArray(params)) {
      return template.replace(/\{(\d+)\}/g, (match, idx) => {
        const val = params[parseInt(idx, 10)];
        return val !== undefined ? String(val) : match;
      });
    }

    // Object / Named replacement: {name}, {path}
    if (typeof params === 'object') {
      return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, prop) => {
        const val = (params as Record<string, unknown>)[prop];
        return val !== undefined ? String(val) : match;
      });
    }

    return template;
  }

  private detectSystemLocale(): void {
    const envLang = process.env.INTERSHADE_LANG || process.env.LC_ALL || process.env.LANG;
    if (envLang) {
      this.setLocale(envLang);
    }
  }

  private loadAllCatalogs(): void {
    const candidateDirs: string[] = [];
    try {
      const currentDir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
      candidateDirs.push(path.resolve(currentDir, '../../locales'));
      candidateDirs.push(path.resolve(currentDir, '../locales'));
    } catch {
      // Ignore URL parsing errors
    }
    candidateDirs.push(path.resolve(process.cwd(), 'locales'));

    let foundDir = '';
    for (const dir of candidateDirs) {
      if (fs.existsSync(dir) && fs.existsSync(path.join(dir, 'en.json'))) {
        foundDir = dir;
        break;
      }
    }

    if (!foundDir) return;

    for (const loc of SUPPORTED_LOCALES) {
      const filePath = path.join(foundDir, `${loc}.json`);
      if (fs.existsSync(filePath)) {
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const dict = JSON.parse(content);
          this.catalogs.set(loc, dict);
        } catch {
          // Fall back gracefully if a catalog fails to parse
        }
      }
    }
  }
}

// Export global singleton instance
export const i18n = new I18nEngine();
export const t = (key: string, params?: Record<string, unknown> | unknown[]): string => i18n.t(key, params);
