import { test } from "node:test";
import assert from "node:assert/strict";
import { synthesize } from "../src/lib/kokoro-client.js";

const base = { serverUrl: "http://127.0.0.1:8880", text: "Hola", voice: "ef_dora", speed: 1.2 };

function fakeFetch(response, calls = []) {
  return async (url, init) => {
    calls.push({ url, init });
    return response;
  };
}

test("posts the request to /leer and returns the audio blob", async () => {
  const calls = [];
  const audio = new Blob(["RIFF"], { type: "audio/wav" });
  const fetchFn = fakeFetch(new Response(audio, { status: 200 }), calls);
  const signal = new AbortController().signal;

  const blob = await synthesize({ ...base, signal, fetchFn });

  assert.equal(await blob.text(), "RIFF");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://127.0.0.1:8880/leer");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  assert.equal(calls[0].init.signal, signal);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    texto: "Hola",
    voz: "ef_dora",
    velocidad: 1.2,
    formato: "wav",
  });
});

test("tolerates a trailing slash in the server URL", async () => {
  const calls = [];
  await synthesize({ ...base, serverUrl: "http://localhost:8880/", fetchFn: fakeFetch(new Response("x"), calls) });
  assert.equal(calls[0].url, "http://localhost:8880/leer");
});

test("a non-OK response raises an error with the status and server detail", async () => {
  const fetchFn = fakeFetch(new Response("voice not found", { status: 422, statusText: "Unprocessable" }));
  await assert.rejects(synthesize({ ...base, fetchFn }), (err) => {
    assert.match(err.message, /422/);
    assert.match(err.message, /voice not found/);
    return true;
  });
});

test("a network failure explains that the server is unreachable", async () => {
  const cause = new TypeError("Failed to fetch");
  const fetchFn = async () => {
    throw cause;
  };
  await assert.rejects(synthesize({ ...base, fetchFn }), (err) => {
    assert.match(err.message, /127\.0\.0\.1:8880/);
    assert.match(err.message, /running/i);
    assert.equal(err.cause, cause);
    return true;
  });
});

test("aborting is not reported as a server problem", async () => {
  const controller = new AbortController();
  const fetchFn = async (_url, { signal }) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason));
    });
  const pending = synthesize({ ...base, signal: controller.signal, fetchFn });
  controller.abort();
  await assert.rejects(pending, (err) => err.name === "AbortError");
});
