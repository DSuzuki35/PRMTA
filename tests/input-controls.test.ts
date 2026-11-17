import { expect, it } from 'vitest';
import { ButtonCapture } from '../shared/gamepad';
import { audioLevels } from '../shared/audio';
const pad = (pressed: boolean[], index = 0, id = 'test pad') => ({ index, id, buttons: pressed.map(pressed => ({ pressed })) });
it('captures only a complete released-pressed-released button cycle', () => {
  const capture = new ButtonCapture();
  expect(capture.sample([pad([true, false])])).toBeNull();
  expect(capture.sample([pad([false, false])])).toBeNull();
  expect(capture.sample([pad([false, true])])).toBeNull();
  expect(capture.sample([pad([false, true])])).toBeNull();
  expect(capture.sample([pad([false, false])])?.button).toBe(1);
});
it('ignores stuck buttons and never treats a disconnect as a release', () => {
  const capture = new ButtonCapture();
  capture.sample([pad([true, false])]); capture.sample([pad([true, true])]);
  expect(capture.sample([])).toBeNull();
  expect(capture.sample([pad([true, false])])).toBeNull();
  capture.sample([pad([true, true])]);
  expect(capture.sample([pad([true, false])])?.button).toBe(1);
});
it('does not transfer press state to a replacement device on the same slot', () => {
  const capture = new ButtonCapture(); capture.sample([pad([false])]); capture.sample([pad([true])]);
  expect(capture.sample([pad([false], 0, 'replacement')])).toBeNull();
});
it('reports silence, RMS dBFS and clipped peaks without non-finite values', () => {
  expect(audioLevels(new Float32Array(10))).toEqual({ db: -60, peakDb: -60, clipped: false });
  expect(audioLevels(new Float32Array([.5, -.5])).db).toBeCloseTo(-6.0206, 3);
  expect(audioLevels(new Float32Array([1, -.1])).clipped).toBe(true);
});


import { Session } from '../server/session';
it('rejects an in-flight transcript after navigation from another controller', () => {
  const session = new Session();
  session.load({ id: 'fixture', title: 'Fixture', content: 'One two three four five six seven eight nine ten.' });
  session.command({ type: 'mode', mode: 'voice' }); session.command({ type: 'play', countdown: 0 });
  const revision = session.state.transportRevision;
  session.command({ type: 'seek', position: 0 });
  session.command({ type: 'transcript', text: 'one two three four five', transportRevision: revision });
  expect(session.state.position).toBe(0);
  session.command({ type: 'transcript', text: 'one two three four five', transportRevision: session.state.transportRevision });
  expect(session.state.position).toBeGreaterThan(0);
});
