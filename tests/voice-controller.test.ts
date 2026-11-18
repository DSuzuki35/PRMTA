import { describe, expect, it } from 'vitest';
import { Session } from '../server/session';
import { commandSchema, defaultPreferences, preferencesSchema, type Command } from '../shared/model';

const source = 'bb743384-4141-4698-9212-946b4121e965';
const content = 'one two three. Four five six.\n\nSeven eight nine.\n---\nTen eleven twelve. Thirteen fourteen fifteen.';
const create = (playing = true) => {
  const session = new Session(); session.load({ id: 'voice', title: 'Voice', content });
  session.command({ type: 'mode', mode: 'voice' }, 1000);
  if (playing) session.command({ type: 'play' }, 1000);
  return session;
};
const scroll = (direction: -1 | 0 | 1, sequence: number, keepVoiceActive = true): Command => ({ type: 'scroll', direction, sequence, source, speed: 120, keepVoiceActive });

it('defaults migrated controller preferences to background and preserved voice, while legacy commands still pause', () => {
  const { gamepadKeepVoiceActive: _voice, gamepadBackground: _background, ...old } = defaultPreferences;
  const migrated = preferencesSchema.parse(old);
  expect(migrated.gamepadKeepVoiceActive).toBe(true); expect(migrated.gamepadBackground).toBe(true);
  expect(commandSchema.safeParse({ type: 'navigate', unit: 'page', direction: 1 }).success).toBe(true);
  expect(commandSchema.safeParse({ ...scroll(1, 1), keepVoiceActive: 'yes' }).success).toBe(false);
});
describe('controller with voice follow', () => {
  it.each([['sentence', 3], ['paragraph', 6], ['page', 9]] as const)('keeps playing across a %s skip and accepts only fresh speech at the new position', (unit, position) => {
    const session = create(); const oldRevision = session.state.transportRevision;
    session.command({ type: 'navigate', unit, direction: 1, keepVoiceActive: true }, 1000);
    expect(session.state.playing).toBe(true); expect(session.state.position).toBe(position);
    expect(session.state.voiceHighlight).toBe(position); expect(session.state.transportRevision).toBeGreaterThan(oldRevision);
    session.command({ type: 'transcript', text: 'one two three', transportRevision: oldRevision }, 1000);
    expect(session.state.position).toBe(position);
    const text = unit === 'sentence' ? 'Four five six' : unit === 'paragraph' ? 'Seven eight nine' : 'Ten eleven twelve';
    session.command({ type: 'transcript', text, transportRevision: session.state.transportRevision }, 1000);
    expect(session.state.position).toBe(position + 3);
  });
  it('preserves an existing countdown and never starts a paused voice session', () => {
    const session = create(false);
    session.command({ type: 'navigate', unit: 'page', direction: 1, keepVoiceActive: true }, 1000);
    expect(session.state.playing).toBe(false);
    session.command({ type: 'play', countdown: 3 }, 1000);
    session.command({ type: 'navigate', unit: 'sentence', direction: 1, keepVoiceActive: true }, 1200);
    expect(session.state.playing).toBe(true); expect(session.state.countdownUntil).toBe(4000);
  });
  it('forgets the previous phrase across a reverse navigation and hold boundary', () => {
    const session = create();
    session.command({ type: 'transcript', text: 'one two three', transportRevision: session.state.transportRevision }, 1000);
    expect(session.state.position).toBe(3);
    session.command({ type: 'navigate', unit: 'sentence', direction: -1, keepVoiceActive: true }, 1000);
    expect(session.state.position).toBe(0);
    session.command(scroll(1, 1), 1000);
    const heldRevision = session.state.transportRevision;
    session.command(scroll(1, 2), 1200); expect(session.state.transportRevision).toBe(heldRevision);
    session.command(scroll(0, 3), 1300);
    session.command({ type: 'transcript', text: 'one two three', transportRevision: session.state.transportRevision }, 1300);
    expect(session.state.position).toBe(3);
  });
  it.each(['release', 'expiry'] as const)('keeps capture active during a hold and resumes fresh matching after %s', ending => {
    const session = create(); session.command(scroll(1, 1), 1000);
    const heldRevision = session.state.transportRevision;
    expect(session.state.playing).toBe(true); expect(session.state.manualScrollActive).toBe(true);
    session.command({ type: 'transcript', text: 'Seven eight nine', transportRevision: heldRevision }, 1200);
    expect(session.state.position).toBeCloseTo(.4);
    session.command({ type: 'voiceActivity', active: true, transportRevision: heldRevision }, 1250);
    expect(session.state.voiceHighlight).toBe(session.state.position);
    if (ending === 'release') session.command(scroll(0, 2), 1500); else session.tick(1700);
    expect(session.state.position).toBeCloseTo(ending === 'release' ? 1 : 1.2);
    expect(session.state.playing).toBe(true); expect(session.state.manualScroll).toBe(false); expect(session.state.manualScrollActive).toBe(false);
    expect(session.state.transportRevision).toBeGreaterThan(heldRevision);
    const position = session.state.position;
    session.command({ type: 'transcript', text: 'Seven eight nine', transportRevision: heldRevision }, 1800);
    expect(session.state.position).toBe(position);
    session.command({ type: 'transcript', text: 'one two three', transportRevision: session.state.transportRevision }, 1800);
    expect(session.state.position).toBe(3);
  });
  it.each(['pause', 'reset', 'mode', 'load'] as const)('does not restore voice after an explicit %s during the hold', action => {
    const session = create(); session.command(scroll(1, 1), 1000);
    if (action === 'load') session.load({ id: 'new', title: 'New', content });
    else session.command(action === 'mode' ? { type: 'mode', mode: 'manual' } : { type: action }, 1200);
    session.command(scroll(0, 2), 1300); session.tick(2000);
    if (action === 'mode') expect(session.state.mode).toBe('manual'); else expect(session.state.playing).toBe(false);
    const position = session.state.position;
    session.command({ type: 'transcript', text: 'Ten eleven twelve', transportRevision: session.state.transportRevision }, 2100);
    expect(session.state.position).toBe(position);
  });
  it('retains pause behavior for opt-out, timed mode, and initially paused voice', () => {
    for (const mode of ['voice', 'timed'] as const) {
      const session = create(); session.command({ type: 'mode', mode }, 1000);
      session.command({ type: 'navigate', unit: 'page', direction: 1, keepVoiceActive: mode !== 'voice' }, 1000);
      expect(session.state.playing).toBe(false);
    }
    const session = create(); session.command(scroll(1, 1, false), 1000); session.command(scroll(0, 2), 1200);
    expect(session.state.playing).toBe(false); expect(session.state.manualScroll).toBe(true);
    const paused = create(false); paused.command(scroll(1, 1), 1000); paused.command(scroll(0, 2), 1200);
    expect(paused.state.playing).toBe(false);
  });
  it('handles empty scripts without starting voice or moving beyond zero', () => {
    const session = new Session(); session.command({ type: 'mode', mode: 'voice' }, 1000);
    session.command({ type: 'navigate', unit: 'page', direction: 1, keepVoiceActive: true }, 1000);
    session.command(scroll(1, 1), 1000); session.tick(1700);
    expect(session.state.playing).toBe(false); expect(session.state.position).toBe(0);
  });
});
