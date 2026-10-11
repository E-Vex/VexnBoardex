import { describe, expect, it } from 'vitest';

import { layoutText } from './textLayout';

/** The fake measure from the brief (R4): every character is 10 units wide. */
const measure = (s: string): number => s.length * 10;

describe('layoutText — invalid inputs give [] (T-007 R4)', () => {
  it('empty text gives []', () => {
    expect(layoutText('', 100, measure, 3)).toEqual([]);
  });

  it('non-positive maxWidth gives []', () => {
    expect(layoutText('hello', 0, measure, 3)).toEqual([]);
    expect(layoutText('hello', -10, measure, 3)).toEqual([]);
  });

  it('non-finite maxWidth gives []', () => {
    expect(layoutText('hello', NaN, measure, 3)).toEqual([]);
    expect(layoutText('hello', Infinity, measure, 3)).toEqual([]);
    expect(layoutText('hello', -Infinity, measure, 3)).toEqual([]);
  });

  it('non-positive maxLines gives []', () => {
    expect(layoutText('hello', 100, measure, 0)).toEqual([]);
    expect(layoutText('hello', 100, measure, -2)).toEqual([]);
  });

  it('non-finite maxLines gives []', () => {
    expect(layoutText('hello', 100, measure, NaN)).toEqual([]);
    expect(layoutText('hello', 100, measure, Infinity)).toEqual([]);
  });
});

describe('layoutText — single-line and greedy wrap (T-007 R4)', () => {
  it('a short text stays on one line', () => {
    expect(layoutText('hello', 100, measure, 3)).toEqual(['hello']);
  });

  it('a text exactly maxWidth wide fits (boundary is inclusive)', () => {
    // 'hello' = 50 units wide, maxWidth = 50 → fits exactly.
    expect(layoutText('hello', 50, measure, 3)).toEqual(['hello']);
  });

  it('greedy wrap: words are added while they fit', () => {
    // 'aa bb' = 50 fits; 'aa bb cc' = 80 > 70 → wrap before 'cc'.
    expect(layoutText('aa bb cc', 70, measure, 5)).toEqual(['aa bb', 'cc']);
  });

  it('a word that does not fit goes on the next line alone', () => {
    // 'aaa' = 30, 'aaa bbb' = 70 > 50 → ['aaa', 'bbb'].
    expect(layoutText('aaa bbb', 50, measure, 5)).toEqual(['aaa', 'bbb']);
  });

  it('multiple spaces are preserved within a line', () => {
    // 'a  b' (two spaces) = 40 units — one line, spacing intact.
    expect(layoutText('a  b', 100, measure, 5)).toEqual(['a  b']);
  });

  it('long text wraps across several lines greedily', () => {
    // Words of 2 chars each (20 units + 10 per space).
    // maxWidth 50 → 'aa bb' (50); 'cc dd' (50); 'ee' (20).
    expect(layoutText('aa bb cc dd ee', 50, measure, 10)).toEqual([
      'aa bb',
      'cc dd',
      'ee',
    ]);
  });
});

describe('layoutText — \\n handling (T-007 R4)', () => {
  it('\\n starts a new line', () => {
    expect(layoutText('ab\ncd', 100, measure, 5)).toEqual(['ab', 'cd']);
  });

  it('an empty line between \\n is kept', () => {
    expect(layoutText('a\n\nb', 100, measure, 5)).toEqual(['a', '', 'b']);
  });

  it('a trailing \\n produces a trailing empty line', () => {
    expect(layoutText('a\n', 100, measure, 5)).toEqual(['a', '']);
  });

  it('paragraphs wrap independently', () => {
    // 'aa bb' wraps at 30 into ['aa','bb']; 'cc' stays.
    expect(layoutText('aa bb\ncc', 30, measure, 10)).toEqual([
      'aa',
      'bb',
      'cc',
    ]);
  });
});

describe('layoutText — over-wide words split by characters (T-007 R4)', () => {
  it('a word wider than maxWidth is chunked to fit', () => {
    // 'abcdefghijkl' = 120 wide, maxWidth 50 → chunks of 5 chars.
    expect(layoutText('abcdefghijkl', 50, measure, 10)).toEqual([
      'abcde',
      'fghij',
      'kl',
    ]);
  });

  it('the first chunk may join the current line if it fits', () => {
    // 'xx abcdefghij': 'xx' (20) fits; 'xx abcde' (80) > 50 → 'xx' flushed,
    // then the word chunks continue on fresh lines.
    expect(layoutText('xx abcdefghij', 50, measure, 10)).toEqual([
      'xx',
      'abcde',
      'fghij',
    ]);
  });

  it('chunks are sized to maxWidth, not to the space left on the line', () => {
    // 'xx abcdefghij': the word (110) is split into chunks of maxWidth 90 →
    // 'abcdefghi' + 'j'; 'xx abcdefghi' (120) > 90, so 'xx' is flushed.
    expect(layoutText('xx abcdefghij', 90, measure, 10)).toEqual([
      'xx',
      'abcdefghi',
      'j',
    ]);
  });

  it('the first chunk joins the current line when it fits (custom measure)', () => {
    // 'W' is 90 wide, every other char 10 — a proportional-font stand-in.
    // Word 'aaW' (110) > 100 → chunks ['aa', 'W']; 'i aa' (40) fits, so the
    // first chunk joins 'i' instead of flushing the line.
    const m = (s: string): number =>
      [...s].reduce((sum, ch) => sum + (ch === 'W' ? 90 : 10), 0);
    expect(layoutText('i aaW', 100, m, 10)).toEqual(['i aa', 'W']);
  });

  it('no space is inserted inside a split word', () => {
    // The chunks of 'aaaaaa' join back to 'aaaaaa' with no gap.
    const lines = layoutText('aaaaaa', 20, measure, 10);
    expect(lines).toEqual(['aa', 'aa', 'aa']);
    expect(lines.join('')).toBe('aaaaaa');
  });

  it('a single character wider than maxWidth is its own chunk', () => {
    // 'abc' = 30 wide, maxWidth 10 → each char alone (cannot split further).
    expect(layoutText('abc', 10, measure, 10)).toEqual(['a', 'b', 'c']);
  });
});

describe('layoutText — maxLines truncation (T-007 R4)', () => {
  it('fewer lines than maxLines: nothing is truncated', () => {
    // 'aa bb' (50) fits on one line; maxLines 2 leaves it untouched.
    expect(layoutText('aa bb', 100, measure, 2)).toEqual(['aa bb']);
  });

  it('exactly maxLines lines: nothing is truncated', () => {
    // 'aa bb cc' (80) then 'dd' → exactly 2 lines, maxLines 2.
    expect(layoutText('aa bb cc dd', 80, measure, 2)).toEqual([
      'aa bb cc',
      'dd',
    ]);
  });

  it('more lines than maxLines: last kept line ends with …', () => {
    // Lines would be ['aa bb cc', 'dd']; maxLines 1 → 'aa bb cc…' (90 ≤ 100).
    expect(layoutText('aa bb cc dd', 100, measure, 1)).toEqual(['aa bb cc…']);
  });

  it('the last line is shortened until it fits with the …', () => {
    // 'aaaaa' (50) fits, 'aaaaa bbbbb' does not → lines ['aaaaa','bbbbb'];
    // maxLines 1 → 'aaaaa…' = 60 > 50 → 'aaaa…' = 50 fits.
    expect(layoutText('aaaaa bbbbb', 50, measure, 1)).toEqual(['aaaa…']);
  });

  it('the ellipsis can shorten the line to a single character', () => {
    // 'aaaa' = 40, maxWidth 40 → 'aaaa…' = 50 > 40 → 'aaa…' = 40 fits.
    expect(layoutText('aaaa bbbb', 40, measure, 1)).toEqual(['aaa…']);
  });

  it('truncation works after \\n too', () => {
    // ['a', 'b'] with maxLines 1 → ['a…'].
    expect(layoutText('a\nb', 100, measure, 1)).toEqual(['a…']);
  });

  it('a trailing space is trimmed before the … is appended', () => {
    // Paragraph 'aa ' keeps its trailing space on the line ('aa '), so the
    // truncated line must become 'aa…', never 'aa …'.
    expect(layoutText('aa \nbb', 50, measure, 1)).toEqual(['aa…']);
  });

  it('the … is kept even when it alone overflows maxWidth', () => {
    // maxWidth 10: every char is 10 wide, so 'a…' is 20 > 10 → shorten to
    // 'a' gone, leaving just '…' (still wider, but truncation stays visible).
    expect(layoutText('ab cd', 10, measure, 1)).toEqual(['…']);
  });

  it('a fractional maxLines is floored', () => {
    // maxLines 2.5 behaves as 2: keep ['aa bb', 'cc dd']; 'cc dd…' (60) > 50
    // → shorten to 'cc d…' (50) which fits.
    expect(layoutText('aa bb cc dd ee', 50, measure, 2.5)).toEqual([
      'aa bb',
      'cc d…',
    ]);
  });
});

describe('layoutText — purity (T-007 R4)', () => {
  it('same inputs give the same output', () => {
    expect(layoutText('aa bb cc dd ee', 50, measure, 10)).toEqual(
      layoutText('aa bb cc dd ee', 50, measure, 10),
    );
  });

  it('does not mutate its inputs (strings are immutable anyway)', () => {
    const text = 'hello world';
    layoutText(text, 50, measure, 2);
    expect(text).toBe('hello world');
  });
});
