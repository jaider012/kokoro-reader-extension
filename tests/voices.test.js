import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveVoice } from "../src/lib/voices.js";
import { AUTO_VOICE, GENDER } from "../src/lib/contract.js";

const auto = (gender) => ({ voice: AUTO_VOICE, gender });

test("an explicit voice id passes through untouched", () => {
  assert.equal(resolveVoice({ voice: "af_sky", gender: GENDER.MALE }, "es"), "af_sky");
});

test("auto picks the Spanish voice by gender", () => {
  assert.equal(resolveVoice(auto(GENDER.FEMALE), "es"), "ef_dora");
  assert.equal(resolveVoice(auto(GENDER.MALE), "es"), "em_alex");
});

test("auto picks the English voice by gender", () => {
  assert.equal(resolveVoice(auto(GENDER.FEMALE), "en"), "af_heart");
  assert.equal(resolveVoice(auto(GENDER.MALE), "en"), "am_michael");
});

test("language tags are matched on their primary subtag, case-insensitively", () => {
  assert.equal(resolveVoice(auto(GENDER.FEMALE), "en-US"), "af_heart");
  assert.equal(resolveVoice(auto(GENDER.MALE), "EN_gb"), "am_michael");
  assert.equal(resolveVoice(auto(GENDER.MALE), "es-419"), "em_alex");
});

test("unknown or missing languages fall back to Spanish", () => {
  assert.equal(resolveVoice(auto(GENDER.FEMALE), null), "ef_dora");
  assert.equal(resolveVoice(auto(GENDER.FEMALE), undefined), "ef_dora");
  assert.equal(resolveVoice(auto(GENDER.MALE), "xx"), "em_alex");
  assert.equal(resolveVoice(auto(GENDER.MALE), 42), "em_alex");
});

test("a missing voice behaves like auto and a missing gender like female", () => {
  assert.equal(resolveVoice({ gender: GENDER.MALE }, "en"), "am_michael");
  assert.equal(resolveVoice({ voice: AUTO_VOICE }, "en"), "af_heart");
  assert.equal(resolveVoice({}, "es"), "ef_dora");
  assert.equal(resolveVoice(undefined, "es"), "ef_dora");
});
