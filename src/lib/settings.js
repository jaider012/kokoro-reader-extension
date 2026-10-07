// Settings validation. Pure functions, no chrome APIs.
import { AUTO_VOICE, DEFAULT_SETTINGS, GENDER } from "./contract.js";
import { clampSpeed } from "./speed.js";

const GENDERS = new Set(Object.values(GENDER));

// Kokoro voice ids look like "ef_dora" or "am_michael".
const VOICE_ID = /^[a-z0-9]+_[a-z0-9_]+$/i;

/**
 * Merges stored settings with the defaults and returns always-valid settings.
 * Unknown keys are dropped.
 * @param {unknown} raw Value read from chrome.storage (may be missing or corrupt).
 * @returns {{speed: number, voice: string, gender: string}}
 */
export function normalizeSettings(raw) {
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};

  const gender = GENDERS.has(input.gender) ? input.gender : DEFAULT_SETTINGS.gender;

  const voiceInput = typeof input.voice === "string" ? input.voice.trim() : "";
  const voice = voiceInput === AUTO_VOICE || VOICE_ID.test(voiceInput) ? voiceInput : DEFAULT_SETTINGS.voice;

  const speed = Math.round(clampSpeed(input.speed ?? DEFAULT_SETTINGS.speed) * 100) / 100;

  return { speed, voice, gender };
}
