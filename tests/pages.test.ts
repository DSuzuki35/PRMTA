import { expect, it } from 'vitest';
import { pagesFor } from '../shared/pages';
it('treats standalone --- and escaped \\--- as page separators without spoken tokens', () => {
  expect(pagesFor('one two\n---\nthree four\n\\---\nfive six')).toEqual([{ start: 0, end: 2 }, { start: 2, end: 4 }, { start: 4, end: 6 }]);
});
it('ignores empty pages and supplies automatic pages for long unmarked scripts', () => {
  expect(pagesFor('---\n\n---')).toEqual([]);
  expect(pagesFor(Array(125).fill('word').join(' '))).toEqual([{ start: 0, end: 60 }, { start: 60, end: 120 }, { start: 120, end: 125 }]);
});
