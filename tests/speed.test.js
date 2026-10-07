import { test } from "node:test";
import assert from "node:assert/strict";
import { clampSpeed, generationSpeed, playbackRateFor } from "../src/lib/speed.js";
import { SPEED } from "../src/lib/contract.js";

test("clampSpeed keeps values inside the UI range", () => {
  assert.equal(clampSpeed(1.25), 1.25);
  assert.equal(clampSpeed(0.1), SPEED.MIN);
  assert.equal(clampSpeed(9), SPEED.MAX);
});

test("clampSpeed falls back to the default for non-numeric input", () => {
  for (const bad of [NaN, undefined, null, "fast", Infinity]) {
    assert.equal(clampSpeed(bad), SPEED.DEFAULT, String(bad));
  }
  assert.equal(clampSpeed("1.5"), 1.5);
});

test("generationSpeed never exceeds what the server can generate", () => {
  assert.equal(generationSpeed(1), 1);
  assert.equal(generationSpeed(2), 2);
  assert.equal(generationSpeed(2.5), SPEED.SERVER_MAX);
  assert.equal(generationSpeed(3), SPEED.SERVER_MAX);
  assert.equal(generationSpeed(0.5), SPEED.SERVER_MIN);
  assert.equal(generationSpeed(100), SPEED.SERVER_MAX);
});

test("playbackRateFor covers the gap between UI and generated speed", () => {
  assert.equal(playbackRateFor(1.5, 1.5), 1);
  assert.equal(playbackRateFor(3, 2), 1.5);
  assert.equal(playbackRateFor(1.5, 1), 1.5);
  assert.equal(playbackRateFor(0.75, 1.5), 0.5);
});

test("playbackRateFor tolerates a missing generated speed", () => {
  assert.equal(playbackRateFor(1.5, 0), 1.5);
  assert.equal(playbackRateFor(1.5, undefined), 1.5);
});
