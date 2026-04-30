/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { en } from './locales/en';
import { es } from './locales/es';

export type LanguageCode = 'en' | 'es' | string;
export type TranslationMap = Record<string, string>;

export interface LanguagePack {
  locale: LanguageCode;
  name: string;
  nativeName?: string;
  version?: string;
  author?: string;
  strings: TranslationMap;
}

export interface LanguageOption {
  locale: LanguageCode;
  name: string;
  nativeName?: string;
  bundled: boolean;
}

const LANGUAGE_STORAGE_KEY = 'tytus_language_v1';
const LANGUAGE_PACKS_STORAGE_KEY = 'tytus_language_packs_v1';

const bundledPacks: Record<string, LanguagePack> = {
  en: { locale: 'en', name: 'English', nativeName: 'English', version: '1.0.0', strings: en },
  es: { locale: 'es', name: 'Spanish', nativeName: 'Español', version: '1.0.0', strings: es },
};

const safeLocalStorageGet = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const safeLocalStorageSet = (key: string, value: string): void => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Best-effort. Private/sandboxed browsers may reject storage.
  }
};

const normalizeLocale = (locale: string | null | undefined): string => {
  const raw = (locale || 'en').trim().toLowerCase().replace('_', '-');
  return raw.split('-')[0] || 'en';
};

const browserLanguage = (): string => {
  if (typeof navigator === 'undefined') return 'en';
  return normalizeLocale(navigator.languages?.[0] || navigator.language);
};

const readStoredLanguage = (): string => {
  const stored = safeLocalStorageGet(LANGUAGE_STORAGE_KEY);
  if (stored) return normalizeLocale(stored);
  const detected = browserLanguage();
  return bundledPacks[detected] ? detected : 'en';
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const validatePack = (value: unknown): LanguagePack => {
  if (!isRecord(value)) throw new Error('Language pack must be a JSON object.');
  const locale = normalizeLocale(typeof value.locale === 'string' ? value.locale : undefined);
  const strings = value.strings;
  if (!locale || locale.length > 16) throw new Error('Language pack has invalid locale.');
  if (!isRecord(strings)) throw new Error('Language pack must contain a strings object.');

  const cleanStrings: TranslationMap = {};
  for (const [key, text] of Object.entries(strings)) {
    if (typeof key !== 'string' || typeof text !== 'string') continue;
    if (!key || key.length > 160 || text.length > 2000) continue;
    cleanStrings[key] = text;
  }
  if (Object.keys(cleanStrings).length === 0) {
    throw new Error('Language pack has no valid string entries.');
  }

  return {
    locale,
    name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : locale,
    nativeName: typeof value.nativeName === 'string' ? value.nativeName.trim() : undefined,
    version: typeof value.version === 'string' ? value.version.trim() : undefined,
    author: typeof value.author === 'string' ? value.author.trim() : undefined,
    strings: cleanStrings,
  };
};

const readCustomPacks = (): Record<string, LanguagePack> => {
  const raw = safeLocalStorageGet(LANGUAGE_PACKS_STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) return {};
    const packs: Record<string, LanguagePack> = {};
    for (const candidate of Object.values(parsed)) {
      try {
        const pack = validatePack(candidate);
        packs[pack.locale] = pack;
      } catch {
        // Ignore malformed stored packs rather than breaking boot.
      }
    }
    return packs;
  } catch {
    return {};
  }
};

const writeCustomPacks = (packs: Record<string, LanguagePack>): void => {
  safeLocalStorageSet(LANGUAGE_PACKS_STORAGE_KEY, JSON.stringify(packs));
};

interface I18nContextValue {
  language: LanguageCode;
  availableLanguages: LanguageOption[];
  t: (key: string, vars?: Record<string, string | number>) => string;
  setLanguage: (locale: LanguageCode) => void;
  installLanguagePack: (jsonText: string) => LanguagePack;
  removeLanguagePack: (locale: LanguageCode) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

const interpolate = (text: string, vars?: Record<string, string | number>): string => {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? `{${key}}`));
};

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<LanguageCode>(() => readStoredLanguage());
  const [customPacks, setCustomPacks] = useState<Record<string, LanguagePack>>(() => readCustomPacks());

  const allPacks = useMemo(() => ({ ...bundledPacks, ...customPacks }), [customPacks]);

  const availableLanguages = useMemo<LanguageOption[]>(() => {
    return Object.values(allPacks)
      .map((pack) => ({
        locale: pack.locale,
        name: pack.name,
        nativeName: pack.nativeName,
        bundled: Boolean(bundledPacks[pack.locale]),
      }))
      .sort((a, b) => (a.bundled === b.bundled ? a.name.localeCompare(b.name) : a.bundled ? -1 : 1));
  }, [allPacks]);

  const setLanguage = useCallback((locale: LanguageCode) => {
    const next = normalizeLocale(locale);
    setLanguageState(next);
    safeLocalStorageSet(LANGUAGE_STORAGE_KEY, next);
  }, []);

  const installLanguagePack = useCallback((jsonText: string): LanguagePack => {
    const pack = validatePack(JSON.parse(jsonText));
    if (bundledPacks[pack.locale]) {
      throw new Error('Bundled languages cannot be overwritten. Use a different locale.');
    }
    setCustomPacks((prev) => {
      const next = { ...prev, [pack.locale]: pack };
      writeCustomPacks(next);
      return next;
    });
    return pack;
  }, []);

  const removeLanguagePack = useCallback((locale: LanguageCode) => {
    const normalized = normalizeLocale(locale);
    if (bundledPacks[normalized]) return;
    setCustomPacks((prev) => {
      const next = { ...prev };
      delete next[normalized];
      writeCustomPacks(next);
      return next;
    });
    if (normalizeLocale(language) === normalized) setLanguage('en');
  }, [language, setLanguage]);

  const t = useCallback((key: string, vars?: Record<string, string | number>) => {
    const normalized = normalizeLocale(language);
    const primary = allPacks[normalized]?.strings[key];
    const fallback = bundledPacks.en.strings[key];
    return interpolate(primary ?? fallback ?? key, vars);
  }, [allPacks, language]);

  const value = useMemo<I18nContextValue>(() => ({
    language,
    availableLanguages,
    t,
    setLanguage,
    installLanguagePack,
    removeLanguagePack,
  }), [availableLanguages, installLanguagePack, language, removeLanguagePack, setLanguage, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = (): I18nContextValue => {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
};

export const languagePackExample = {
  locale: 'fr',
  name: 'French',
  nativeName: 'Français',
  version: '1.0.0',
  author: 'Community',
  strings: {
    'settings.appearance.language.title': 'Langue',
    'settings.appearance.language.description': 'Choisissez la langue de Tytus OS.',
  },
};
