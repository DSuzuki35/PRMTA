import { memo, useMemo } from 'react';
import { maskStageDirections, stageDirectionParts, tokenize } from '../shared/text';
const clean = (s: string) => stageDirectionParts(s).map(part => part.direction ? part.text : part.text.replace(/^\s*\\?---\s*$/gm, '\n\n').replace(/==|\*\*|^#{1,6} /gm, '')).join('');
const CueText = memo(function CueText({ text, show }: { text: string; show: boolean }) {
  return <>{stageDirectionParts(text).map((part, i) => part.direction ? (show ? <span key={i} className="stage-direction" title="Stage direction (optional to read)">{part.text}</span> : ' ') : part.text)}</>;
});
type Segment = { raw: string; gap: string; tail: string; marked: boolean; bold: boolean };
const Word = memo(function Word({ segment, index, current, read, first, showStageDirections, onSeek }: { segment: Segment; index: number; current: boolean; read: boolean; first: boolean; showStageDirections: boolean; onSeek?: (index: number) => void }) {
  return <span><CueText text={first ? segment.gap.trimStart() : segment.gap} show={showStageDirections}/><span data-word={index} className={`${current ? 'current-word' : ''} ${read ? 'read-word' : ''} ${segment.marked ? 'marked-word' : ''} ${segment.bold ? 'bold-word' : ''}`} onClick={onSeek ? () => onSeek(index) : undefined}>{segment.raw}</span><CueText text={segment.tail} show={showStageDirections}/></span>;
});
export const WordLayer = memo(function WordLayer({ content, index, highlightIndex = index, start, end, paged, highlight, dimRead, showStageDirections = true, onSeek }: { content: string; index: number; highlightIndex?: number; start: number; end: number; paged: boolean; highlight: boolean; dimRead: boolean; showStageDirections?: boolean; onSeek?: (index: number) => void }) {
  const segments = useMemo(() => {
    const words = tokenize(content);
    const spoken = maskStageDirections(content);
    const marked = [...spoken.matchAll(/==([\s\S]*?)==/g)].map(m => [m.index, m.index + m[0].length]);
    const bold = [...spoken.matchAll(/\*\*([\s\S]*?)\*\*/g)].map(m => [m.index, m.index + m[0].length]);
    const gaps = words.map((w, i) => {
      const raw = content.slice(i ? words[i - 1].end : 0, w.start);
      // Respect explicit page breaks: closing cues stay on their original page.
      const separator = maskStageDirections(raw).match(/^[\t ]*\\?---[\t ]*\r?$/m);
      if (i && separator) return { leading: clean(raw.slice(separator.index)), trailing: clean(raw.slice(0, separator.index)).trimEnd() };
      const gap = clean(raw);
      // Inline cues belong to the following word, even without separating spaces.
      const punctuation = i ? gap.match(/^[^\s\[]*/u)![0] : '';
      return { leading: gap.slice(punctuation.length), trailing: punctuation };
    });
    let mi = 0, bi = 0;
    return words.map((w, i): Segment => {
      while (mi < marked.length && marked[mi][1] < w.end) mi++;
      while (bi < bold.length && bold[bi][1] < w.end) bi++;
      return { raw: w.raw, gap: gaps[i].leading, tail: i === words.length - 1 ? clean(content.slice(w.end)) : gaps[i + 1].trailing, marked: !!marked[mi] && w.start >= marked[mi][0] && w.end <= marked[mi][1], bold: !!bold[bi] && w.start >= bold[bi][0] && w.end <= bold[bi][1] };
    });
  }, [content]);
  if (!segments.length && stageDirectionParts(content).some(part => part.direction)) return <CueText text={clean(content)} show={showStageDirections}/>;
  if (!segments.length) return <div className="prompter-empty"><span className="empty-mark">P<span>_</span></span><p>Your words.<br/>Your pace.</p><small>Open a script and load it in the prompter.</small></div>;
  const first = start, last = end;
  return <>{segments.slice(first, last).map((segment, offset) => { const i = first + offset; return <Word key={i} segment={segment} index={i} current={highlight && i === highlightIndex} read={dimRead && i < index} first={i === first} showStageDirections={showStageDirections} onSeek={onSeek}/>; })}{!paged && last >= segments.length && <div className="end-mark">END</div>}</>;
});
