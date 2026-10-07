// Chunked audio player: synthesizes the text chunk by chunk, keeps the next
// chunks prefetched and plays them back to back. No chrome APIs; every
// side-effecting dependency is injected so it can be tested with fakes.
import { IDLE_STATE, STATUS } from "./contract.js";
import { splitIntoChunks } from "./chunker.js";
import { clampSpeed, generationSpeed, playbackRateFor } from "./speed.js";

const PREFETCH_AHEAD = 2;

/**
 * @typedef {object} PlayerDeps
 * @property {(args: {text: string, voice: string, speed: number, serverUrl: string, signal: AbortSignal}) => Promise<Blob>} synthesize
 * @property {(url: string) => HTMLAudioElement} createAudio Audio-like: play(), pause(), playbackRate, preservesPitch, onended, onerror.
 * @property {(state: import("./contract.js").PlayerState) => void} onState
 * @property {(blob: Blob) => string} [createObjectURL]
 * @property {(url: string) => void} [revokeObjectURL]
 */

/**
 * One synthesized chunk. `generatedSpeed` is remembered so the playback rate
 * can always be derived from the *current* speed.
 * @typedef {object} Entry
 * @property {AbortController} controller
 * @property {number} generatedSpeed
 * @property {Promise<Entry>} promise Resolves once the audio has been downloaded.
 * @property {string|null} url
 * @property {ReturnType<PlayerDeps["createAudio"]>|null} audio
 * @property {boolean} disposed
 */

export class Player {
  #synthesize;
  #createAudio;
  #onState;
  #createObjectURL;
  #revokeObjectURL;

  #session = 0; // bumped on every play/stop/failure; async work from older sessions is ignored
  #chunks = [];
  #entries = new Map(); // chunk index -> Entry
  #voice = "";
  #serverUrl = "";
  #speed = 1;
  #state = { ...IDLE_STATE };
  #waitingToStart = false; // the current chunk arrived while paused
  #queue = []; // synthesis jobs waiting for their turn, in request order
  #synthesizing = false; // the server handles one request at a time; concurrent ones fail

  /** @param {PlayerDeps} deps */
  constructor({ synthesize, createAudio, onState, createObjectURL, revokeObjectURL }) {
    this.#synthesize = synthesize;
    this.#createAudio = createAudio;
    this.#onState = onState;
    this.#createObjectURL = createObjectURL ?? ((blob) => URL.createObjectURL(blob));
    this.#revokeObjectURL = revokeObjectURL ?? ((url) => URL.revokeObjectURL(url));
  }

  /**
   * Starts reading `text`, replacing any reading in progress.
   * @param {string} text
   * @param {{voice: string, speed: number, serverUrl: string, startIndex?: number}} options
   */
  play(text, { voice, speed, serverUrl, startIndex = 0 }) {
    this.#reset();

    const chunks = splitIntoChunks(text);
    if (chunks.length === 0) {
      this.#setState({ ...IDLE_STATE, status: STATUS.ERROR, error: "There is no readable text to read." });
      return;
    }

    this.#chunks = chunks;
    this.#voice = voice;
    this.#serverUrl = serverUrl;
    this.#speed = clampSpeed(speed);

    const index = Math.min(chunks.length - 1, Math.max(0, Math.trunc(startIndex) || 0));
    this.#setState({ status: STATUS.LOADING, index, total: chunks.length, error: null });
    this.#playChunk(index, this.#session);
  }

  pause() {
    const { status, index } = this.#state;
    if (status !== STATUS.PLAYING && status !== STATUS.LOADING) return;
    this.#entries.get(index)?.audio?.pause();
    this.#setState({ ...this.#state, status: STATUS.PAUSED });
  }

  resume() {
    const { status, index } = this.#state;
    if (status !== STATUS.PAUSED) return;

    const entry = this.#entries.get(index);
    if (this.#waitingToStart && entry) {
      this.#waitingToStart = false;
      this.#setState({ ...this.#state, status: STATUS.LOADING });
      this.#startAudio(index, entry, this.#session);
    } else if (entry?.audio) {
      const session = this.#session;
      entry.audio.play().catch((err) => this.#onPlayRejected(err, session));
      this.#setState({ ...this.#state, status: STATUS.PLAYING });
    } else {
      // Still downloading: #playChunk starts the audio when it arrives.
      this.#setState({ ...this.#state, status: STATUS.LOADING });
    }
  }

  stop() {
    this.#reset();
    this.#setState({ ...IDLE_STATE });
  }

  /**
   * Changes the speed of the current and prefetched chunks right away; chunks
   * requested from now on are generated at the new speed.
   * @param {number} speed
   */
  setSpeed(speed) {
    this.#speed = clampSpeed(speed);
    for (const entry of this.#entries.values()) {
      if (entry.audio) entry.audio.playbackRate = playbackRateFor(this.#speed, entry.generatedSpeed);
    }
  }

  /** @returns {import("./contract.js").PlayerState} */
  getState() {
    return { ...this.#state };
  }

  // --- internals -----------------------------------------------------------

  #setState(state) {
    this.#state = state;
    this.#onState({ ...state });
  }

  /** Aborts and releases everything and invalidates in-flight async work. */
  #reset() {
    this.#session++;
    for (const index of [...this.#entries.keys()]) this.#release(index);
    this.#chunks = [];
    this.#waitingToStart = false;
  }

  #release(index) {
    const entry = this.#entries.get(index);
    if (!entry) return;
    entry.disposed = true;
    entry.controller.abort();
    if (entry.audio) {
      entry.audio.onended = null;
      entry.audio.onerror = null;
      entry.audio.pause();
    }
    if (entry.url) this.#revokeObjectURL(entry.url);
    this.#entries.delete(index);
  }

  #fail(err) {
    const { index, total } = this.#state;
    this.#reset();
    this.#setState({ status: STATUS.ERROR, index, total, error: err?.message ?? String(err) });
  }

  /** @returns {Entry} The chunk's entry, requesting the audio if needed. */
  #fetchChunk(index) {
    const existing = this.#entries.get(index);
    if (existing) return existing;

    const controller = new AbortController();
    /** @type {Entry} */
    const entry = {
      controller,
      generatedSpeed: generationSpeed(this.#speed),
      promise: null,
      url: null,
      audio: null,
      disposed: false,
    };
    const args = {
      text: this.#chunks[index],
      voice: this.#voice,
      speed: entry.generatedSpeed,
      serverUrl: this.#serverUrl,
      signal: controller.signal,
    };
    entry.promise = new Promise((resolve, reject) => {
      this.#queue.push({ entry, args, resolve, reject });
    });
    this.#pump();
    // A prefetch may fail long before anyone awaits it; the error surfaces
    // when playback reaches that chunk.
    entry.promise.catch(() => {});

    this.#entries.set(index, entry);
    return entry;
  }

  /** Starts the next queued synthesis unless one is already running. */
  #pump() {
    if (this.#synthesizing) return;
    let job;
    while ((job = this.#queue.shift())) {
      if (!job.entry.disposed) break;
      // Released before its turn: never hit the server, just settle the promise.
      job.reject(job.entry.controller.signal.reason);
    }
    if (!job) return;

    this.#synthesizing = true;
    this.#run(job).finally(() => {
      this.#synthesizing = false;
      this.#pump();
    });
  }

  async #run({ entry, args, resolve, reject }) {
    try {
      const blob = await this.#synthesize(args);
      if (!entry.disposed) entry.url = this.#createObjectURL(blob);
      resolve(entry);
    } catch (err) {
      reject(err);
    }
  }

  #prefetchAhead(index) {
    for (let i = index + 1; i <= index + PREFETCH_AHEAD && i < this.#chunks.length; i++) this.#fetchChunk(i);
  }

  async #playChunk(index, session) {
    let entry;
    try {
      entry = await this.#fetchChunk(index).promise;
    } catch (err) {
      if (session === this.#session) this.#fail(err);
      return;
    }
    if (session !== this.#session) return;

    if (this.#state.status === STATUS.PAUSED) {
      this.#waitingToStart = true;
      return;
    }
    await this.#startAudio(index, entry, session);
  }

  async #startAudio(index, entry, session) {
    const audio = this.#createAudio(entry.url);
    entry.audio = audio;
    audio.preservesPitch = true;
    audio.playbackRate = playbackRateFor(this.#speed, entry.generatedSpeed);
    audio.onended = () => this.#onEnded(index, session);
    audio.onerror = () => {
      if (session === this.#session) this.#fail(new Error("Audio playback failed."));
    };
    this.#prefetchAhead(index);

    try {
      await audio.play();
    } catch (err) {
      this.#onPlayRejected(err, session);
      return;
    }
    if (session !== this.#session || this.#state.status === STATUS.PAUSED) return;
    this.#setState({ ...this.#state, status: STATUS.PLAYING, index, error: null });
  }

  /** pause() makes a pending play() reject with an AbortError; that is not a failure. */
  #onPlayRejected(err, session) {
    if (session !== this.#session || err?.name === "AbortError") return;
    if (this.#state.status === STATUS.PAUSED) return;
    this.#fail(err);
  }

  #onEnded(index, session) {
    if (session !== this.#session) return;
    this.#release(index);

    const next = index + 1;
    if (next >= this.#chunks.length) {
      this.#reset();
      this.#setState({ ...IDLE_STATE });
      return;
    }

    if (!this.#fetchChunk(next).url) {
      this.#setState({ ...this.#state, status: STATUS.LOADING, index: next });
    }
    this.#playChunk(next, session);
  }
}
