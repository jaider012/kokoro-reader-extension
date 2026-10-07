// Shared contract between the background service worker, the offscreen audio
// player and the popup. Every runtime message has the shape
// `{ target, type, ...payload }`; receivers ignore messages for other targets.

export const TARGET = Object.freeze({
  BACKGROUND: "background",
  OFFSCREEN: "offscreen",
  UI: "ui",
});

export const MSG = Object.freeze({
  // UI -> background
  READ_TAB: "reader:read-tab", // selection of the active tab, or its main content if nothing is selected
  READ_TEXT: "reader:read-text", // { text }
  TOGGLE_PAUSE: "reader:toggle-pause",
  STOP: "reader:stop",
  GET_STATE: "reader:get-state", // response: PlayerState

  // background -> offscreen
  PLAYER_PLAY: "player:play", // { text, voice, speed, serverUrl, startIndex }
  PLAYER_PAUSE: "player:pause",
  PLAYER_RESUME: "player:resume",
  PLAYER_STOP: "player:stop",
  PLAYER_SET_SPEED: "player:set-speed", // { speed }
  PLAYER_GET_STATE: "player:get-state", // response: PlayerState

  // offscreen -> broadcast (target UI; the background listens too)
  PLAYER_STATE: "player:state", // { state: PlayerState }
});

export const STATUS = Object.freeze({
  IDLE: "idle",
  LOADING: "loading",
  PLAYING: "playing",
  PAUSED: "paused",
  ERROR: "error",
});

/**
 * @typedef {object} PlayerState
 * @property {string} status One of STATUS.
 * @property {number} index Zero-based index of the current chunk.
 * @property {number} total Number of chunks in the current reading.
 * @property {string|null} error Human-readable error when status is ERROR.
 */
export const IDLE_STATE = Object.freeze({
  status: STATUS.IDLE,
  index: 0,
  total: 0,
  error: null,
});

// UI speed range. The server only generates 0.5-2.0; anything beyond that is
// reached with HTMLMediaElement.playbackRate (pitch preserved).
export const SPEED = Object.freeze({
  MIN: 0.5,
  MAX: 3,
  STEP: 0.05,
  DEFAULT: 1,
  SERVER_MIN: 0.5,
  SERVER_MAX: 2,
});

export const GENDER = Object.freeze({ FEMALE: "female", MALE: "male" });

// `voice` setting value meaning "pick a voice from the detected language and gender".
export const AUTO_VOICE = "auto";

// Local Kokoro server (kokoro-tts-servidor/kokoro_server.py):
//   GET  /estado -> { ok: true, voces: [{ id, label }] }
//   GET  /voces  -> { voces: [{ id, label }] }
//   POST /leer   -> audio; JSON body { texto, voz, velocidad, formato: "wav" }
export const SERVER_URL = "http://127.0.0.1:8880";

export const SETTINGS_KEY = "settings"; // chrome.storage.local
export const DEFAULT_SETTINGS = Object.freeze({
  speed: SPEED.DEFAULT,
  voice: AUTO_VOICE,
  gender: GENDER.FEMALE,
});
