export type Word = { raw: string; normalized: string; start: number; end: number; paragraph: number };
/** Split balanced cues once so rendering and speech share the same bracket rules. */
export function stageDirectionParts(content: string): { text: string; direction: boolean }[] {
  const parts: { text: string; direction: boolean }[] = [];
  let depth = 0, start = 0, previous = 0;
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '[') { if (depth++ === 0) start = i; }
    else if (content[i] === ']' && depth > 0 && --depth === 0) {
      if (start > previous) parts.push({ text: content.slice(previous, start), direction: false });
      parts.push({ text: content.slice(start, i + 1), direction: true });
      previous = i + 1;
    }
  }
  // Unclosed brackets remain narration, including any incomplete nested cue.
  if (previous < content.length) parts.push({ text: content.slice(previous), direction: false });
  return parts;
}
/** Preserve source offsets, but exclude complete production cues from spoken text. */
export function maskStageDirections(content: string): string {
  return stageDirectionParts(content).map(part => part.direction ? ' '.repeat(part.text.length) : part.text).join('');
}
export function normalize(text: string): string { return text.toLocaleLowerCase().replace(/ß/g, 'ss').normalize('NFD').replace(/\p{M}/gu, ''); }
export function tokenize(content: string): Word[] {
  content = maskStageDirections(content);
  const words: Word[] = []; let paragraph = 0; let previousEnd = 0;
  for (const match of content.matchAll(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu)) {
    if (/\n\s*\n/.test(content.slice(previousEnd, match.index))) paragraph++;
    words.push({ raw: match[0], normalized: normalize(match[0]), start: match.index, end: match.index + match[0].length, paragraph });
    previousEnd = match.index + match[0].length;
  }
  return words;
}
export function formatTime(seconds: number): string { const s = Math.max(0, Math.floor(seconds)); return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`; }
