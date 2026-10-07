// HTTP client for the local Kokoro TTS server (see SERVER_URL in contract.js).

const MAX_DETAIL = 200;
const RETRY_DELAY_MS = 300;
const RETRYABLE_STATUSES = new Set([500, 502, 503]);

/** Resolves after `ms`; rejects with the abort reason if `signal` aborts first. */
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(signal.reason);
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Synthesizes `text` and resolves with the WAV audio.
 * Aborting through `signal` rejects with the original AbortError.
 * A 500/502/503 answer is retried once after `retryDelayMs`: another client
 * (e.g. a desktop app) may be using the server at the same time.
 * @param {object} params
 * @param {string} params.serverUrl
 * @param {string} params.text
 * @param {string} params.voice Kokoro voice id.
 * @param {number} params.speed Generation speed accepted by the server (0.5-2).
 * @param {AbortSignal} [params.signal]
 * @param {typeof fetch} [params.fetchFn]
 * @param {number} [params.retryDelayMs]
 * @returns {Promise<Blob>}
 */
export async function synthesize({
  serverUrl,
  text,
  voice,
  speed,
  signal,
  fetchFn = fetch,
  retryDelayMs = RETRY_DELAY_MS,
}) {
  const base = String(serverUrl).replace(/\/+$/, "");

  const request = async () => {
    try {
      return await fetchFn(`${base}/leer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto: text, voz: voice, velocidad: speed, formato: "wav" }),
        signal,
      });
    } catch (err) {
      if (signal?.aborted || err?.name === "AbortError") throw err;
      throw new Error(`Cannot reach the Kokoro server at ${base}. Is it running?`, { cause: err });
    }
  };

  let response = await request();
  if (RETRYABLE_STATUSES.has(response.status)) {
    await response.body?.cancel().catch(() => {}); // free the connection of the failed attempt
    await delay(retryDelayMs, signal);
    response = await request();
  }

  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).trim().slice(0, MAX_DETAIL);
    throw new Error(`Kokoro server error (HTTP ${response.status})${detail ? `: ${detail}` : ""}`);
  }

  try {
    return await response.blob();
  } catch (err) {
    if (signal?.aborted || err?.name === "AbortError") throw err;
    throw new Error("The Kokoro server connection dropped while receiving audio.", { cause: err });
  }
}
