// Voice selection. Pure functions, no chrome APIs.
import { AUTO_VOICE, GENDER } from "./contract.js";

// Default Kokoro voice per detected language and gender.
const AUTO_VOICES = Object.freeze({
  es: Object.freeze({ [GENDER.FEMALE]: "ef_dora", [GENDER.MALE]: "em_alex" }),
  en: Object.freeze({ [GENDER.FEMALE]: "af_heart", [GENDER.MALE]: "am_michael" }),
});

const FALLBACK_LANGUAGE = "es";

/** "en-US", "EN_gb", "es-419" -> "en" / "es"; anything else -> null. */
function primaryLanguage(lang) {
  if (typeof lang !== "string") return null;
  const primary = lang.toLowerCase().split(/[-_]/)[0];
  return primary in AUTO_VOICES ? primary : null;
}

/**
 * Resolves the Kokoro voice id to synthesize with.
 * @param {{voice?: string, gender?: string}} settings
 * @param {string|null|undefined} lang Detected page language (BCP 47 tag).
 * @returns {string}
 */
export function resolveVoice(settings, lang) {
  const { voice = AUTO_VOICE, gender = GENDER.FEMALE } = settings ?? {};
  if (voice && voice !== AUTO_VOICE) return voice;

  const voices = AUTO_VOICES[primaryLanguage(lang) ?? FALLBACK_LANGUAGE];
  return voices[gender === GENDER.MALE ? GENDER.MALE : GENDER.FEMALE];
}
