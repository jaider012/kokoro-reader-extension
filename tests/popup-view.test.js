import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatSpeed,
  buildVoiceGroups,
  selectValueFromSettings,
  settingsFromSelectValue,
  describeState,
} from "../src/popup/view.js";
import { AUTO_VOICE, DEFAULT_SETTINGS, GENDER, IDLE_STATE, STATUS } from "../src/lib/contract.js";

test("formatSpeed renders a trimmed multiplier", () => {
  assert.equal(formatSpeed(1), "1×");
  assert.equal(formatSpeed(1.25), "1.25×");
  assert.equal(formatSpeed(1.5), "1.5×");
  assert.equal(formatSpeed(0.75), "0.75×");
  assert.equal(formatSpeed(3), "3×");
});

test("formatSpeed absorbs float noise from slider steps", () => {
  assert.equal(formatSpeed(0.1 + 0.2 + 0.95), "1.25×");
  assert.equal(formatSpeed(1.2000000000000002), "1.2×");
});

test("buildVoiceGroups returns no groups for an empty or invalid list", () => {
  assert.deepEqual(buildVoiceGroups([]), []);
  assert.deepEqual(buildVoiceGroups(undefined), []);
  assert.deepEqual(buildVoiceGroups(null), []);
});

test("buildVoiceGroups groups by language and gender with short names", () => {
  const groups = buildVoiceGroups([
    { id: "bm_george", label: "George · British male" },
    { id: "af_heart", label: "Heart · American female" },
    { id: "ef_dora", label: "Dora · Spanish female" },
    { id: "em_alex", label: "Alex · Spanish male" },
    { id: "ef_ana", label: "Ana" },
  ]);
  assert.deepEqual(
    groups.map((g) => g.label),
    ["Spanish · female", "Spanish · male", "English (US) · female", "English (UK) · male"],
  );
  assert.deepEqual(groups[0].voices, [
    { id: "ef_dora", name: "Dora" },
    { id: "ef_ana", name: "Ana" },
  ]);
  assert.deepEqual(groups[3].voices, [{ id: "bm_george", name: "George" }]);
});

test("buildVoiceGroups puts unknown prefixes in an Other group last", () => {
  const groups = buildVoiceGroups([
    { id: "zz_x", label: "X · whatever" },
    { id: "ef_dora", label: "Dora · Spanish female" },
  ]);
  assert.deepEqual(groups.map((g) => g.label), ["Spanish · female", "Other"]);
  assert.deepEqual(groups[1].voices, [{ id: "zz_x", name: "X" }]);
});

test("buildVoiceGroups ignores malformed entries and falls back to id for the name", () => {
  const groups = buildVoiceGroups([null, {}, { id: "af_sky" }]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].voices, [{ id: "af_sky", name: "af_sky" }]);
});

test("selectValueFromSettings maps auto voice to auto:<gender>", () => {
  assert.equal(selectValueFromSettings({ voice: AUTO_VOICE, gender: GENDER.FEMALE }), "auto:female");
  assert.equal(selectValueFromSettings({ voice: AUTO_VOICE, gender: GENDER.MALE }), "auto:male");
  assert.equal(selectValueFromSettings(DEFAULT_SETTINGS), "auto:female");
});

test("selectValueFromSettings returns a concrete voice id as is", () => {
  assert.equal(selectValueFromSettings({ voice: "ef_dora", gender: GENDER.MALE }), "ef_dora");
});

test("settingsFromSelectValue stores auto voice with gender", () => {
  const next = settingsFromSelectValue("auto:male", { ...DEFAULT_SETTINGS, speed: 1.5 });
  assert.deepEqual(next, { speed: 1.5, voice: AUTO_VOICE, gender: GENDER.MALE });
});

test("settingsFromSelectValue stores a concrete voice and keeps gender", () => {
  const base = { speed: 1, voice: AUTO_VOICE, gender: GENDER.MALE };
  const next = settingsFromSelectValue("ef_dora", base);
  assert.deepEqual(next, { speed: 1, voice: "ef_dora", gender: GENDER.MALE });
  assert.notEqual(next, base);
});

test("describeState for idle offers Read and no stop", () => {
  const d = describeState(IDLE_STATE);
  assert.equal(d.primaryAction, "read");
  assert.equal(d.canStop, false);
  assert.equal(d.progress, 0);
  assert.equal(d.progressText, "");
  assert.equal(d.error, null);
  assert.equal(d.label, "Ready");
});

test("describeState treats missing state as idle", () => {
  assert.equal(describeState(undefined).primaryAction, "read");
  assert.equal(describeState(null).label, "Ready");
});

test("describeState for playing offers Pause, stop and progress", () => {
  const d = describeState({ status: STATUS.PLAYING, index: 2, total: 12, error: null });
  assert.equal(d.primaryAction, "pause");
  assert.equal(d.canStop, true);
  assert.equal(d.progressText, "3 / 12");
  assert.equal(d.progress, 3 / 12);
  assert.equal(d.label, "Reading");
});

test("describeState for paused offers Resume", () => {
  const d = describeState({ status: STATUS.PAUSED, index: 0, total: 4, error: null });
  assert.equal(d.primaryAction, "resume");
  assert.equal(d.canStop, true);
  assert.equal(d.label, "Paused");
  assert.equal(d.progressText, "1 / 4");
});

test("describeState for loading lets the user pause or stop", () => {
  const d = describeState({ status: STATUS.LOADING, index: 0, total: 0, error: null });
  assert.equal(d.primaryAction, "pause");
  assert.equal(d.canStop, true);
  assert.equal(d.label, "Loading audio…");
  assert.equal(d.progressText, "");
  assert.equal(d.progress, 0);
});

test("describeState for error offers Read and surfaces the message", () => {
  const d = describeState({ status: STATUS.ERROR, index: 0, total: 0, error: "Server unreachable" });
  assert.equal(d.primaryAction, "read");
  assert.equal(d.canStop, false);
  assert.equal(d.error, "Server unreachable");
  assert.equal(d.label, "Error");
});

test("describeState clamps progress into 0..1", () => {
  const d = describeState({ status: STATUS.PLAYING, index: 20, total: 12, error: null });
  assert.equal(d.progress, 1);
  assert.equal(d.progressText, "12 / 12");
});

test("describeState gives a fallback message for an error without text", () => {
  const d = describeState({ status: STATUS.ERROR, index: 0, total: 0, error: null });
  assert.equal(d.error, "Something went wrong.");
});
