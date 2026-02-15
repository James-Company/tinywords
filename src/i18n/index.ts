/**
 * TinyWords i18n Module (Server-side / Shared)
 * SSOT: docs/21_I18N_LOCALIZATION.md
 *
 * Provides locale-aware translation for server-side rendering
 * and domain logic string generation.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export type SupportedLocale = "ko-KR" | "en-US";
export const SUPPORTED_LOCALES: readonly SupportedLocale[] = ["ko-KR", "en-US"];
export const DEFAULT_LOCALE: SupportedLocale = "ko-KR";

type Messages = Record<string, string>;

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadJson(filename: string): Messages {
  const filePath = resolve(__dirname, "locales", filename);
  const content = readFileSync(filePath, "utf-8");
  return JSON.parse(content) as Messages;
}

const localeMap: Record<SupportedLocale, Messages> = {
  "ko-KR": loadJson("ko-KR.json"),
  "en-US": loadJson("en-US.json"),
};

/**
 * Translate a key for the given locale with optional variable interpolation.
 * Fallback: requested locale → default locale → raw key.
 */
export function t(
  locale: SupportedLocale,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const current = localeMap[locale] ?? {};
  const fallback = localeMap[DEFAULT_LOCALE] ?? {};

  let value = current[key] ?? fallback[key] ?? key;

  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      value = value.replaceAll(`{${k}}`, String(v));
    }
  }

  return value;
}

/**
 * Check if a locale string is a supported locale.
 */
export function isSupportedLocale(locale: string): locale is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(locale);
}

/**
 * Get messages object for a locale (useful for bulk operations).
 */
export function getMessages(locale: SupportedLocale): Messages {
  return localeMap[locale] ?? localeMap[DEFAULT_LOCALE];
}
