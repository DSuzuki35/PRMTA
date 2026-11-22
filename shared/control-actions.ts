import type { Command, SessionState } from './model';
import type { ShortcutAction } from './shortcuts';

export function controlCommand(action: ShortcutAction, state: SessionState, keepVoiceActive: boolean): Command | null {
  const navigation: Partial<Record<ShortcutAction, ['sentence' | 'paragraph' | 'page' | 'chapter', -1 | 1]>> = {
    previousSentence: ['sentence', -1], nextSentence: ['sentence', 1], previousParagraph: ['paragraph', -1], nextParagraph: ['paragraph', 1],
    previousPage: ['page', -1], nextPage: ['page', 1], previousChapter: ['chapter', -1], nextChapter: ['chapter', 1],
  };
  const target = navigation[action];
  if (target) return { type: 'navigate', unit: target[0], direction: target[1], keepVoiceActive };
  switch (action) {
    case 'togglePlay': return { type: state.playing ? 'pause' : 'play' };
    case 'play': return { type: 'play' };
    case 'pause': return { type: 'pause' };
    case 'reset': return { type: 'reset' };
    case 'previousWord': return { type: 'step', words: -1 };
    case 'nextWord': return { type: 'step', words: 1 };
    case 'speedUp': return { type: 'speed', speed: Math.min(400, state.speed + 5) };
    case 'speedDown': return { type: 'speed', speed: Math.max(20, state.speed - 5) };
    case 'blackout': return { type: 'blackout' };
    case 'modeVoice': return { type: 'mode', mode: 'voice' };
    case 'modeTimed': return { type: 'mode', mode: 'timed' };
    case 'modeManual': return { type: 'mode', mode: 'manual' };
    case 'loop': return { type: 'loop', loop: !state.loop };
    default: return null;
  }
}
