/**
 * Text layout (T-007 R4) — pure, DOM-free word wrapping.
 *
 * `layoutText(text, maxWidth, measure, maxLines)` splits `text` into lines
 * that are each at most `maxWidth` wide, using `measure(s)` (e.g.
 * `ctx.measureText(s).width`) as the width oracle. Everything here is plain
 * string math: no DOM, no canvas, no state — the renderer supplies the
 * measuring function, so this module stays testable with a fake (R4).
 *
 * Rules (R4):
 * - `\n` always starts a new line.
 * - Greedy word wrap on spaces: words are added to the current line while
 *   they fit (joined by a single space), otherwise the line is flushed.
 * - A word wider than `maxWidth` is split by characters into chunks that fit.
 * - Empty text gives `[]`; a non-finite or non-positive `maxWidth` or
 *   `maxLines` gives `[]`.
 * - More lines than `maxLines`: keep `maxLines` lines and end the last one
 *   with `…`, shortened from the end so it still fits.
 */

/** The truncation marker appended to an overflowing last line. */
export const ELLIPSIS = '…';

/** True when a value is usable as a width/line budget. */
function isPositiveFinite(n: number): boolean {
  return Number.isFinite(n) && n > 0;
}

/**
 * Split a single word (wider than `maxWidth`) into character chunks, each of
 * which fits `maxWidth` when possible. A single character wider than
 * `maxWidth` becomes its own chunk — it cannot be split further. Iterates by
 * code point so surrogate pairs stay intact.
 */
function splitWordByChars(
  word: string,
  maxWidth: number,
  measure: (s: string) => number,
): string[] {
  const chunks: string[] = [];
  let chunk = '';
  for (const ch of word) {
    if (chunk === '') {
      // A lone character is unavoidable, however wide it measures.
      chunk = ch;
    } else if (measure(chunk + ch) <= maxWidth) {
      chunk += ch;
    } else {
      chunks.push(chunk);
      chunk = ch;
    }
  }
  if (chunk !== '') {
    chunks.push(chunk);
  }
  return chunks;
}

/**
 * Greedy word wrap of one paragraph (no `\n` inside). Appends the wrapped
 * lines to `out` (always at least one line, possibly empty).
 */
function wrapParagraph(
  paragraph: string,
  maxWidth: number,
  measure: (s: string) => number,
  out: string[],
): void {
  const words = paragraph.split(' ');
  let line = '';

  for (const word of words) {
    // A word wider than maxWidth is split by characters (R4).
    if (measure(word) > maxWidth) {
      const chunks = splitWordByChars(word, maxWidth, measure);
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]!;
        if (i === 0 && line !== '') {
          // The first chunk may still join the current line.
          const candidate = line + ' ' + chunk;
          if (measure(candidate) <= maxWidth) {
            line = candidate;
            continue;
          }
          out.push(line);
          line = chunk;
          continue;
        }
        // Remaining chunks: each starts its own line (no space inserted —
        // they are pieces of one word).
        if (line !== '') {
          out.push(line);
        }
        line = chunk;
      }
      continue;
    }

    const candidate = line === '' ? word : line + ' ' + word;
    if (measure(candidate) <= maxWidth) {
      line = candidate;
    } else {
      out.push(line);
      line = word;
    }
  }
  out.push(line);
}

/**
 * Lay out `text` into at most `maxLines` lines, each at most `maxWidth`
 * wide (T-007 R4). `measure(s)` returns the width of `s` in the same units
 * as `maxWidth`. Returns `[]` for empty text or a non-finite/non-positive
 * `maxWidth`/`maxLines`. A fractional `maxLines` is floored.
 */
export function layoutText(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
  maxLines: number,
): string[] {
  if (text === '') return [];
  if (!isPositiveFinite(maxWidth) || !isPositiveFinite(maxLines)) return [];
  const limit = Math.floor(maxLines);

  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    wrapParagraph(paragraph, maxWidth, measure, lines);
  }

  // Truncation (R4): keep `limit` lines, end the last with `…`, shortened
  // from the end until `last + …` fits (the `…` itself is always kept so
  // truncation stays visible, even if it alone overflows).
  if (lines.length > limit) {
    let last = lines[limit - 1]!.replace(/\s+$/, '');
    while (last !== '' && measure(last + ELLIPSIS) > maxWidth) {
      last = last.slice(0, -1).replace(/\s+$/, '');
    }
    const kept = lines.slice(0, limit);
    kept[limit - 1] = last + ELLIPSIS;
    return kept;
  }

  return lines;
}
