import { expect, it } from 'vitest';
import { defaultPreferences, preferencesSchema } from '../shared/model';
import { Session } from '../server/session';
import { GamepadInput } from '../shared/gamepad';

it('ignores held buttons on connect, edges navigation once, and cancels opposing scroll buttons', () => {
  const input = new GamepadInput();
  const bindings = { ...defaultPreferences, scrollUpButton: 0, scrollDownButton: 1 };
  const pad = (...buttons: boolean[]) => [{ index: 0, id: 'pad', buttons: buttons.map(pressed => ({ pressed })) }];
  expect(input.sample(pad(false, true), bindings).scroll).toBe(0);
  input.sample(pad(false, false, false, false, false, false), bindings);
  expect(input.sample(pad(false, true, false, false, false, true), bindings)).toEqual({ actions: ['nextButton'], scroll: 0 });
  expect(input.sample(pad(false, true, false, false, false, true), bindings)).toEqual({ actions: [], scroll: 1 });
  expect(input.sample(pad(true, true), bindings).scroll).toBe(0);
  expect(input.sample([], bindings).scroll).toBe(0);
  expect(input.sample(pad(false, true), bindings).scroll).toBe(0);
});

it('executes only one deterministic navigation action and ignores opposing navigation presses', () => {
  const input = new GamepadInput(), preferences = { ...defaultPreferences, nextSentenceButton: 7 };
  const pad = (held: number[]) => [{ index: 0, id: 'pad', buttons: Array.from({ length: 8 }, (_, index) => ({ pressed: held.includes(index) })) }];
  input.sample(pad([]), preferences);
  expect(input.sample(pad([5, 7]), preferences).actions).toEqual(['nextButton']);
  input.sample(pad([]), preferences);
  expect(input.sample(pad([4, 7]), preferences).actions).toEqual([]);
});

it('migrates existing page assignments, permits clearing, and rejects duplicate actions', () => {
  const old = { ...defaultPreferences, previousButton: 2, nextButton: 3 };
  expect(preferencesSchema.parse(old).previousSentenceButton).toBeNull();
  expect(preferencesSchema.safeParse({ ...old, previousButton: null, nextButton: null }).success).toBe(true);
  expect(preferencesSchema.safeParse({ ...old, scrollDownButton: 3 }).success).toBe(false);
  expect(preferencesSchema.safeParse({ ...old, previousSentenceButton: 7, nextParagraphButton: 7 }).success).toBe(false);
});

it('navigates whole sentences and paragraphs, clamps boundaries, and pauses voice', () => {
  const s = new Session(); s.load({ id: 'a', title: 'A', content: 'Dr. Smith has 1.25 euros. Next sentence!\n\nAnother paragraph.\n---\nLast page.' });
  s.command({ type: 'mode', mode: 'voice' }, 1000); s.command({ type: 'play' }, 1000);
  const revision = s.state.transportRevision;
  s.command({ type: 'navigate', unit: 'sentence', direction: 1 }, 1000);
  expect(s.state.position).toBe(6); expect(s.state.playing).toBe(false); expect(s.state.transportRevision).toBeGreaterThan(revision);
  s.command({ type: 'navigate', unit: 'paragraph', direction: 1 }, 1000); expect(s.state.position).toBe(8);
  s.command({ type: 'navigate', unit: 'paragraph', direction: 1 }, 1000); expect(s.state.position).toBe(10);
  s.command({ type: 'navigate', unit: 'page', direction: 1 }, 1000); expect(s.state.position).toBe(10);
  s.command({ type: 'navigate', unit: 'sentence', direction: -1 }, 1000); expect(s.state.position).toBe(8);
  s.command({ type: 'seek', position: 0 }, 1000);
  s.command({ type: 'navigate', unit: 'sentence', direction: -1 }, 1000); expect(s.state.position).toBe(0);
  s.command({ type: 'transcript', text: 'Last page', transportRevision: revision }, 1000); expect(s.state.position).toBe(0);
});

const source = 'bb743384-4141-4698-9212-946b4121e965';
it('scrolls continuously at the selected WPM and stops at release or heartbeat expiry', () => {
  const s = new Session(); s.load({ id: 'a', title: 'A', content: 'one two three four five six seven eight nine ten' });
  s.command({ type: 'scroll', direction: 1, speed: 120, source, sequence: 1 }, 1000);
  const revision = s.state.transportRevision;
  s.tick(1250); expect(s.state.position).toBeCloseTo(.5); expect(s.state.playing).toBe(false);
  s.command({ type: 'scroll', direction: 1, speed: 120, source, sequence: 2 }, 1250);
  expect(s.state.transportRevision).toBe(revision);
  s.command({ type: 'scroll', direction: 0, speed: 120, source, sequence: 3 }, 1500);
  expect(s.state.position).toBeCloseTo(1);
  s.tick(5000); expect(s.state.position).toBeCloseTo(1);
  s.command({ type: 'scroll', direction: 1, speed: 120, source, sequence: 4 }, 5000);
  s.tick(10000); expect(s.state.position).toBeCloseTo(2.2); expect(s.scrolling).toBe(false);
});

it('ignores delayed heartbeats after release and clamps reverse scrolling at the start', () => {
  const s = new Session(); s.load({ id: 'a', title: 'A', content: 'one two three' });
  s.command({ type: 'scroll', direction: 1, speed: 120, source, sequence: 1 }, 1000);
  s.command({ type: 'scroll', direction: 0, speed: 120, source, sequence: 3 }, 1100);
  s.command({ type: 'scroll', direction: 1, speed: 120, source, sequence: 2 }, 1200);
  s.tick(2000); expect(s.state.position).toBeCloseTo(.2);
  s.command({ type: 'scroll', direction: -1, speed: 400, source, sequence: 4 }, 2000);
  s.tick(2500); expect(s.state.position).toBe(0);
});
