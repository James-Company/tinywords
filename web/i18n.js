/**
 * TinyWords i18n Runtime
 * SSOT: docs/21_I18N_LOCALIZATION.md
 *
 * Fallback chain: user selection → OS locale → ko-KR
 */

const I18N_STORAGE_KEY = "tinywords_locale";
const DEFAULT_LOCALE = "ko-KR";
const SUPPORTED_LOCALES = ["ko-KR", "en-US"];

/** @type {Record<string, Record<string, string>>} */
const localeData = {};

/** @type {string} */
let currentLocale = DEFAULT_LOCALE;

/** @type {Array<() => void>} */
const listeners = [];

/**
 * Load a locale JSON file and cache it.
 * @param {string} locale
 * @returns {Promise<Record<string, string>>}
 */
async function loadLocale(locale) {
  if (localeData[locale]) return localeData[locale];
  try {
    const res = await fetch(`/i18n/${locale}.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    localeData[locale] = data;
    return data;
  } catch (err) {
    console.warn(`[i18n] Failed to load locale "${locale}":`, err.message);
    return {};
  }
}

/**
 * Detect the best locale from: stored preference → OS → default.
 * @returns {string}
 */
function detectLocale() {
  // 1. User preference
  const stored = localStorage.getItem(I18N_STORAGE_KEY);
  if (stored && SUPPORTED_LOCALES.includes(stored)) return stored;

  // 2. OS / browser locale
  const nav = navigator.language || navigator.languages?.[0] || "";
  for (const supported of SUPPORTED_LOCALES) {
    if (nav === supported) return supported;
    if (nav.startsWith(supported.split("-")[0])) return supported;
  }

  // 3. Default
  return DEFAULT_LOCALE;
}

/**
 * Initialize i18n: detect locale and load resources.
 * @returns {Promise<void>}
 */
async function initI18n() {
  currentLocale = detectLocale();

  // Always load default (fallback) first, then current
  await loadLocale(DEFAULT_LOCALE);
  if (currentLocale !== DEFAULT_LOCALE) {
    await loadLocale(currentLocale);
  }

  document.documentElement.lang = currentLocale.split("-")[0];
}

/**
 * Change locale, persist, reload strings.
 * @param {string} locale
 * @returns {Promise<void>}
 */
async function setLocale(locale) {
  if (!SUPPORTED_LOCALES.includes(locale)) {
    console.warn(`[i18n] Unsupported locale: "${locale}"`);
    return;
  }

  currentLocale = locale;
  localStorage.setItem(I18N_STORAGE_KEY, locale);
  await loadLocale(locale);
  document.documentElement.lang = locale.split("-")[0];

  // Notify all listeners (re-render)
  listeners.forEach((fn) => fn());
}

/**
 * Get current locale.
 * @returns {string}
 */
function getLocale() {
  return currentLocale;
}

/**
 * Get list of supported locales.
 * @returns {string[]}
 */
function getSupportedLocales() {
  return [...SUPPORTED_LOCALES];
}

/**
 * Translate a key with optional interpolation variables.
 * Fallback: current locale → default locale → key itself.
 *
 * @param {string} key - Dot-separated key (e.g. "today.cta.start")
 * @param {Record<string, string | number>} [vars] - Interpolation variables
 * @returns {string}
 */
function t(key, vars) {
  const current = localeData[currentLocale] || {};
  const fallback = localeData[DEFAULT_LOCALE] || {};

  let value = current[key] ?? fallback[key] ?? key;

  // Simple variable interpolation: {varName}
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      value = value.replaceAll(`{${k}}`, String(v));
    }
  }

  return value;
}

/**
 * Register a callback for locale changes.
 * @param {() => void} fn
 * @returns {() => void} unsubscribe function
 */
function onLocaleChange(fn) {
  listeners.push(fn);
  return () => {
    const idx = listeners.indexOf(fn);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

// Export for use as module
export { initI18n, setLocale, getLocale, getSupportedLocales, t, onLocaleChange, SUPPORTED_LOCALES, DEFAULT_LOCALE };
