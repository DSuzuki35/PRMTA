import { tokenize } from './text';
export type ScriptPage = { start: number; end: number };
const targetWords = 60;
const abbreviations = new Set(['mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'nr', 'bzw', 'ca']);
const compoundAbbreviations = new Set(['z:b', 'e:g', 'i:e', 'u:a']);
export function pagesFor(content: string): ScriptPage[] {
  const chunks = content.split(/^\s*\\?---\s*$/m); const pages: ScriptPage[] = []; let offset = 0;
  if (chunks.length > 1) {
    for (const chunk of chunks) { const count = tokenize(chunk).length; if (count) pages.push({ start: offset, end: offset + count }); offset += count; }
    return pages;
  }
  const words = tokenize(content); if (!words.length) return [];
  const units: ScriptPage[] = []; const longSentenceStarts = new Set<number>(); let sentenceStart = 0; let clauses: number[] = [];
  for (let i = 0; i < words.length; i++) {
    const gap = content.slice(words[i].end, words[i + 1]?.start ?? content.length).replace(/==|\*\*/g, '');
    const adjacentNumber = !!words[i + 1] && /^\d+$/.test(words[i].raw) && /^\d+$/.test(words[i + 1].raw) && /^[.,:]$/.test(gap);
    if (!adjacentNumber && /[,;:—–]/u.test(gap)) clauses.push(i + 1);
    const compound = (i > 0 && compoundAbbreviations.has(`${words[i - 1].normalized}:${words[i].normalized}`) && /^\.\s*$/.test(content.slice(words[i - 1].end, words[i].start))) || (!!words[i + 1] && compoundAbbreviations.has(`${words[i].normalized}:${words[i + 1].normalized}`) && /^\.\s*$/.test(gap));
    const sentenceEnd = /[!?…]/u.test(gap) || (/\./.test(gap) && !adjacentNumber && !abbreviations.has(words[i].normalized) && !compound && (!words[i + 1] || /\s/.test(gap)));
    if (!sentenceEnd && i < words.length - 1) continue;
    const end = i + 1;
    if (end - sentenceStart > targetWords) {
      longSentenceStarts.add(sentenceStart);
      let start = sentenceStart;
      for (const boundary of clauses) { if (boundary > start && boundary < end) { units.push({ start, end: boundary }); start = boundary; } }
      units.push({ start, end });
    } else units.push({ start: sentenceStart, end });
    sentenceStart = end; clauses = [];
  }
  // Pack complete sentences; only overlong sentences may be split into clauses.
  let start = 0, end = 0;
  for (const unit of units) {
    if (end > start && (longSentenceStarts.has(unit.start) || unit.end - start > targetWords)) { pages.push({ start, end }); start = end; }
    end = unit.end;
  }
  if (end > start) pages.push({ start, end });
  return pages;
}
