import { memo, useMemo } from 'react';
import { tokenize } from '../shared/text';
const clean = (s: string) => s.replace(/^\s*\\?---\s*$/gm, '\n\n').replace(/==|\*\*|^#{1,6} /gm, '');
type Segment = { raw: string; gap: string; tail: string; marked: boolean; bold: boolean };
const Word = memo(function Word({ segment, index, current, read, first, onSeek }: { segment: Segment; index: number; current: boolean; read: boolean; first: boolean; onSeek?: (index: number) => void }) {
  return <span>{first ? '' : segment.gap}<span data-word={index} className={`${current ? 'current-word' : ''} ${read ? 'read-word' : ''} ${segment.marked ? 'marked-word' : ''} ${segment.bold ? 'bold-word' : ''}`} onClick={onSeek ? () => onSeek(index) : undefined}>{segment.raw}</span>{segment.tail}</span>;
});
export const WordLayer = memo(function WordLayer({ content, index, start, end, paged, highlight, dimRead, onSeek }: { content: string; index: number; start: number; end: number; paged: boolean; highlight: boolean; dimRead: boolean; onSeek?: (index: number) => void }) {
  const segments = useMemo(() => {
    const words = tokenize(content);
    const marked = [...content.matchAll(/==([\s\S]*?)==/g)].map(m => [m.index, m.index + m[0].length]);
    const bold = [...content.matchAll(/\*\*([\s\S]*?)\*\*/g)].map(m => [m.index, m.index + m[0].length]);
    let mi = 0, bi = 0;
    return words.map((w, i): Segment => {
      while (mi < marked.length && marked[mi][1] < w.end) mi++;
      while (bi < bold.length && bold[bi][1] < w.end) bi++;
      return { raw: w.raw, gap: clean(content.slice(i ? words[i - 1].end : 0, w.start)), tail: i === words.length - 1 ? clean(content.slice(w.end)) : '', marked: !!marked[mi] && w.start >= marked[mi][0] && w.end <= marked[mi][1], bold: !!bold[bi] && w.start >= bold[bi][0] && w.end <= bold[bi][1] };
    });
  }, [content]);
  if (!segments.length) return <div className="prompter-empty"><span className="empty-mark">P<span>_</span></span><p>Your words.<br/>Your pace.</p><small>Open a script and load it in the prompter.</small></div>;
  const first = paged ? start : 0, last = paged ? end : segments.length;
  return <>{segments.slice(first, last).map((segment, offset) => { const i = first + offset; return <Word key={i} segment={segment} index={i} current={highlight && i === index} read={dimRead && i < index} first={paged && i === first} onSeek={onSeek}/>; })}{!paged && <div className="end-mark">— END —</div>}</>;
});
