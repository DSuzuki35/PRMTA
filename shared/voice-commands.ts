import type { ShortcutAction } from './shortcuts';

export type VoiceCommandResult = { consumed: boolean; action?: ShortcutAction };
export type VoiceCommandOptions = { wakeWord?: string; now?: number; utteranceId?: string | number };

const phrases: Record<string, ShortcutAction> = {
  play: 'play', start: 'play', resume: 'play', pause: 'pause', stop: 'pause',
  reset: 'reset', 'back to start': 'reset',
  next: 'nextPage', previous: 'previousPage',
  'next page': 'nextPage', 'previous page': 'previousPage',
  'next sentence': 'nextSentence', 'previous sentence': 'previousSentence',
  'next paragraph': 'nextParagraph', 'previous paragraph': 'previousParagraph',
  'next chapter': 'nextChapter', 'previous chapter': 'previousChapter',
  'speed up': 'speedUp', faster: 'speedUp', 'slow down': 'speedDown', slower: 'speedDown',
  blackout: 'blackout', 'toggle blackout': 'blackout',
  'voice mode': 'modeVoice', 'mode voice': 'modeVoice',
  'auto mode': 'modeTimed', 'mode auto': 'modeTimed', 'timed mode': 'modeTimed',
  'manual mode': 'modeManual', 'mode manual': 'modeManual',
};
const normalizePhrase = (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' ');
const tokens = (text: string) => normalizePhrase(text).match(/[\p{L}\p{N}]+/gu) ?? [];

export function parseVoiceCommand(text: string, wakeWord = 'prompta'): VoiceCommandResult {
  const normalized = normalizePhrase(text), wake = normalizePhrase(wakeWord);
  if (!wake) return { consumed: false };
  const aliases = ['prompta', 'prmta', 'prompt a'].includes(wake) ? ['prompta', 'prmta', 'prompt a'] : [wake];
  // No searching inside prose or removing quotes: an addressed command must be
  // the complete clause, beginning with its explicit wake phrase.
  const separators = '[\\s,.:!?;\\-–—]';
  const prefix = aliases.map(alias => {
    const parts = alias.split(/[\s,.:!?;\-–—]+/).filter(Boolean).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return parts.length ? normalized.match(new RegExp(`^${parts.join(`${separators}+`)}(?=$|${separators})`))?.[0] : undefined;
  }).find(Boolean);
  if (!prefix) return { consumed: false };
  const command = normalized.slice(prefix.length).replace(/^[\s,:.!?;\-–—]+|[\s.!?]+$/g, '');
  const action = Object.hasOwn(phrases, command) ? phrases[command] : undefined;
  return action ? { consumed: true, action } : { consumed: true };
}

/**
 * Keep one gate for the microphone session, including pause, seek and ASR
 * restarts. utteranceId identifies fresh audio, not a request, result index, or
 * transport revision. The caller must flush rolling PCM at a real utterance
 * boundary and discard responses from audio captured before that boundary.
 */
export class VoiceCommandGate {
  private active = false;
  private quietSince: number | undefined;
  private boundary = 0;
  private utterances = new Map<string | number, number>();
  private actions = new Map<ShortcutAction, number>();
  private fragments: { boundary: number; words: string[] }[] = [];

  consume(text: string, options: VoiceCommandOptions = {}): VoiceCommandResult {
    const { utteranceId } = options;
    let boundary = 0;
    if (utteranceId !== undefined) {
      const known = this.utterances.get(utteranceId);
      if (known !== undefined && known < this.boundary) return { consumed: true };
      boundary = known ?? this.boundary;
      this.utterances.set(utteranceId, boundary);
    }
    const parsed = parseVoiceCommand(text, options.wakeWord);
    const words = tokens(text);
    if (!parsed.consumed) {
      // Rolling windows can drop the wake word while retaining the command's
      // tail. Suppress that exact suffix without swallowing unrelated prose.
      const remnant = words.length > 0 && this.fragments.some(fragment => fragment.boundary === boundary && words.length <= fragment.words.length && words.every((word, index) => word === fragment.words[fragment.words.length - words.length + index]));
      return { consumed: remnant };
    }
    this.fragments.push({ boundary, words });
    if (this.fragments.length > 32) this.fragments.shift();
    if (!parsed.action || this.actions.get(parsed.action) === boundary) return { consumed: true };
    this.actions.set(parsed.action, boundary);
    return parsed;
  }

  observeVoiceActivity(active: boolean, now = Date.now()): void {
    if (!active) this.quietSince ??= now;
    else if (!this.active) {
      if (this.quietSince !== undefined && now - this.quietSince >= 650) this.boundary++;
      this.quietSince = undefined;
    }
    this.active = active;
  }

  /** Explicit microphone/session reset only; never call for navigation/pause. */
  reset(): void {
    this.active = false; this.quietSince = undefined; this.boundary = 0;
    this.utterances.clear(); this.actions.clear(); this.fragments = [];
  }
}
