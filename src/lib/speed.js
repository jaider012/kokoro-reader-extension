// Speed helpers. The UI range (SPEED.MIN..MAX) is wider than what the server
// generates (SERVER_MIN..SERVER_MAX); the difference is covered with
// HTMLMediaElement.playbackRate.
import { SPEED } from "./contract.js";

function toNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return NaN;
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** Clamps a UI speed to SPEED.MIN..MAX; non-numeric input gives SPEED.DEFAULT. */
export function clampSpeed(speed) {
  const value = toNumber(speed);
  return Number.isFinite(value) ? clamp(value, SPEED.MIN, SPEED.MAX) : SPEED.DEFAULT;
}

/** Speed to request from the server for a given UI speed. */
export function generationSpeed(speed) {
  return clamp(clampSpeed(speed), SPEED.SERVER_MIN, SPEED.SERVER_MAX);
}

/** playbackRate that turns audio generated at `generatedSpeed` into `speed`. */
export function playbackRateFor(speed, generatedSpeed) {
  const generated = Number.isFinite(generatedSpeed) && generatedSpeed > 0 ? generatedSpeed : 1;
  return clampSpeed(speed) / generated;
}
