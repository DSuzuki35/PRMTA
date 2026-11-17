import { describe, it, expect } from 'vitest';
import { tokenize } from '../shared/text';
import { alignTranscript } from '../shared/matcher';
import { Session } from '../server/session';

describe('speech alignment', () => {
  const script = 'Willkommen zu diesem neuen Video. Heute zeigen wir euch unsere besten Tipps für einen richtig guten Start.';
  it('tracks words despite fillers, missing words and minor variations', () => {
    const result = alignTranscript(script, 'willkommen zu dem neuen video äh heute zeigen wir unsere besten tipps', 0);
    expect(result.matched).toBe(true); expect(result.position).toBe(12); expect(result.confidence).toBeGreaterThan(.65);
  });
  it('holds during unrelated improvisation and silence', () => {
    expect(alignTranscript(script, 'Mein Hund möchte jetzt spazieren gehen', 6).matched).toBe(false);
    expect(alignTranscript(script, '', 6).position).toBe(6);
  });
  it('prefers the nearby occurrence of repeated phrases', () => {
    const text = 'Das ist unser neuer Plan. Jetzt erklären wir die Details. Das ist unser neuer Plan.';
    expect(alignTranscript(text, 'das ist unser neuer plan', 0).position).toBe(5);
    expect(alignTranscript(text, 'das ist unser neuer plan', 11).position).toBe(15);
  });
  it('does not leap for one common word or move backward on overlapping transcript', () => {
    expect(alignTranscript(script, 'wir', 0).matched).toBe(false);
    expect(alignTranscript(script, 'willkommen zu diesem neuen video', 7).position).toBe(7);
  });
  it('retains original offsets and normalizes German words', () => {
    const words = tokenize('Grüße,\n\nSTRAẞE!');
    expect(words.map(w => w.normalized)).toEqual(['grusse', 'strasse']);
    expect(words[1].paragraph).toBe(1); expect(words[1].start).toBe(8);
  });
});
describe('playback', () => {
  const make = () => { const s = new Session(); s.load({ id: 'a', title: 'A', content: 'eins zwei drei vier fünf sechs sieben acht neun zehn' }); return s; };
  it('respects countdown then advances with WPM and pauses deterministically', () => {
    const s = make(); s.command({ type: 'play', countdown: 2 }, 1000); s.tick(2000); expect(s.state.position).toBe(0);
    s.tick(4000); expect(s.state.position).toBe(2); s.command({ type: 'pause' }, 4000); s.tick(5000); expect(s.state.position).toBe(2);
  });
  it('clamps seek, stops at the end and loops only when enabled', () => {
    const s = make(); s.command({ type: 'seek', position: -4 }); expect(s.state.position).toBe(0);
    s.command({ type: 'seek', position: 100 }); expect(s.state.position).toBe(9);
    s.command({ type: 'play' }, 1000); s.tick(10000); expect(s.state.playing).toBe(false);
    s.command({ type: 'reset' }); s.command({ type: 'loop', loop: true }); s.command({ type: 'play' }, 1000); s.tick(7000); expect(s.state.playing).toBe(true); expect(s.state.position).toBe(2);
  });
  it('voice mode never moves with the clock alone and ignores transcripts when paused', () => {
    const s = make(); s.command({ type: 'mode', mode: 'voice' }); s.command({ type: 'play' }, 1000); s.tick(4000); expect(s.state.position).toBe(0);
    s.command({ type: 'pause' }); s.command({ type: 'transcript', text: 'eins zwei drei vier' }); expect(s.state.position).toBe(0);
  });
});
