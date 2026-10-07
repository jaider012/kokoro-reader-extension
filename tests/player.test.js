import { test } from "node:test";
import assert from "node:assert/strict";
import { Player } from "../src/lib/player.js";
import { IDLE_STATE, STATUS } from "../src/lib/contract.js";

// Five paragraphs -> five one-sentence chunks.
const TEXT = "One.\nTwo.\nThree.\nFour.\nFive.";
const OPTS = { voice: "ef_dora", speed: 1, serverUrl: "http://127.0.0.1:8880" };

const tick = () => new Promise((resolve) => setImmediate(resolve));

class FakeAudio {
  constructor(url) {
    this.url = url;
    this.playbackRate = 1;
    this.preservesPitch = false;
    this.paused = true;
    this.playCalls = 0;
    this.pauseCalls = 0;
    this.onended = null;
    this.onerror = null;
  }
  play() {
    this.paused = false;
    this.playCalls++;
    return this.playResult ?? Promise.resolve();
  }
  pause() {
    this.paused = true;
    this.pauseCalls++;
  }
  finish() {
    this.onended?.();
  }
}

/** Player wired to controllable fakes. Fetches stay pending until `serve`d. */
function setup(overrides = {}) {
  const fetches = []; // { text, voice, speed, serverUrl, signal, resolve, reject }
  const audios = [];
  const states = [];
  const revoked = [];
  let urlCount = 0;

  const player = new Player({
    synthesize: (args) =>
      new Promise((resolve, reject) => {
        fetches.push({ ...args, resolve, reject });
        args.signal?.addEventListener("abort", () => reject(args.signal.reason));
      }),
    createAudio: (url) => {
      const audio = new FakeAudio(url);
      audios.push(audio);
      return audio;
    },
    onState: (state) => states.push(state),
    createObjectURL: () => `blob:fake/${urlCount++}`,
    revokeObjectURL: (url) => revoked.push(url),
    ...overrides,
  });

  const serve = (index) => fetches[index].resolve(new Blob([fetches[index].text]));
  const last = () => states.at(-1);
  return { player, fetches, audios, states, revoked, serve, last };
}

/** Plays TEXT and gets chunk 0 audible. */
async function startPlaying(ctx, opts = OPTS) {
  ctx.player.play(TEXT, opts);
  ctx.serve(0);
  await tick();
}

test("play requests the first chunk and reports LOADING", () => {
  const ctx = setup();
  ctx.player.play(TEXT, OPTS);

  assert.equal(ctx.fetches.length, 1);
  assert.equal(ctx.fetches[0].text, "One.");
  assert.equal(ctx.fetches[0].voice, "ef_dora");
  assert.equal(ctx.fetches[0].speed, 1);
  assert.equal(ctx.fetches[0].serverUrl, OPTS.serverUrl);
  assert.deepEqual(ctx.last(), { status: STATUS.LOADING, index: 0, total: 5, error: null });
});

test("playback starts when the first chunk arrives and the next two are prefetched", async () => {
  const ctx = setup();
  await startPlaying(ctx);

  assert.equal(ctx.audios.length, 1);
  assert.equal(ctx.audios[0].playCalls, 1);
  assert.equal(ctx.audios[0].preservesPitch, true);
  assert.deepEqual(ctx.last(), { status: STATUS.PLAYING, index: 0, total: 5, error: null });
  assert.deepEqual(
    ctx.fetches.map((f) => f.text),
    ["One.", "Two.", "Three."],
  );
});

test("a finished chunk advances to the next and keeps the prefetch window full", async () => {
  const ctx = setup();
  await startPlaying(ctx);
  ctx.serve(1);
  ctx.serve(2);
  await tick();

  ctx.audios[0].finish();
  await tick();

  assert.equal(ctx.audios.length, 2);
  assert.equal(ctx.audios[1].playCalls, 1);
  assert.equal(ctx.last().index, 1);
  assert.equal(ctx.last().status, STATUS.PLAYING);
  assert.deepEqual(
    ctx.fetches.map((f) => f.text),
    ["One.", "Two.", "Three.", "Four."],
  );
  assert.deepEqual(ctx.revoked, ["blob:fake/0"], "the finished chunk's object URL is released");
});

test("reports LOADING when the next chunk is not ready yet, then resumes", async () => {
  const ctx = setup();
  await startPlaying(ctx);

  ctx.audios[0].finish();
  await tick();
  assert.deepEqual(ctx.last(), { status: STATUS.LOADING, index: 1, total: 5, error: null });

  ctx.serve(1);
  await tick();
  assert.equal(ctx.last().status, STATUS.PLAYING);
  assert.equal(ctx.last().index, 1);
});

test("the last chunk ending returns to idle and releases everything", async () => {
  const ctx = setup();
  ctx.player.play("Only one.", OPTS);
  ctx.serve(0);
  await tick();

  ctx.audios[0].finish();
  await tick();

  assert.deepEqual(ctx.last(), IDLE_STATE);
  assert.deepEqual(ctx.revoked, ["blob:fake/0"]);
});

test("startIndex begins reading from that chunk", async () => {
  const ctx = setup();
  ctx.player.play(TEXT, { ...OPTS, startIndex: 2 });

  assert.equal(ctx.fetches[0].text, "Three.");
  assert.deepEqual(ctx.last(), { status: STATUS.LOADING, index: 2, total: 5, error: null });
  ctx.serve(0);
  await tick();
  assert.equal(ctx.last().index, 2);
  assert.deepEqual(
    ctx.fetches.map((f) => f.text),
    ["Three.", "Four.", "Five."],
  );
});

test("startIndex is clamped to the available chunks", () => {
  const ctx = setup();
  ctx.player.play(TEXT, { ...OPTS, startIndex: 99 });
  assert.equal(ctx.fetches[0].text, "Five.");
  assert.equal(ctx.last().index, 4);
});

test("speeds above the server limit are generated at the limit and finished with playbackRate", async () => {
  const ctx = setup();
  await startPlaying(ctx, { ...OPTS, speed: 3 });

  assert.equal(ctx.fetches[0].speed, 2);
  assert.equal(ctx.audios[0].playbackRate, 1.5);
  assert.equal(ctx.audios[0].preservesPitch, true);
});

test("speeds inside the server range need no playbackRate", async () => {
  const ctx = setup();
  await startPlaying(ctx, { ...OPTS, speed: 1.25 });

  assert.equal(ctx.fetches[0].speed, 1.25);
  assert.equal(ctx.audios[0].playbackRate, 1);
});

test("setSpeed retunes the current chunk, prefetched chunks and new fetches", async () => {
  const ctx = setup();
  await startPlaying(ctx); // generated at speed 1
  ctx.serve(1);
  ctx.serve(2);
  await tick();

  ctx.player.setSpeed(1.5);
  assert.equal(ctx.audios[0].playbackRate, 1.5, "current chunk changes instantly");

  ctx.audios[0].finish(); // chunk 1 was prefetched at speed 1
  await tick();
  assert.equal(ctx.audios[1].playbackRate, 1.5, "prefetched chunk uses the new speed");

  const fresh = ctx.fetches.at(-1);
  assert.equal(fresh.text, "Four.");
  assert.equal(fresh.speed, 1.5, "new fetches are generated at the new speed");
});

test("setSpeed clamps to the UI range", async () => {
  const ctx = setup();
  await startPlaying(ctx);
  ctx.player.setSpeed(50);
  assert.equal(ctx.audios[0].playbackRate, 3);
});

test("a chunk generated at the new speed plays at rate 1", async () => {
  const ctx = setup();
  await startPlaying(ctx);
  ctx.serve(1);
  ctx.serve(2);
  await tick();

  ctx.player.setSpeed(1.5);
  ctx.audios[0].finish(); // chunk 1 plays; chunk 3 is requested at 1.5
  await tick();
  ctx.serve(3);
  ctx.audios[1].finish(); // chunk 2 plays
  await tick();
  ctx.audios[2].finish(); // chunk 3 plays
  await tick();

  assert.equal(ctx.fetches[3].speed, 1.5);
  assert.equal(ctx.audios[3].playbackRate, 1);
});

test("pause and resume toggle the current audio", async () => {
  const ctx = setup();
  await startPlaying(ctx);

  ctx.player.pause();
  assert.equal(ctx.audios[0].pauseCalls, 1);
  assert.deepEqual(ctx.last(), { status: STATUS.PAUSED, index: 0, total: 5, error: null });

  ctx.player.resume();
  assert.equal(ctx.audios[0].playCalls, 2);
  assert.equal(ctx.last().status, STATUS.PLAYING);
});

test("pausing while a chunk is loading holds playback until resumed", async () => {
  const ctx = setup();
  ctx.player.play(TEXT, OPTS);
  ctx.player.pause();
  assert.equal(ctx.last().status, STATUS.PAUSED);

  ctx.serve(0);
  await tick();
  assert.equal(ctx.audios.length, 0, "no audio starts while paused");
  assert.equal(ctx.last().status, STATUS.PAUSED);

  ctx.player.resume();
  await tick();
  assert.equal(ctx.audios[0].playCalls, 1);
  assert.equal(ctx.last().status, STATUS.PLAYING);
});

test("resuming while the chunk is still downloading goes back to LOADING", async () => {
  const ctx = setup();
  ctx.player.play(TEXT, OPTS);
  ctx.player.pause();
  ctx.player.resume();
  assert.equal(ctx.last().status, STATUS.LOADING);
  ctx.serve(0);
  await tick();
  assert.equal(ctx.last().status, STATUS.PLAYING);
});

test("pause and resume are no-ops when there is nothing to pause or resume", () => {
  const ctx = setup();
  ctx.player.pause();
  ctx.player.resume();
  assert.equal(ctx.states.length, 0);
});

test("stop aborts pending fetches, releases audio and goes idle", async () => {
  const ctx = setup();
  await startPlaying(ctx);
  ctx.serve(1);
  await tick();

  ctx.player.stop();

  assert.equal(ctx.fetches[2].signal.aborted, true, "the in-flight prefetch is aborted");
  assert.equal(ctx.audios[0].pauseCalls, 1);
  assert.deepEqual(ctx.last(), IDLE_STATE);
  assert.deepEqual([...ctx.revoked].sort(), ["blob:fake/0", "blob:fake/1"]);
});

test("late results after stop are ignored", async () => {
  const ctx = setup();
  ctx.player.play(TEXT, OPTS);
  ctx.player.stop();
  ctx.serve(0);
  await tick();

  assert.equal(ctx.audios.length, 0);
  assert.deepEqual(ctx.last(), IDLE_STATE);
  assert.deepEqual(ctx.revoked.length, 0, "never-created URLs are not revoked");

  // A stale 'ended' event must not advance anything either.
  const ctx2 = setup();
  await startPlaying(ctx2);
  const old = ctx2.audios[0];
  ctx2.player.stop();
  old.finish();
  await tick();
  assert.equal(ctx2.audios.length, 1);
  assert.deepEqual(ctx2.last(), IDLE_STATE);
});

test("playing again replaces the previous reading", async () => {
  const ctx = setup();
  await startPlaying(ctx);
  const firstSignal = ctx.fetches[1].signal;

  ctx.player.play("Fresh start.", OPTS);

  assert.equal(firstSignal.aborted, true);
  assert.equal(ctx.audios[0].pauseCalls, 1);
  assert.equal(ctx.fetches.at(-1).text, "Fresh start.");
  assert.deepEqual(ctx.last(), { status: STATUS.LOADING, index: 0, total: 1, error: null });
});

test("a server failure reports ERROR with the message and stops everything", async () => {
  const ctx = setup();
  await startPlaying(ctx);
  ctx.audios[0].finish();
  await tick();

  ctx.fetches[1].reject(new Error("Cannot reach the Kokoro server. Is it running?"));
  await tick();

  assert.deepEqual(ctx.last(), {
    status: STATUS.ERROR,
    index: 1,
    total: 5,
    error: "Cannot reach the Kokoro server. Is it running?",
  });
  assert.equal(ctx.fetches[2].signal.aborted, true);
});

test("an audio element error reports ERROR", async () => {
  const ctx = setup();
  await startPlaying(ctx);
  ctx.audios[0].onerror();
  await tick();
  assert.equal(ctx.last().status, STATUS.ERROR);
  assert.match(ctx.last().error, /audio/i);
});

test("a rejected play() reports ERROR", async () => {
  const ctx = setup({
    createAudio: (url) => {
      const audio = new FakeAudio(url);
      audio.playResult = Promise.reject(new Error("NotAllowedError"));
      return audio;
    },
  });
  await startPlaying(ctx);
  assert.equal(ctx.last().status, STATUS.ERROR);
  assert.match(ctx.last().error, /NotAllowedError/);
});

test("empty text reports ERROR without calling the server", () => {
  const ctx = setup();
  ctx.player.play("  ... ", OPTS);
  assert.equal(ctx.fetches.length, 0);
  assert.equal(ctx.last().status, STATUS.ERROR);
  assert.match(ctx.last().error, /no readable text/i);
});

test("getState returns a snapshot of the current state", async () => {
  const ctx = setup();
  assert.deepEqual(ctx.player.getState(), IDLE_STATE);
  await startPlaying(ctx);
  const snapshot = ctx.player.getState();
  assert.deepEqual(snapshot, { status: STATUS.PLAYING, index: 0, total: 5, error: null });
  snapshot.status = "tampered";
  assert.equal(ctx.player.getState().status, STATUS.PLAYING);
});
