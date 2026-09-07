import { CONFIG } from './config.js';

export function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
export function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}
export function getTheme() { return localStorage.getItem(CONFIG.storageKeys.theme) || 'dark'; }
export function setTheme(value) { localStorage.setItem(CONFIG.storageKeys.theme, value); }
export function getSettings() { return { ...CONFIG.defaultBenchmark, ...readJson(CONFIG.storageKeys.settings, {}) }; }
export function saveSettings(value) { return writeJson(CONFIG.storageKeys.settings, value); }
export function getHistory() { return readJson(CONFIG.storageKeys.history, []); }
export function pushHistory(entry) {
  const next = [entry, ...getHistory()].slice(0, CONFIG.historyLimit);
  writeJson(CONFIG.storageKeys.history, next);
  return next;
}
export function clearHistory() { localStorage.removeItem(CONFIG.storageKeys.history); }
