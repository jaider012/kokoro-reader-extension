// HTTP client for the local Kokoro TTS server (see SERVER_URL in contract.js).

const MAX_DETAIL = 200;

/**
 * Synthesizes `text` and resolves with the WAV audio.
 * Aborting through `signal` rejects with the original AbortError.
 * @param {object} params
 * @param {string} params.serverUrl
 * @param {string} params.text
 * @param {string} params.voice Kokoro voice id.
 * @param {number} params.speed Generation speed accepted by the server (0.5-2).
 * @param {AbortSignal} [params.signal]
 * @param {typeof fetch} [params.fetchFn]
 * @returns {Promise<Blob>}
 */
export async function synthesize({ serverUrl, text, voice, speed, signal, fetchFn = fetch }) {
  const base = String(serverUrl).replace(/\/+$/, "");

  let response;
  try {
    response = await fetchFn(`${base}/leer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texto: text, voz: voice, velocidad: speed, formato: "wav" }),
      signal,
    });
  } catch (err) {
    if (signal?.aborted || err?.name === "AbortError") throw err;
    throw new Error(`Cannot reach the Kokoro server at ${base}. Is it running?`, { cause: err });
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
