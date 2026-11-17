import { tokenize } from './text';
export type ScriptPage = { start: number; end: number };
export function pagesFor(content: string): ScriptPage[] {
  const chunks = content.split(/^\s*\\?---\s*$/m); const pages: ScriptPage[] = []; let offset = 0;
  if (chunks.length > 1) {
    for (const chunk of chunks) { const count = tokenize(chunk).length; if (count) pages.push({ start: offset, end: offset + count }); offset += count; }
  } else { const count = tokenize(content).length; for (let start = 0; start < count; start += 60) pages.push({ start, end: Math.min(start + 60, count) }); }
  return pages;
}
