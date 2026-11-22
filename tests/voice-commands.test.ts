import { describe, expect, it } from 'vitest';
import { parseVoiceCommand, VoiceCommandGate } from '../shared/voice-commands';

describe('voice command parsing', () => {
  it.each([
    ['Prompta, next sentence.', 'nextSentence'], ['PRMTA: previous paragraph!', 'previousParagraph'],
    ['prompt a next chapter', 'nextChapter'], ['prompta previous chapter', 'previousChapter'],
    ['prompta next', 'nextPage'], ['prompta previous', 'previousPage'],
    ['prompta next page', 'nextPage'], ['prompta previous page', 'previousPage'],
    ['prompta next paragraph', 'nextParagraph'], ['prompta previous sentence', 'previousSentence'],
    ['prompta play', 'play'], ['prompta start', 'play'], ['prompta resume', 'play'],
    ['prompta pause', 'pause'], ['prompta stop', 'pause'],
    ['prompta reset', 'reset'], ['prompta back to start', 'reset'],
    ['prompta speed up', 'speedUp'], ['prompta slower', 'speedDown'],
    ['prompta blackout', 'blackout'], ['prompta voice mode', 'modeVoice'],
    ['prompta auto mode', 'modeTimed'], ['prompta manual mode', 'modeManual'],
  ])('maps the complete command %s', (text, action) => {
    expect(parseVoiceCommand(text)).toEqual({ consumed: true, action });
  });

  it.each(['next page', 'Please say prompta next page', 'We use prompta, next sentence.', '"prompta next"', '“prompta pause”', 'promptastic next', 'prmtable pause', ''])('leaves ordinary or quoted speech alone: %s', text => {
    expect(parseVoiceCommand(text)).toEqual({ consumed: false });
  });

  it.each(['prompta', 'prompt a', 'prompta nex', 'prompta go bananas', 'prompta next sentence is our example', 'prompta pause; delete everything', 'prompta "next page"'])('suppresses incomplete or unrecognized addressed speech: %s', text => {
    expect(parseVoiceCommand(text)).toEqual({ consumed: true });
  });

  it('uses an explicitly configured wake phrase without treating it as a regular expression', () => {
    expect(parseVoiceCommand('studio pilot, next page', 'Studio Pilot')).toEqual({ consumed: true, action: 'nextPage' });
    expect(parseVoiceCommand('prompta next', 'Studio Pilot')).toEqual({ consumed: false });
    expect(parseVoiceCommand('anything next', '.*')).toEqual({ consumed: false });
  });

  it('accepts ASR punctuation inside a multiword wake phrase without accepting quotes or embedded prose', () => {
    expect(parseVoiceCommand('Hey, Prompta, next page.', 'hey prompta')).toEqual({ consumed: true, action: 'nextPage' });
    expect(parseVoiceCommand('Hey—Prompta: pause', 'hey prompta')).toEqual({ consumed: true, action: 'pause' });
    expect(parseVoiceCommand('Hey Prompta — next sentence', 'hey-prompta')).toEqual({ consumed: true, action: 'nextSentence' });
    expect(parseVoiceCommand('He said hey, prompta, next page', 'hey prompta')).toEqual({ consumed: false });
    expect(parseVoiceCommand('“Hey, Prompta, next page”', 'hey prompta')).toEqual({ consumed: false });
    expect(parseVoiceCommand('Hey "Prompta" next page', 'hey prompta')).toEqual({ consumed: false });
  });
});

describe('voice command deduplication', () => {
  it('suppresses rolling repeats indefinitely without delaying distinct commands', () => {
    const gate = new VoiceCommandGate();
    expect(gate.consume('prompta next', { now: 0, utteranceId: 1 }).action).toBe('nextPage');
    expect(gate.consume('prompta next page', { now: 500, utteranceId: 1 })).toEqual({ consumed: true });
    expect(gate.consume('prompta previous', { now: 600, utteranceId: 1 }).action).toBe('previousPage');
    expect(gate.consume('prompta next', { now: 20000, utteranceId: 1 })).toEqual({ consumed: true });
  });

  it('does not rearm when an ASR restart changes its result identity', () => {
    const gate = new VoiceCommandGate();
    gate.consume('prompta next', { utteranceId: 1 });
    expect(gate.consume('prompta next', { utteranceId: 2 })).toEqual({ consumed: true });
  });

  it('requires a fresh speech boundary and fresh utterance identity to repeat a command', () => {
    const gate = new VoiceCommandGate();
    gate.observeVoiceActivity(true, 0);
    gate.consume('prompta next', { now: 100, utteranceId: 1 });
    gate.observeVoiceActivity(false, 200);
    gate.observeVoiceActivity(true, 900);
    expect(gate.consume('prompta next', { now: 950, utteranceId: 1 })).toEqual({ consumed: true });
    expect(gate.consume('prompta next', { now: 1000, utteranceId: 2 }).action).toBe('nextPage');
    expect(gate.consume('prompta previous', { now: 1100, utteranceId: 1 })).toEqual({ consumed: true });
  });

  it('ignores short interword silence and never passes command remnants to script matching', () => {
    const gate = new VoiceCommandGate();
    gate.observeVoiceActivity(true, 0);
    gate.consume('prompta next sentence', { now: 100, utteranceId: 1 });
    gate.observeVoiceActivity(false, 200);
    gate.observeVoiceActivity(true, 250);
    expect(gate.consume('prompta next sentence', { now: 300, utteranceId: 2 })).toEqual({ consumed: true });
    expect(gate.consume('next sentence', { now: 400, utteranceId: 2 })).toEqual({ consumed: true });
    expect(gate.consume('The next sentence belongs to our script', { now: 500, utteranceId: 2 })).toEqual({ consumed: false });
  });

  it('keeps pause/resume commands working while rejecting late command extensions', () => {
    const gate = new VoiceCommandGate();
    expect(gate.consume('prompta pause', { utteranceId: 1 }).action).toBe('pause');
    expect(gate.consume('prompta resume', { utteranceId: 1 }).action).toBe('play');
    expect(gate.consume('prompta resume continue from here', { utteranceId: 1 })).toEqual({ consumed: true });
  });

  it('clears command history only for an explicit session reset', () => {
    const gate = new VoiceCommandGate();
    gate.consume('prompta next');
    gate.reset();
    expect(gate.consume('prompta next').action).toBe('nextPage');
  });
});
