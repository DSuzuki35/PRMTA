import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Appearance, SessionState } from '../shared/model';
import { tokenize } from '../shared/text';
import { pagesFor } from '../shared/pages';
import { WordLayer } from './WordLayer';

export function Prompter({ session, appearance, onSeek, fullscreen = false }: { session: SessionState; appearance: Appearance; onSeek?: (index: number) => void; fullscreen?: boolean }) {
  const viewport = useRef<HTMLDivElement>(null), text = useRef<HTMLDivElement>(null), target = useRef(0), y = useRef(0);
  const content = session.script?.content ?? '';
  const words = useMemo(() => tokenize(content), [content]);
  const averageWordLength = useMemo(() => words.length ? words.reduce((sum, word) => sum + word.raw.length + 1, 0) / words.length : 5, [words]);
  const [capacity, setCapacity] = useState(512);
  const index = Math.max(0, Math.min(Math.floor(session.position), words.length - 1));
  const pages = useMemo(() => pagesFor(content), [content]);
  const pageIndex = Math.max(0, pages.findIndex(p => index >= p.start && index < p.end));
  const page = pages[pageIndex], paged = appearance.flow === 'page';
  // Keep the compositor and React work bounded even for book-length scripts.
  const start = paged ? page?.start ?? 0 : Math.max(0, Math.floor(index / 128) * 128 - capacity / 2);
  const end = paged ? page?.end ?? words.length : Math.min(words.length, start + capacity);
  const previous = useRef({ id: session.script?.id, start, index, paged, target: 0 });
  const smooth = useRef(appearance.smoothScroll); smooth.current = appearance.smoothScroll;
  const animation = useRef<number | undefined>(undefined);
  const reduced = useRef(false);
  const writePosition = () => { if (text.current) text.current.style.transform = `translateY(${y.current}px)`; };
  const wakeAnimation = () => {
    if (animation.current !== undefined || y.current === target.current) return;
    let previousTime = performance.now();
    const animate = (now: number) => {
      y.current = !smooth.current || reduced.current || Math.abs(target.current - y.current) < .05 ? target.current : y.current + (target.current - y.current) * (1 - Math.exp(-(now - previousTime) / 100));
      writePosition(); previousTime = now;
      animation.current = y.current === target.current ? undefined : requestAnimationFrame(animate);
    };
    animation.current = requestAnimationFrame(animate);
  };
  const measure = () => {
    const el = text.current, box = viewport.current; if (!el || !box) return;
    if (!paged) {
      const lines = Math.ceil(box.clientHeight / (appearance.fontSize * appearance.lineHeight));
      const perLine = Math.ceil(box.clientWidth * appearance.width / 100 / (appearance.fontSize * .45 * Math.max(2, averageWordLength)));
      setCapacity(Math.min(16384, Math.max(512, Math.ceil((lines * perLine * 3 + 256) / 256) * 256)));
    }
    const old = previous.current;
    const wordTarget = (i: number) => {
      const word = el.querySelector<HTMLElement>(`[data-word="${i}"]`);
      return word ? box.clientHeight * (appearance.mirrorY ? 1 - appearance.guide / 100 : appearance.guide / 100) - word.offsetTop - word.offsetHeight / 2 : 0;
    };
    if (paged) {
      // Fit against a fixed upper bound: wrapping cannot invert the size control.
      el.style.fontSize = `${appearance.fontSize}px`;
      if (el.scrollHeight > box.clientHeight * .82) {
        let low = 1, high = 160;
        for (let n = 0; n < 10; n++) {
          const candidate = (low + high) / 2; el.style.fontSize = `${candidate}px`;
          if (el.scrollHeight <= box.clientHeight * .82) low = candidate; else high = candidate;
        }
        el.style.fontSize = `${Math.min(appearance.fontSize, low)}px`;
      }
      target.current = Math.max(0, (box.clientHeight - el.scrollHeight) / 2);
    } else {
      el.style.fontSize = `${appearance.fontSize}px`;
      target.current = wordTarget(index);
      // Rebase the render window without animating across removed offscreen text.
      if (old.start !== start && old.id === session.script?.id && !old.paged) y.current += wordTarget(old.index) - old.target;
    }
    if (paged || !session.playing || !appearance.smoothScroll || old.id !== session.script?.id || old.paged !== paged || Math.abs(index - old.index) > 32) y.current = target.current;
    previous.current = { id: session.script?.id, start, index, paged, target: target.current };
    writePosition(); wakeAnimation();
  };
  const measureRef = useRef(measure); measureRef.current = measure;
  useLayoutEffect(() => { measure(); }, [paged ? pageIndex : index, appearance, content, session.script?.id, session.playing, capacity]);
  useEffect(() => {
    const observer = new ResizeObserver(() => measureRef.current()); if (viewport.current) observer.observe(viewport.current);
    let active = true; void document.fonts.ready.then(() => { if (active) measureRef.current(); });
    const loaded = () => measureRef.current(); document.fonts.addEventListener('loadingdone', loaded);
    return () => { active = false; observer.disconnect(); document.fonts.removeEventListener('loadingdone', loaded); };
  }, []);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => { reduced.current = media.matches; }; update(); media.addEventListener('change', update);
    return () => { if (animation.current !== undefined) cancelAnimationFrame(animation.current); animation.current = undefined; media.removeEventListener('change', update); };
  }, []);
  const wheelState = useRef({ index, onSeek, paged, pageIndex, pages, count: words.length }); wheelState.current = { index, onSeek, paged, pageIndex, pages, count: words.length };
  useEffect(() => {
    const el = viewport.current; if (!el || !onSeek) return;
    let delta = 0, lastPage = 0, lastEvent = 0, timer: ReturnType<typeof setTimeout> | undefined;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      event.preventDefault();
      if (Date.now() - lastEvent > 200) delta = 0;
      lastEvent = Date.now(); delta += event.deltaY * (event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? el.clientHeight : 1);
      if (timer) return;
      timer = setTimeout(() => {
        timer = undefined; const state = wheelState.current;
        const threshold = state.paged ? 100 : 20;
        if (Math.abs(delta) >= threshold) {
          const step = Math.trunc(delta / threshold);
          if (state.paged && Date.now() - lastPage < 350) { delta = 0; return; }
          const position = state.paged ? state.pages[Math.max(0, Math.min(state.pages.length - 1, state.pageIndex + Math.sign(step)))]?.start : Math.max(0, Math.min(state.count - 1, state.index + step));
          if (position !== undefined && position !== state.index) state.onSeek?.(position);
          if (state.paged) { lastPage = Date.now(); delta = 0; } else delta -= step * threshold;
        }
      }, 40);
    };
    el.addEventListener('wheel', wheel, { passive: false }); return () => { el.removeEventListener('wheel', wheel); clearTimeout(timer); };
  }, [onSeek]);
  const alpha = appearance.transparent ? 0 : appearance.backgroundOpacity / 100;
  const rgb = [1, 3, 5].map(offset => parseInt(appearance.background.slice(offset, offset + 2), 16));
  return <div ref={viewport} className={`prompter ${fullscreen ? 'full' : ''} ${alpha === 0 ? 'transparent' : ''}`} style={{ background: `rgba(${rgb.join(',')},${alpha})`, color: appearance.color }}>
    {!paged && <div className="reading-guide" style={{ top: `${appearance.guide}%` }}><span/><span/></div>}
    <div className="mirror-plane" style={{ transform: `scale(${appearance.mirrorX ? -1 : 1},${appearance.mirrorY ? -1 : 1})` }}>
      <div ref={text} className={`prompter-text font-${appearance.font}`} style={{ left: `${(100 - appearance.width) / 2}%`, width: `${appearance.width}%`, fontSize: appearance.fontSize, lineHeight: appearance.lineHeight, textAlign: appearance.align }}>
        <WordLayer content={content} index={index} start={start} end={end} paged={paged} highlight={appearance.highlight} dimRead={appearance.dimRead} onSeek={onSeek}/>
        {paged && appearance.previewNextLine && pages[pageIndex + 1] && <div className="next-page-preview" aria-hidden="true" style={{ height: `${appearance.lineHeight}em` }}><WordLayer content={content} index={-1} start={pages[pageIndex + 1].start} end={Math.min(pages[pageIndex + 1].end, pages[pageIndex + 1].start + 100)} paged highlight={false} dimRead={false}/></div>}
      </div>
    </div>
    {paged && page && <div className="page-number">{pageIndex + 1} / {pages.length}</div>}
    {session.countdownUntil > Date.now() && session.playing && <div className="countdown">{Math.ceil((session.countdownUntil - Date.now()) / 1000)}</div>}
    {session.blackout && <div className="blackout-cover"/>}
  </div>;
}
