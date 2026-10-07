// Text preparation for the TTS server: cleaning and sentence-aware chunking.
// Pure functions, no chrome APIs.

// `[12]`, `[3, 4]`, `[5–7]` footnote markers, together with the space before them.
const CITATION = /\s*\[\d+(?:\s*[,–-]\s*\d+)*\]/g;

// Bare URLs; trailing sentence punctuation is not part of the URL.
const URL_PATTERN = /\s*(?:https?:\/\/|www\.)[^\s<>"]*[^\s<>".,;:!?)\]'”]/g;

// A sentence ends at . ! ? … (optionally followed by closing quotes or
// brackets) and whitespace. Opening marks such as ¿ ¡ stay with the next sentence.
const SENTENCE_BREAK = /(?<=[.!?…]+["'”’»)\]]*)\s+/;

const HAS_CONTENT = /[\p{L}\p{N}]/u;

export const DEFAULT_CHUNK_OPTIONS = Object.freeze({
  firstMax: 120, // short first chunk so playback starts quickly
  max: 300,
});

/**
 * Collapses whitespace and drops citation markers and bare URLs. Line breaks
 * are kept (one `\n` per paragraph break) because the chunker uses them as
 * hard boundaries.
 * @param {unknown} text
 * @returns {string}
 */
export function cleanText(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(/\r\n?/g, "\n")
    .replace(CITATION, "")
    .replace(URL_PATTERN, "")
    .replace(/\(\s*\)/g, "") // parentheses emptied by a removed URL
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n\s*/g, "\n")
    .trim();
}

/**
 * Cuts `text` (longer than `limit`) into a head of at most `limit` characters
 * and the remainder, preferring a clause break (, ; :), then a space.
 * @returns {[string, string]}
 */
function takeHead(text, limit) {
  const window = text.slice(0, limit + 1);

  let cut = -1;
  for (let i = window.length - 2; i >= 0; i--) {
    if (",;:".includes(window[i]) && /\s/.test(window[i + 1]) && i + 1 >= limit / 3) {
      cut = i + 1;
      break;
    }
  }
  if (cut === -1) {
    const space = window.search(/\s\S*$/);
    cut = space > 0 ? space : limit;
  }
  return [text.slice(0, cut).trim(), text.slice(cut).trim()];
}

/**
 * Splits text into chunks to synthesize one by one. The first chunk is short
 * (`firstMax`) so audio starts fast; the others hold up to `max` characters.
 * Chunks end at sentence boundaries when possible, always at paragraph breaks,
 * and oversized sentences are cut at , ; : and then at spaces.
 * @param {unknown} text
 * @param {{firstMax?: number, max?: number}} [opts]
 * @returns {string[]}
 */
export function splitIntoChunks(text, opts = {}) {
  const { firstMax, max } = { ...DEFAULT_CHUNK_OPTIONS, ...opts };

  const queue = [];
  for (const paragraph of cleanText(text).split("\n")) {
    const sentences = paragraph.split(SENTENCE_BREAK).filter(Boolean);
    sentences.forEach((sentence, i) => queue.push({ text: sentence, end: i === sentences.length - 1 }));
  }

  const chunks = [];
  let current = "";
  const limit = () => (chunks.length === 0 ? firstMax : max);
  const flush = () => {
    if (current) chunks.push(current);
    current = "";
  };

  while (queue.length > 0) {
    const segment = queue.shift();
    if (current && current.length + 1 + segment.text.length <= limit()) {
      current += ` ${segment.text}`;
    } else {
      flush();
      if (segment.text.length <= limit()) {
        current = segment.text;
      } else {
        const [head, rest] = takeHead(segment.text, limit());
        chunks.push(head);
        if (rest) queue.unshift({ text: rest, end: segment.end });
        continue;
      }
    }
    if (segment.end) flush();
  }
  flush();

  return chunks.filter((chunk) => HAS_CONTENT.test(chunk));
}
