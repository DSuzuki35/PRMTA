import { expect, it } from 'vitest';
import { pagesFor } from '../shared/pages';
import { tokenize } from '../shared/text';
const sentence = (count: number, punctuation = '.') => Array(count).fill('word').join(' ') + punctuation;
it('preserves explicit page separators including escaped separators', () => {
  expect(pagesFor('one two\n---\nthree four\n\\---\nfive six')).toEqual([{ start: 0, end: 2 }, { start: 2, end: 4 }, { start: 4, end: 6 }]);
  expect(pagesFor('---\n\n---')).toEqual([]);
});
it('keeps the next sentence off the end of a nearly full page', () => {
  expect(pagesFor(`${sentence(59)} There is another sentence that belongs on the next page.`)).toEqual([{ start: 0, end: 59 }, { start: 59, end: 69 }]);
});
it('packs whole sentences up to the target without cutting their final word', () => {
  expect(pagesFor(`${sentence(25)} ${sentence(25, '!')} ${sentence(25, '?')}`)).toEqual([{ start: 0, end: 50 }, { start: 50, end: 75 }]);
});
it('uses clause punctuation when a single sentence is too long', () => {
  expect(pagesFor(`${sentence(40, ',')} ${sentence(40, ';')} ${sentence(40)}`)).toEqual([{ start: 0, end: 40 }, { start: 40, end: 80 }, { start: 80, end: 120 }]);
});
it('keeps unpunctuated text intact rather than inventing a mid-sentence break', () => {
  expect(pagesFor(Array(125).fill('word').join(' '))).toEqual([{ start: 0, end: 125 }]);
});
it('does not split decimal numbers at a comma', () => {
  const text = `${Array(35).fill('word').join(' ')} 1,234 ${sentence(40)}`;
  expect(pagesFor(text)).toEqual([{ start: 0, end: tokenize(text).length }]);
});
it('covers every token exactly once including quotations and German punctuation', () => {
  const content = `${sentence(45, '.”')}\n\n„${sentence(35, '?')}“ ${sentence(50, '!')}`;
  const pages = pagesFor(content);
  expect(pages[0].start).toBe(0); expect(pages.at(-1)!.end).toBe(tokenize(content).length);
  for (let i = 1; i < pages.length; i++) expect(pages[i].start).toBe(pages[i - 1].end);
  expect(pages.map(p => p.end - p.start)).toEqual([45, 35, 50]);
});

it('keeps Plan B sentence endings and clock times intact', () => {
  const plan = `${Array(57).fill('word').join(' ')} Plan B. ${sentence(20)}`;
  expect(pagesFor(plan)).toEqual([{ start: 0, end: 59 }, { start: 59, end: 79 }]);
  const time = `${Array(35).fill('word').join(' ')} 10:30 ${sentence(40)}`;
  expect(pagesFor(time)).toEqual([{ start: 0, end: tokenize(time).length }]);
});
it('prefers a complete sentence before starting clauses of a long sentence', () => {
  expect(pagesFor(`${sentence(50)} ${sentence(10, ',')} ${sentence(40, ',')} ${sentence(40)}`)).toEqual([{ start: 0, end: 50 }, { start: 50, end: 100 }, { start: 100, end: 140 }]);
});
