import { tokenize, type Word } from './text';

function substitution(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.min(a.length, b.length) < 4) return 1;
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length] / Math.max(a.length, b.length) <= .28 ? .4 : 1;
}
/** `content` may be raw text or tokens already produced by `tokenize(content)` (lets callers cache them). */
export function alignTranscript(content: string | readonly Word[], transcript: string, position: number): { position: number; confidence: number; matched: boolean } {
  const spoken = tokenize(transcript).map(w => w.normalized).filter(w => !['ah', 'ahm', 'uh', 'um', 'hm'].includes(w)).slice(-28);
  const all = typeof content === 'string' ? tokenize(content) : content; const low = Math.max(0, Math.floor(position) - 32);
  const script = all.slice(low, Math.floor(position) + 72).map(w => w.normalized);
  if (spoken.length < 3 || !script.length) return { position, confidence: 0, matched: false };
  let row = new Array(script.length + 1).fill(0);
  let starts = Array.from({ length: script.length + 1 }, (_, index) => index);
  for (let i = 1; i <= spoken.length; i++) {
    const next = [i * .9];
    const nextStarts = [0];
    for (let j = 1; j <= script.length; j++) {
      let cost = row[j - 1] + substitution(spoken[i - 1], script[j - 1]), start = starts[j - 1];
      if (row[j] + .9 < cost) { cost = row[j] + .9; start = starts[j]; }
      if (next[j - 1] + .9 < cost) { cost = next[j - 1] + .9; start = nextStarts[j - 1]; }
      next[j] = cost; nextStarts[j] = start;
    }
    row = next; starts = nextStarts;
  }
  let best = { score: -Infinity, confidence: 0, end: position };
  const omissionAllowance = Math.min(6, spoken.length);
  for (let j = 1; j <= script.length; j++) {
    const confidence = Math.max(0, 1 - row[j] / spoken.length);
    // Recognition follows the reading position; it must not act as a script-wide seek.
    // Allow a few omitted words, overlapping audio, and at most one short window of progress.
    const end = low + j; const distance = Math.abs(end - position);
    if (end > position && (low + starts[j] > Math.floor(position) + omissionAllowance || end - position > Math.min(24, spoken.length + omissionAllowance))) continue;
    const score = confidence - distance * .003;
    if (score > best.score) best = { score, confidence, end };
  }
  const matched = best.confidence >= .7 && best.score >= .58;
  return { position: matched ? Math.max(position, best.end) : position, confidence: best.confidence, matched };
}
