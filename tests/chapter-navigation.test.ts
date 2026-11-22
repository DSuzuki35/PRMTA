import { describe, expect, it } from 'vitest';
import { navigateTo, navigationStarts } from '../shared/pages';
import { tokenize } from '../shared/text';

describe('chapter navigation', () => {
  it('uses Markdown heading token positions and preserves an introduction', () => {
    const content = 'Opening words.\r\n\r\n# First chapter\r\nBody here.\r\n   ###### Last chapter\r\nClosing words.';
    expect(navigationStarts(content, 'chapter')).toEqual([0, 2, 6]);
    expect(tokenize(content).map(word => word.raw)).toEqual(['Opening', 'words', 'First', 'chapter', 'Body', 'here', 'Last', 'chapter', 'Closing', 'words']);
  });

  it('does not duplicate zero when the first heading starts the script', () => {
    expect(navigationStarts('# First\nText\n## Second\nMore', 'chapter')).toEqual([0, 2]);
  });

  it('requires a real heading line with at most three leading spaces', () => {
    const content = 'Start\ninline # mention\n####### too many\n#hashtag\n    # code\n\t# tabbed\n## Actual\nEnd';
    expect(navigationStarts(content, 'chapter')).toEqual([0, 8]);
  });

  it('prefers headings to explicit page separators', () => {
    expect(navigationStarts('Intro\n---\nMore\n# Chapter\nText\n\\---\nTail', 'chapter')).toEqual([0, 2]);
  });

  it('uses only explicit separators when no heading exists', () => {
    expect(navigationStarts('one two\n---\nthree\n\\---\nfour five', 'chapter')).toEqual([0, 2, 3]);
    expect(navigationStarts(`${'word '.repeat(60)}end. Another sentence.`, 'chapter')).toEqual([0]);
    expect(navigationStarts('One paragraph.\n\nAnother paragraph.', 'chapter')).toEqual([0]);
    expect(navigationStarts('\n---\n\\---\n', 'chapter')).toEqual([]);
  });

  it('clamps at chapter boundaries and moves back one chapter from its middle', () => {
    const starts = navigationStarts('Intro words\n# First\nbody more\n# Second\nbody more', 'chapter');
    expect(navigateTo(starts, 0, -1)).toBe(0);
    expect(navigateTo(starts, 0, 1)).toBe(2);
    expect(navigateTo(starts, 4, -1)).toBe(0);
    expect(navigateTo(starts, 99, 1)).toBe(5);
  });
});
