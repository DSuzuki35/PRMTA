import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { Appearance, SessionState } from '../shared/model';
import { tokenize } from '../shared/text';
import { pagesFor } from '../shared/pages';
import { WordLayer } from './WordLayer';

export function Prompter({ session, appearance, onSeek, fullscreen = false }: { session: SessionState; appearance: Appearance; onSeek?: (index: number) => void; fullscreen?: boolean }) {
  const viewport = useRef<HTMLDivElement>(null); const text = useRef<HTMLDivElement>(null); const target = useRef(0); const y = useRef(0);
  const words = useMemo(() => tokenize(session.script?.content ?? ''), [session.script?.content]);
  const content = session.script?.content ?? '';
  const index = Math.min(Math.floor(session.position), words.length - 1);
  const pages = useMemo(() => pagesFor(content), [content]);
  const pageIndex = Math.max(0, pages.findIndex(p => index >= p.start && index < p.end));
  const page = pages[pageIndex]; const paged = appearance.flow === 'page';
  const measure = () => {
    if (paged && text.current && viewport.current) {
      text.current.style.fontSize = `${appearance.fontSize}px`;
      const scale = Math.min(1, viewport.current.clientHeight * .82 / text.current.scrollHeight);
      text.current.style.fontSize = `${appearance.fontSize * scale}px`;
      target.current = (viewport.current.clientHeight - text.current.scrollHeight) / 2; return;
    }
    if (text.current) text.current.style.fontSize = `${appearance.fontSize}px`;
    const word = text.current?.querySelector<HTMLElement>(`[data-word="${index}"]`);
    if (word && viewport.current) target.current = viewport.current.clientHeight * (appearance.mirrorY ? 1 - appearance.guide / 100 : appearance.guide / 100) - word.offsetTop - word.offsetHeight / 2;
  };
  const measureRef = useRef(measure); measureRef.current = measure;
  useLayoutEffect(() => { measure(); }, [paged ? pageIndex : index, appearance, content]);
  useEffect(() => {
    const observer = new ResizeObserver(() => measureRef.current()); if (viewport.current) observer.observe(viewport.current);
    let active = true;
    void document.fonts.ready.then(() => { if (active) measureRef.current(); });
    const loaded = () => measureRef.current(); document.fonts.addEventListener('loadingdone', loaded);
    return () => { active = false; observer.disconnect(); document.fonts.removeEventListener('loadingdone', loaded); };
  }, []);
  useEffect(() => { y.current = target.current; }, [session.script?.id]);
  useEffect(() => {
    let frame: number; let previous = performance.now();
    const animate = (now: number) => {
      const before = y.current;
      y.current = matchMedia('(prefers-reduced-motion: reduce)').matches ? target.current : Math.abs(target.current - y.current) < .05 ? target.current : y.current + (target.current - y.current) * (1 - Math.exp(-(now - previous) / 150)); previous = now;
      if (text.current && (before !== y.current || !text.current.style.transform)) text.current.style.transform = `translateY(${y.current}px)`;
      frame = requestAnimationFrame(animate);
    }; frame = requestAnimationFrame(animate); return () => cancelAnimationFrame(frame);
  }, []);
  return <div ref={viewport} className={`prompter ${fullscreen ? 'full' : ''} ${appearance.transparent ? 'transparent' : ''}`} style={{ background: appearance.transparent ? 'transparent' : appearance.background, color: appearance.color }}>
    {!paged && <div className="reading-guide" style={{ top: `${appearance.guide}%` }}><span/><span/></div>}
    <div className="mirror-plane" style={{ transform: `scale(${appearance.mirrorX ? -1 : 1},${appearance.mirrorY ? -1 : 1})` }}>
      <div ref={text} className={`prompter-text font-${appearance.font}`} style={{ left: `${(100 - appearance.width) / 2}%`, width: `${appearance.width}%`, fontSize: appearance.fontSize, lineHeight: appearance.lineHeight, textAlign: appearance.align }}>
        <WordLayer content={content} index={index} start={page?.start ?? 0} end={page?.end ?? words.length} paged={paged} highlight={appearance.highlight} dimRead={appearance.dimRead} onSeek={onSeek}/>
      </div>
    </div>
    {paged && page && <div className="page-number">{pageIndex + 1} / {pages.length}</div>}
    {session.countdownUntil > Date.now() && session.playing && <div className="countdown">{Math.ceil((session.countdownUntil - Date.now()) / 1000)}</div>}
    {session.blackout && <div className="blackout-cover"/>}
  </div>;
}
