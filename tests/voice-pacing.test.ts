import { describe, expect, it } from 'vitest';
import { VoicePacing, VoiceActivityGate } from '../shared/voice-pacing';
import { Session } from '../server/session';

const speak = (p: VoicePacing, from: number, to: number) => {
  for (let t = from; t <= to; t += 100) { p.audio(true, t); p.tick(t); }
};
describe('waveform-gated voice preview', () => {
  it('requires both a script match and fresh audio; never advances more than two words', () => {
    const p = new VoicePacing();
    speak(p, 0, 1000); expect(p.preview(0)).toBe(0);
    p.confirm(3, true, 1000); p.tick(1800); expect(p.preview(3)).toBe(3);
    speak(p, 1800, 2800); expect(p.preview(3)).toBe(5);
    speak(p, 2800, 6000); expect(p.preview(3)).toBe(3);
  });
  it('freezes during silence and corrects a wrong preview on recognition', () => {
    const p = new VoicePacing(); p.confirm(3, true, 0); speak(p, 0, 600);
    expect(p.preview(3)).toBe(4);
    p.audio(false, 600); p.tick(1000); expect(p.preview(3)).toBe(4);
    p.confirm(3, false, 1000); expect(p.preview(3)).toBe(3);
    speak(p, 1000, 1600); expect(p.preview(3)).toBe(3);
    p.confirm(4, true, 1600); expect(p.preview(4)).toBe(4);
  });
  it('learns recent speaking pace and discards the old take after reset', () => {
    const p = new VoicePacing(); p.confirm(0, true, 0);
    for (let n = 1; n <= 10; n++) { speak(p, (n - 1) * 2000, n * 2000); p.confirm(n * 8, true, n * 2000); }
    expect(p.wordsPerSecond).toBeGreaterThan(3.5);
    p.reset(); expect(p.wordsPerSecond).toBe(2.2); expect(p.preview(20)).toBe(20);
  });
  it('consumes a correct prediction without jumping backward, but corrects a stalled result', () => {
    const p = new VoicePacing(); p.confirm(3, true, 0); speak(p, 0, 1000);
    expect(p.preview(3)).toBe(5);
    p.confirm(4, true, 1000); expect(p.preview(4)).toBe(5);
    p.confirm(4, true, 1100); expect(p.preview(4)).toBe(4);
  });
  it('learns steady background energy and still detects louder changing speech', () => {
    const gate = new VoiceActivityGate();
    for (let t = 0; t <= 2500; t += 100) gate.sample(.02, t);
    expect(gate.sample(.02, 2600)).toBe(false);
    gate.sample(.09, 2700); expect(gate.sample(.07, 2800)).toBe(true);
    gate.sample(.02, 2900); expect(gate.sample(.02, 3100)).toBe(false);
  });
  it('does not count long audio gaps as speech or train on recognition catch-up bursts', () => {
    const p = new VoicePacing(); p.confirm(0, true, 0); p.audio(true, 0); p.tick(10000);
    expect(p.preview(0)).toBe(0);
    p.confirm(20, true, 10000); expect(p.wordsPerSecond).toBe(2.2);
  });
  it('ignores isolated clicks and releases after a short silent gap', () => {
    const gate = new VoiceActivityGate();
    expect(gate.sample(.1, 0)).toBe(false); expect(gate.sample(0, 90)).toBe(false);
    expect(gate.sample(.04, 200)).toBe(false); expect(gate.sample(.04, 290)).toBe(true);
    expect(gate.sample(0, 350)).toBe(true); expect(gate.sample(0, 500)).toBe(false);
  });
  it('keeps confirmed session progress unchanged and resets preview on seek/pause', () => {
    const s = new Session(); s.load({ id: 'a', title: 'A', content: 'one two three four five six seven eight nine ten' });
    s.command({ type: 'mode', mode: 'voice' }, 0); s.command({ type: 'play' }, 0);
    s.command({ type: 'transcript', text: 'one two three' }, 1000);
    for (let t = 1000; t <= 1800; t += 100) s.command({ type: 'voiceActivity', active: true, transportRevision: s.state.transportRevision }, t);
    expect(s.state.position).toBe(3); expect(s.state.voiceHighlight).toBeGreaterThan(3);
    const revision = s.state.transportRevision;
    s.command({ type: 'seek', position: 4 }, 1900); expect(s.state.voiceHighlight).toBe(4);
    s.command({ type: 'transcript', text: 'five six seven' }, 1900); expect(s.state.position).toBe(7);
    for (let t = 1900; t <= 2400; t += 100) s.command({ type: 'voiceActivity', active: true, transportRevision: revision }, t);
    expect(s.state.voiceHighlight).toBe(7);
    s.command({ type: 'pause' }, 2500); expect(s.state.voiceHighlight).toBe(7);
  });
});
