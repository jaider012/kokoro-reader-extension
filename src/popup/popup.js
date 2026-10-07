import {
  AUTO_VOICE,
  DEFAULT_SETTINGS,
  IDLE_STATE,
  MSG,
  SERVER_URL,
  SETTINGS_KEY,
  SPEED,
  TARGET,
} from "../lib/contract.js";
import {
  buildVoiceGroups,
  describeState,
  formatSpeed,
  selectValueFromSettings,
  settingsFromSelectValue,
} from "./view.js";

const SPEED_PRESETS = [0.75, 1, 1.25, 1.5, 2];
const SERVER_TIMEOUT_MS = 2000;
const SAVE_DEBOUNCE_MS = 120;
const PRIMARY_LABELS = { read: "Read", pause: "Pause", resume: "Resume" };
const PRIMARY_MESSAGES = { read: MSG.READ_TAB, pause: MSG.TOGGLE_PAUSE, resume: MSG.TOGGLE_PAUSE };

const $ = (id) => document.getElementById(id);
const els = {
  server: $("server"),
  serverText: $("server-text"),
  serverHint: $("server-hint"),
  primary: $("primary"),
  primaryLabel: $("primary-label"),
  stop: $("stop"),
  status: $("status"),
  progress: $("progress"),
  progressText: $("progress-text"),
  error: $("error"),
  speed: $("speed"),
  speedValue: $("speed-value"),
  chips: $("chips"),
  voice: $("voice"),
  pasteText: $("paste-text"),
  readText: $("read-text"),
};

let settings = { ...DEFAULT_SETTINGS };
let primaryAction = "read";
let saveTimer;

function send(message) {
  return chrome.runtime.sendMessage({ target: TARGET.BACKGROUND, ...message }).catch(() => undefined);
}

// ---- Settings ---------------------------------------------------------------

async function loadSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  settings = { ...DEFAULT_SETTINGS, ...stored[SETTINGS_KEY] };
}

function saveSettings() {
  return chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

function saveSettingsDebounced() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSettings, SAVE_DEBOUNCE_MS);
}

// ---- Speed ------------------------------------------------------------------

function renderSpeed() {
  els.speed.value = String(settings.speed);
  els.speedValue.textContent = formatSpeed(settings.speed);
  for (const chip of els.chips.children) {
    chip.setAttribute("aria-pressed", String(Math.abs(Number(chip.dataset.speed) - settings.speed) < 0.001));
  }
}

function setSpeed(value) {
  const speed = Math.min(SPEED.MAX, Math.max(SPEED.MIN, Number(value)));
  if (!Number.isFinite(speed)) return;
  settings = { ...settings, speed: Number(speed.toFixed(2)) };
  renderSpeed();
  saveSettingsDebounced();
}

function initSpeed() {
  els.speed.min = String(SPEED.MIN);
  els.speed.max = String(SPEED.MAX);
  els.speed.step = String(SPEED.STEP);
  for (const preset of SPEED_PRESETS) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.dataset.speed = String(preset);
    chip.textContent = formatSpeed(preset);
    chip.addEventListener("click", () => setSpeed(preset));
    els.chips.append(chip);
  }
  els.speed.addEventListener("input", () => setSpeed(els.speed.value));
  renderSpeed();
}

// ---- Voice ------------------------------------------------------------------

function option(value, text) {
  const el = document.createElement("option");
  el.value = value;
  el.textContent = text;
  return el;
}

function renderVoices(voices) {
  els.voice.replaceChildren(option("auto:female", "Auto · female"), option("auto:male", "Auto · male"));
  for (const group of buildVoiceGroups(voices)) {
    const optgroup = document.createElement("optgroup");
    optgroup.label = group.label;
    optgroup.append(...group.voices.map((v) => option(v.id, v.name)));
    els.voice.append(optgroup);
  }
  const value = selectValueFromSettings(settings);
  // Keep a stored voice selectable even when the server list is empty or lacks it.
  if (settings.voice !== AUTO_VOICE && ![...els.voice.options].some((o) => o.value === value)) {
    els.voice.append(option(value, value));
  }
  els.voice.value = value;
}

function initVoice() {
  renderVoices([]);
  els.voice.addEventListener("change", () => {
    settings = settingsFromSelectValue(els.voice.value, settings);
    saveSettings();
  });
}

// ---- Server -----------------------------------------------------------------

function renderServer(online) {
  els.server.dataset.state = online ? "online" : "offline";
  els.serverText.textContent = online ? "Server online" : "Server offline";
  els.serverHint.hidden = online;
}

async function checkServer() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SERVER_TIMEOUT_MS);
  try {
    const response = await fetch(`${SERVER_URL}/voces`, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    renderServer(true);
    renderVoices(data.voces);
  } catch {
    renderServer(false);
  } finally {
    clearTimeout(timer);
  }
}

// ---- Player -----------------------------------------------------------------

function renderState(state) {
  const view = describeState(state);
  primaryAction = view.primaryAction;
  els.primary.dataset.action = view.primaryAction;
  els.primaryLabel.textContent = PRIMARY_LABELS[view.primaryAction];
  els.stop.disabled = !view.canStop;
  els.status.textContent = view.label;
  els.progress.value = view.progress;
  els.progressText.textContent = view.progressText;
  els.error.hidden = !view.error;
  els.error.textContent = view.error ?? "";
}

function initPlayer() {
  renderState(IDLE_STATE);
  els.primary.addEventListener("click", () => send({ type: PRIMARY_MESSAGES[primaryAction] }));
  els.stop.addEventListener("click", () => send({ type: MSG.STOP }));
  els.readText.addEventListener("click", () => {
    const text = els.pasteText.value.trim();
    if (text) send({ type: MSG.READ_TEXT, text });
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.target === TARGET.UI && message.type === MSG.PLAYER_STATE) renderState(message.state);
  });
  send({ type: MSG.GET_STATE }).then((state) => {
    if (state) renderState(state);
  });
}

// ---- Boot -------------------------------------------------------------------

async function init() {
  await loadSettings();
  initSpeed();
  initVoice();
  initPlayer();
  checkServer();
}

init();
