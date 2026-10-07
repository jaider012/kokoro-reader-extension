// Pure helpers for the popup (no chrome APIs, no DOM) so they can be unit tested.
import { AUTO_VOICE, GENDER, STATUS } from "../lib/contract.js";

const AUTO_PREFIX = `${AUTO_VOICE}:`;

// Kokoro voice ids look like `<language><gender>_<name>`, e.g. `ef_dora`.
const LANGUAGES = [
  { prefix: "e", label: "Spanish" },
  { prefix: "a", label: "English (US)" },
  { prefix: "b", label: "English (UK)" },
];
const GENDERS = [
  { letter: "f", label: "female" },
  { letter: "m", label: "male" },
];
const OTHER_LABEL = "Other";

/** Formats a speed multiplier, e.g. 1.25 -> "1.25×". */
export function formatSpeed(speed) {
  return `${Number(Number(speed).toFixed(2))}×`;
}

function shortName(voice) {
  const label = typeof voice.label === "string" ? voice.label.split(" · ")[0].trim() : "";
  return label || voice.id;
}

/**
 * Groups server voices by language and gender for <optgroup> rendering.
 * @param {{id: string, label?: string}[]} voices
 * @returns {{label: string, voices: {id: string, name: string}[]}[]}
 */
export function buildVoiceGroups(voices) {
  if (!Array.isArray(voices)) return [];

  const buckets = new Map();
  const bucketFor = (key, label) => {
    if (!buckets.has(key)) buckets.set(key, { label, voices: [] });
    return buckets.get(key).voices;
  };

  for (const voice of voices) {
    if (!voice || typeof voice.id !== "string" || !voice.id) continue;
    const language = LANGUAGES.find((l) => l.prefix === voice.id[0]);
    const gender = GENDERS.find((g) => g.letter === voice.id[1]);
    const entry = { id: voice.id, name: shortName(voice) };
    if (language && gender) {
      bucketFor(`${language.prefix}${gender.letter}`, `${language.label} · ${gender.label}`).push(entry);
    } else {
      bucketFor("other", OTHER_LABEL).push(entry);
    }
  }

  const order = LANGUAGES.flatMap((l) => GENDERS.map((g) => `${l.prefix}${g.letter}`));
  order.push("other");
  return order.filter((key) => buckets.has(key)).map((key) => buckets.get(key));
}

/** Value of the voice <select> for the given settings. */
export function selectValueFromSettings(settings) {
  if (settings.voice === AUTO_VOICE) {
    return `${AUTO_PREFIX}${settings.gender === GENDER.MALE ? GENDER.MALE : GENDER.FEMALE}`;
  }
  return settings.voice;
}

/** Returns new settings reflecting the chosen voice <select> value. */
export function settingsFromSelectValue(value, settings) {
  if (value.startsWith(AUTO_PREFIX)) {
    const gender = value.slice(AUTO_PREFIX.length) === GENDER.MALE ? GENDER.MALE : GENDER.FEMALE;
    return { ...settings, voice: AUTO_VOICE, gender };
  }
  return { ...settings, voice: value };
}

const LABELS = {
  [STATUS.IDLE]: "Ready",
  [STATUS.LOADING]: "Loading audio…",
  [STATUS.PLAYING]: "Reading",
  [STATUS.PAUSED]: "Paused",
  [STATUS.ERROR]: "Error",
};

/**
 * Derives everything the popup needs to render a PlayerState.
 * @returns {{label: string, primaryAction: "read"|"pause"|"resume", canStop: boolean,
 *   progress: number, progressText: string, error: string|null}}
 */
export function describeState(state) {
  const status = state?.status ?? STATUS.IDLE;
  const total = Math.max(0, Number(state?.total) || 0);
  const index = Math.max(0, Number(state?.index) || 0);
  const active = status === STATUS.LOADING || status === STATUS.PLAYING || status === STATUS.PAUSED;

  const current = Math.min(index + 1, total);
  const hasProgress = active && total > 0;

  let primaryAction = "read";
  if (status === STATUS.PAUSED) primaryAction = "resume";
  else if (status === STATUS.LOADING || status === STATUS.PLAYING) primaryAction = "pause";

  return {
    label: LABELS[status] ?? LABELS[STATUS.IDLE],
    primaryAction,
    canStop: active,
    progress: hasProgress ? current / total : 0,
    progressText: hasProgress ? `${current} / ${total}` : "",
    error: status === STATUS.ERROR ? state.error || "Something went wrong." : null,
  };
}
