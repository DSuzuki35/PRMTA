import { describe, expect, test } from 'vitest';
import { tokenize } from '../shared/text';
import { alignTranscript } from '../shared/matcher';
import { navigationStarts, pagesFor } from '../shared/pages';
import { appearanceSchema, defaultAppearance } from '../shared/model';
import { Session } from '../server/session';

describe('optional stage directions', () => {
  test('keeps spoken offsets while omitting inline, multiline and punctuation-only cues', () => {
    const content = '[look up] Hello [pause\n\nfor camera] world. [!!!]';
    expect(tokenize(content).map(({ raw, start, end, paragraph }) => ({ raw, start, end, paragraph }))).toEqual([
      { raw: 'Hello', start: 10, end: 15, paragraph: 0 },
      { raw: 'world', start: 36, end: 41, paragraph: 0 },
    ]);
    expect(tokenize('[pause]')).toEqual([]);
    expect(tokenize('Hello [unfinished note').map(w => w.raw)).toEqual(['Hello', 'unfinished', 'note']);
    expect(tokenize('Hello [unfinished [nested] note').map(w => w.raw)).toEqual(['Hello', 'unfinished', 'nested', 'note']);
  });

  test('voice follows narration across long unspoken cues without relaxing seek limits', () => {
    const content = `Welcome to the show. [${'Switch the camera and wait for a close up. '.repeat(20)}] Today we explore new ideas together.`;
    expect(alignTranscript(content, 'welcome to the show today we explore', 0)).toMatchObject({ matched: true, position: 7 });
    expect(alignTranscript(content, 'today we explore new ideas', 4)).toMatchObject({ matched: true, position: 9 });
    expect(alignTranscript(content, 'switch the camera and wait for a close up', 4).matched).toBe(false);
    expect(alignTranscript(`${content} ${'ordinary narration '.repeat(40)} a unique distant phrase`, 'a unique distant phrase', 4).matched).toBe(false);
  });

  test('a session finishes after narration without requiring trailing directions', () => {
    const session = new Session();
    session.load({ id: 'cue', title: 'Cue', content: '[smile] One two three. [pause] Four five six. [fade out]' });
    session.command({ type: 'mode', mode: 'voice' }, 1000);
    session.command({ type: 'play', countdown: 0 }, 1000);
    session.command({ type: 'transcript', text: 'one two three' }, 1100);
    expect(session.state.position).toBe(3);
    expect(session.state.playing).toBe(true);
    session.command({ type: 'transcript', text: 'four five six' }, 1500);
    expect(session.state.position).toBe(6);
    expect(session.state.playing).toBe(false);
  });

  test('cue punctuation and internal separators do not create narration boundaries', () => {
    const content = 'One [wait!\n\n---\n# Camera] two three.\n---\n[smile] Four five six.';
    expect(pagesFor(content)).toEqual([{ start: 0, end: 3 }, { start: 3, end: 6 }]);
    expect(navigationStarts(content, 'sentence')).toEqual([0, 3]);
    expect(navigationStarts(content, 'paragraph')).toEqual([0, 3]);
    expect(navigationStarts(content, 'chapter')).toEqual([0, 3]);
  });

  test('nested brackets keep speech, page and sentence positions consistent', () => {
    const content = 'One [camera [close up] now] two three.\n---\nFour five six.';
    expect(tokenize(content).map(w => w.raw)).toEqual(['One', 'two', 'three', 'Four', 'five', 'six']);
    expect(pagesFor(content)).toEqual([{ start: 0, end: 3 }, { start: 3, end: 6 }]);
    expect(navigationStarts(content, 'sentence')).toEqual([0, 3]);
    expect(alignTranscript(content, 'one two three four five', 0)).toMatchObject({ matched: true, position: 5 });
  });

  test('older output profiles show directions by default and can persist hiding them', () => {
    const { showStageDirections: _, ...legacyAppearance } = defaultAppearance;
    expect(appearanceSchema.parse(legacyAppearance)).toMatchObject({ showStageDirections: true });
    expect(appearanceSchema.parse({ ...defaultAppearance, showStageDirections: false })).toMatchObject({ showStageDirections: false });
  });
});
