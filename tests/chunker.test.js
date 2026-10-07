import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanText, splitIntoChunks } from "../src/lib/chunker.js";

test("cleanText collapses runs of spaces and tabs", () => {
  assert.equal(cleanText("  Hello \t  world   again  "), "Hello world again");
});

test("cleanText drops citation markers", () => {
  assert.equal(cleanText("Fact[12] and more [3, 4][5–7]."), "Fact and more.");
});

test("cleanText keeps bracketed words that are not citations", () => {
  assert.equal(cleanText("The [sic] marker stays."), "The [sic] marker stays.");
});

test("cleanText drops bare URLs but keeps sentence punctuation", () => {
  assert.equal(cleanText("See https://example.com/a?b=1 for more."), "See for more.");
  assert.equal(cleanText("Visit www.example.org."), "Visit.");
  assert.equal(cleanText("Link (https://example.com) here"), "Link here");
});

test("cleanText turns blank-line runs into a single line break", () => {
  assert.equal(cleanText("One.\r\n\r\n   Two.\n\n\nThree."), "One.\nTwo.\nThree.");
});

test("cleanText returns an empty string for non-strings", () => {
  assert.equal(cleanText(null), "");
  assert.equal(cleanText(undefined), "");
  assert.equal(cleanText(42), "");
});

test("splitIntoChunks returns nothing for empty or symbol-only input", () => {
  assert.deepEqual(splitIntoChunks(""), []);
  assert.deepEqual(splitIntoChunks("   \n\n  "), []);
  assert.deepEqual(splitIntoChunks("... --- ..."), []);
});

test("splitIntoChunks keeps a short text in a single chunk", () => {
  assert.deepEqual(splitIntoChunks("Hello world. How are you?"), ["Hello world. How are you?"]);
});

test("splitIntoChunks does not split on decimals or inner dots", () => {
  assert.deepEqual(splitIntoChunks("Pi is 3.14 today."), ["Pi is 3.14 today."]);
});

test("splitIntoChunks keeps the first chunk short and packs the rest", () => {
  const sentence = "This sentence has exactly sixty characters in it, give or take.";
  const text = Array.from({ length: 12 }, () => sentence).join(" ");
  const chunks = splitIntoChunks(text);
  assert.ok(chunks[0].length <= 120, `first chunk too long: ${chunks[0].length}`);
  assert.ok(chunks.length > 2);
  for (const chunk of chunks.slice(1)) assert.ok(chunk.length <= 300, `chunk too long: ${chunk.length}`);
  assert.ok(chunks[1].length > 200, "later chunks should pack several sentences");
});

test("splitIntoChunks shortens a long first sentence", () => {
  const sentence = Array.from({ length: 14 }, (_, i) => `clause number ${i} goes here`).join(", ") + ".";
  const chunks = splitIntoChunks(sentence);
  assert.ok(chunks[0].length <= 120);
  assert.ok(chunks[0].endsWith(","), "should break at a comma");
});

test("splitIntoChunks breaks paragraphs into separate chunks", () => {
  assert.deepEqual(splitIntoChunks("First para.\n\nSecond para."), ["First para.", "Second para."]);
  assert.deepEqual(splitIntoChunks("Title\nBody text."), ["Title", "Body text."]);
});

test("splitIntoChunks keeps Spanish inverted marks with their sentence", () => {
  const chunks = splitIntoChunks("¿Cómo estás? ¡Muy bien! Gracias.", { firstMax: 14, max: 14 });
  assert.deepEqual(chunks, ["¿Cómo estás?", "¡Muy bien!", "Gracias."]);
});

test("splitIntoChunks splits after an ellipsis", () => {
  assert.deepEqual(splitIntoChunks("Wait… what? Yes.", { firstMax: 8, max: 8 }), ["Wait…", "what?", "Yes."]);
});

test("splitIntoChunks splits long sentences at , ; : before spaces", () => {
  const text = "alpha beta gamma, delta epsilon zeta; eta theta iota: kappa lambda mu";
  const chunks = splitIntoChunks(text, { firstMax: 40, max: 40 });
  assert.deepEqual(chunks, ["alpha beta gamma, delta epsilon zeta;", "eta theta iota: kappa lambda mu"]);
});

test("splitIntoChunks falls back to spaces and then hard cuts", () => {
  const spaced = splitIntoChunks("one two three four five six seven", { firstMax: 15, max: 15 });
  assert.deepEqual(spaced, ["one two three", "four five six", "seven"]);
  const unbroken = splitIntoChunks("a".repeat(25), { firstMax: 10, max: 10 });
  assert.deepEqual(unbroken, ["a".repeat(10), "a".repeat(10), "a".repeat(5)]);
});

test("splitIntoChunks never loses words", () => {
  const text = "Uno dos tres. Cuatro, cinco; seis: siete ocho nueve diez! ¿Once? Doce trece catorce quince.";
  const chunks = splitIntoChunks(text, { firstMax: 20, max: 30 });
  assert.equal(chunks.join(" "), text);
});
