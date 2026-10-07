import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSettings } from "../src/lib/settings.js";
import { AUTO_VOICE, DEFAULT_SETTINGS, GENDER, SPEED } from "../src/lib/contract.js";

test("missing or malformed input yields the defaults", () => {
  for (const raw of [undefined, null, "x", 5, [], {}]) {
    assert.deepEqual(normalizeSettings(raw), DEFAULT_SETTINGS, JSON.stringify(raw));
  }
});

test("valid settings are kept", () => {
  const raw = { speed: 1.75, voice: "am_michael", gender: GENDER.MALE };
  assert.deepEqual(normalizeSettings(raw), raw);
});

test("partial settings are merged with the defaults", () => {
  assert.deepEqual(normalizeSettings({ speed: 2 }), { ...DEFAULT_SETTINGS, speed: 2 });
});

test("speed is clamped and rounded", () => {
  assert.equal(normalizeSettings({ speed: 10 }).speed, SPEED.MAX);
  assert.equal(normalizeSettings({ speed: 0 }).speed, SPEED.MIN);
  assert.equal(normalizeSettings({ speed: "abc" }).speed, SPEED.DEFAULT);
  assert.equal(normalizeSettings({ speed: 0.1 + 0.2 + 1 }).speed, 1.3);
});

test("unknown genders fall back to the default", () => {
  assert.equal(normalizeSettings({ gender: "robot" }).gender, DEFAULT_SETTINGS.gender);
  assert.equal(normalizeSettings({ gender: GENDER.MALE }).gender, GENDER.MALE);
});

test("voice must be auto or a plausible voice id", () => {
  assert.equal(normalizeSettings({ voice: AUTO_VOICE }).voice, AUTO_VOICE);
  assert.equal(normalizeSettings({ voice: " ef_dora " }).voice, "ef_dora");
  for (const bad of ["", "   ", "not a voice", "../etc", 7, null]) {
    assert.equal(normalizeSettings({ voice: bad }).voice, AUTO_VOICE, String(bad));
  }
});

test("unknown keys are dropped", () => {
  assert.deepEqual(normalizeSettings({ speed: 1, evil: true }), { ...DEFAULT_SETTINGS });
});
