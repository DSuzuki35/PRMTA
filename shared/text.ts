export type Word = { raw: string; normalized: string; start: number; end: number; paragraph: number };
export function normalize(text: string): string { return text.toLocaleLowerCase().replace(/ß/g, 'ss').normalize('NFD').replace(/\p{M}/gu, ''); }
export function tokenize(content: string): Word[] {
  const words: Word[] = []; let paragraph = 0; let previousEnd = 0;
  for (const match of content.matchAll(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu)) {
    if (/\n\s*\n/.test(content.slice(previousEnd, match.index))) paragraph++;
    words.push({ raw: match[0], normalized: normalize(match[0]), start: match.index, end: match.index + match[0].length, paragraph });
    previousEnd = match.index + match[0].length;
  }
  return words;
}
export function formatTime(seconds: number): string { const s = Math.max(0, Math.floor(seconds)); return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`; }
