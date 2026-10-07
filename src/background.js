// Service worker: entry points (popup messages, context menu, shortcuts),
// text extraction, and lifecycle of the offscreen document that plays audio.
import { IDLE_STATE, MSG, SERVER_URL, SETTINGS_KEY, STATUS, TARGET } from "./lib/contract.js";
import { normalizeSettings } from "./lib/settings.js";
import { resolveVoice } from "./lib/voices.js";

const OFFSCREEN_URL = "src/offscreen/offscreen.html";
const SESSION_KEY = "session"; // chrome.storage.session: { text, voice, index, total, status }
const LANGUAGE_SAMPLE_LENGTH = 1000;

const MENU = Object.freeze({ READ: "kokoro-read-selection", STOP: "kokoro-stop" });
const COMMAND = Object.freeze({ READ_OR_STOP: "read-or-stop", TOGGLE_PAUSE: "toggle-pause" });

// Pages where extensions cannot inject scripts.
const RESTRICTED_URL = /^(chrome|chrome-extension|chrome-untrusted|edge|about|devtools|view-source):|^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/i;
const RESTRICTED_MESSAGE =
  "Kokoro Reader cannot read this page. Browser pages and the Chrome Web Store are off limits.";

// --- offscreen document ------------------------------------------------------

async function hasOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  return contexts.length > 0;
}

let creatingOffscreen = null;

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) return;
  creatingOffscreen ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_URL,
      reasons: ["AUDIO_PLAYBACK"],
      justification: "Play synthesized speech while the popup is closed.",
    })
    .finally(() => {
      creatingOffscreen = null;
    });
  await creatingOffscreen;
}

function sendToOffscreen(type, payload = {}) {
  return chrome.runtime.sendMessage({ target: TARGET.OFFSCREEN, type, ...payload });
}

// --- session persisted for resuming after Chrome closes the offscreen document

async function loadSession() {
  const stored = await chrome.storage.session.get(SESSION_KEY);
  return stored[SESSION_KEY] ?? null;
}

// Writes are serialized so overlapping state updates cannot clobber each other.
let sessionWrites = Promise.resolve();

function updateSession(update) {
  sessionWrites = sessionWrites
    .then(async () => {
      const next = update(await loadSession());
      if (next) await chrome.storage.session.set({ [SESSION_KEY]: next });
      else await chrome.storage.session.remove(SESSION_KEY);
    })
    .catch(() => {});
  return sessionWrites;
}

/** Mirrors the player state into the stored session (the background receives every broadcast). */
function recordPlayerState(state) {
  if (!state) return Promise.resolve();
  return updateSession((session) => {
    if (!session) return null;
    if (state.status === STATUS.IDLE || state.status === STATUS.ERROR) return null;
    return { ...session, status: state.status, index: state.index, total: state.total };
  });
}

// --- helpers -----------------------------------------------------------------

async function loadSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(stored[SETTINGS_KEY]);
}

function detectLanguage(text) {
  return new Promise((resolve) => {
    try {
      chrome.i18n.detectLanguage(text.slice(0, LANGUAGE_SAMPLE_LENGTH), (result) => {
        resolve(result?.languages?.[0]?.language);
      });
    } catch {
      resolve(undefined);
    }
  });
}

function broadcastState(state) {
  // The popup may be closed: "no receiver" is expected.
  chrome.runtime.sendMessage({ target: TARGET.UI, type: MSG.PLAYER_STATE, state }).catch(() => {});
}

function broadcastError(message) {
  broadcastState({ ...IDLE_STATE, status: STATUS.ERROR, error: message });
}

/** Runs a background task, surfacing any failure to the UI. */
function run(task) {
  return task().catch((err) => broadcastError(err?.message ?? String(err)));
}

/** Runs in the page (must be self-contained): the selection, else the main content. */
function extractPageText() {
  const selection = window.getSelection()?.toString().trim();
  if (selection) return selection;
  const root =
    document.querySelector("article") ||
    document.querySelector("main, [role=main]") ||
    document.body;
  return (root?.innerText ?? "").trim();
}

// --- actions -----------------------------------------------------------------

async function startReading(text) {
  if (typeof text !== "string" || !text.trim()) {
    broadcastError("There is no text to read.");
    return;
  }

  const settings = await loadSettings();
  const voice = resolveVoice(settings, await detectLanguage(text));

  await ensureOffscreenDocument();
  await updateSession(() => ({ text, voice, index: 0, total: 0, status: STATUS.LOADING }));
  await sendToOffscreen(MSG.PLAYER_PLAY, {
    text,
    voice,
    speed: settings.speed,
    serverUrl: SERVER_URL,
    startIndex: 0,
  });
}

async function readActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) {
    broadcastError("There is no active tab to read.");
    return;
  }
  if (tab.url && RESTRICTED_URL.test(tab.url)) {
    broadcastError(RESTRICTED_MESSAGE);
    return;
  }

  let text;
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPageText,
    });
    text = injection?.result;
  } catch {
    broadcastError(RESTRICTED_MESSAGE);
    return;
  }

  if (typeof text !== "string" || !text.trim()) {
    broadcastError("No readable text found on this page.");
    return;
  }
  await startReading(text);
}

async function getPlayerState() {
  if (await hasOffscreenDocument()) {
    const state = await sendToOffscreen(MSG.PLAYER_GET_STATE).catch(() => null);
    if (state?.status) return state;
  }
  // No live player: only a paused session is still meaningful (it can be resumed).
  const session = await loadSession();
  if (session?.status === STATUS.PAUSED) {
    return { status: STATUS.PAUSED, index: session.index, total: session.total ?? 0, error: null };
  }
  return { ...IDLE_STATE };
}

async function togglePause() {
  if (await hasOffscreenDocument()) {
    const { status } = await getPlayerState();
    if (status === STATUS.PLAYING || status === STATUS.LOADING) {
      await sendToOffscreen(MSG.PLAYER_PAUSE);
      return;
    }
    if (status === STATUS.PAUSED) {
      await sendToOffscreen(MSG.PLAYER_RESUME);
      return;
    }
  }

  // Chrome closes the offscreen document after ~30 s without audio, which
  // drops a paused player. Rebuild it and continue from the stored chunk.
  const session = await loadSession();
  if (session?.status === STATUS.PAUSED && session.text) {
    const settings = await loadSettings();
    await ensureOffscreenDocument();
    await updateSession((current) => current && { ...current, status: STATUS.LOADING });
    await sendToOffscreen(MSG.PLAYER_PLAY, {
      text: session.text,
      voice: session.voice,
      speed: settings.speed,
      serverUrl: SERVER_URL,
      startIndex: session.index,
    });
  }
}

async function stopReading() {
  await updateSession(() => null);
  if (await hasOffscreenDocument()) {
    await sendToOffscreen(MSG.PLAYER_STOP);
  } else {
    broadcastState({ ...IDLE_STATE });
  }
}

async function readOrStop() {
  const { status } = await getPlayerState();
  const reading = status === STATUS.LOADING || status === STATUS.PLAYING || status === STATUS.PAUSED;
  await (reading ? stopReading() : readActiveTab());
}

async function handleMessage(message) {
  switch (message.type) {
    case MSG.READ_TAB:
      await readActiveTab();
      return { ok: true };
    case MSG.READ_TEXT:
      await startReading(message.text);
      return { ok: true };
    case MSG.TOGGLE_PAUSE:
      await togglePause();
      return { ok: true };
    case MSG.STOP:
      await stopReading();
      return { ok: true };
    case MSG.GET_STATE:
      return getPlayerState();
    default:
      return { ok: false, error: `Unknown message type: ${message.type}` };
  }
}

// --- listeners (registered synchronously so the worker can wake for them) -----

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === MSG.PLAYER_STATE && message.target === TARGET.UI) {
    recordPlayerState(message.state);
    return false;
  }
  if (message?.target !== TARGET.BACKGROUND) return false;

  handleMessage(message).then(sendResponse, (err) => {
    broadcastError(err?.message ?? String(err));
    sendResponse({ ok: false, error: err?.message ?? String(err) });
  });
  return true; // the response is sent asynchronously
});

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: MENU.READ, title: "Read aloud", contexts: ["selection"] });
  chrome.contextMenus.create({ id: MENU.STOP, title: "Stop reading", contexts: ["all"] });
});

chrome.contextMenus.onClicked.addListener((info) => {
  run(() => (info.menuItemId === MENU.READ ? startReading(info.selectionText) : stopReading()));
});

chrome.commands.onCommand.addListener((command) => {
  if (command === COMMAND.READ_OR_STOP) run(readOrStop);
  else if (command === COMMAND.TOGGLE_PAUSE) run(togglePause);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[SETTINGS_KEY]) return;
  const before = normalizeSettings(changes[SETTINGS_KEY].oldValue).speed;
  const { speed } = normalizeSettings(changes[SETTINGS_KEY].newValue);
  if (speed === before) return;
  run(async () => {
    if (await hasOffscreenDocument()) await sendToOffscreen(MSG.PLAYER_SET_SPEED, { speed });
  });
});
