import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Appearance, SessionState } from '../shared/model';
import { tokenize } from '../shared/text';
import { navigationStarts, pagesFor } from '../shared/pages';
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
  const page = pages[pageIndex], paged = appearance.flow === 'page' && !session.manualScroll;
  // Keep the compositor and React work bounded even for book-length scripts.
  const desiredStart = Math.max(0, Math.floor(index / 128) * 128 - capacity / 2);
  const paragraphs = useMemo(() => navigationStarts(content, 'paragraph'), [content]);
  const windowStarts = useMemo(() => new Map<number, number>(), [content, appearance, capacity]);
  const start = useMemo(() => {
    if (paged) return page?.start ?? 0;
    const cached = windowStarts.get(desiredStart); if (cached !== undefined) return cached;
    let aligned = desiredStart;
    const paragraph = paragraphs.findLast(position => position <= desiredStart) ?? 0;
    if (desiredStart - paragraph <= 256) aligned = paragraph;
    else {
      // Preserve wrapping when removing text before the viewport. Remember this
      // line boundary so scrolling back through the same window stays stable.
      const word = text.current?.querySelector<HTMLElement>(`[data-word="${desiredStart}"]`);
      if (word) while (aligned > 0) { const previous = text.current?.querySelector<HTMLElement>(`[data-word="${aligned - 1}"]`); if (!previous || previous.offsetTop !== word.offsetTop) break; aligned--; }
    }
    windowStarts.set(desiredStart, aligned); return aligned;
  }, [paged, page?.start, desiredStart, paragraphs, windowStarts]);
  const end = paged ? page?.end ?? words.length : Math.min(words.length, desiredStart + capacity);
  const highlightIndex = appearance.smoothVoice && session.mode === 'voice' && session.playing
    ? Math.max(index, Math.min(end - 1, session.voiceHighlight ?? index)) : index;
  const previous = useRef({ id: session.script?.id, start, index, paged, target: 0 });
  const smooth = useRef(appearance.smoothScroll); smooth.current = appearance.smoothScroll || !!session.manualScroll;
  const animation = useRef<number | undefined>(undefined);
  const wasScrolling = useRef(false);
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
      if (session.manualScroll) {
        // Interpolate between line starts using fractional word progress. This
        // moves the actual text continuously instead of jumping at each wrap.
        const current = el.querySelector<HTMLElement>(`[data-word="${index}"]`);
        if (current) {
          let first = index, next = index + 1;
          while (first > start) { const word = el.querySelector<HTMLElement>(`[data-word="${first - 1}"]`); if (!word || word.offsetTop !== current.offsetTop) break; first--; }
          while (next < end) { const word = el.querySelector<HTMLElement>(`[data-word="${next}"]`); if (!word || word.offsetTop !== current.offsetTop) break; next++; }
          if (next < end) target.current += (wordTarget(next) - target.current) * Math.min(1, (session.position - first) / (next - first));
        }
      }
      // Rebase the render window without animating across removed offscreen text.
      if (old.start !== start && old.id === session.script?.id && !old.paged) y.current += wordTarget(old.index) - old.target;
    }
    if (paged || (!session.playing && !session.manualScroll) || !smooth.current || old.id !== session.script?.id || old.paged !== paged || Math.abs(index - old.index) > 32) y.current = target.current;
    previous.current = { id: session.script?.id, start, index, paged, target: paged ? target.current : wordTarget(index) };
    if (wasScrolling.current && session.manualScroll && !session.manualScrollActive) {
      // Freeze exactly where the text is when release arrives; do not snap to
      // the last network position or leave a spring animation running.
      if (animation.current !== undefined) cancelAnimationFrame(animation.current);
      animation.current = undefined; target.current = y.current;
    }
    wasScrolling.current = !!session.manualScrollActive;
    writePosition(); wakeAnimation();
  };
  const measureRef = useRef(measure); measureRef.current = measure;
  useLayoutEffect(() => { measure(); }, [paged ? pageIndex : session.manualScroll ? session.position : index, paged, appearance, content, session.script?.id, session.playing, session.manualScroll, session.manualScrollActive, capacity]);
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
  return <div ref={viewport} className={`prompter ${fullscreen ? 'full' : ''} ${alpha === 0 ? 'transparent' : ''}`} style={{ background: `rgba(${rgb.join(',')},${alpha})`, color: appearance.color, '--stage-direction-color': appearance.stageDirectionColor } as CSSProperties}>
    {!paged && <div className="reading-guide" style={{ top: `${appearance.guide}%` }}><span/><span/></div>}
    <div className="mirror-plane" style={{ transform: `scale(${appearance.mirrorX ? -1 : 1},${appearance.mirrorY ? -1 : 1})` }}>
      <div ref={text} className={`prompter-text font-${appearance.font}`} style={{ left: `${(100 - appearance.width) / 2}%`, width: `${appearance.width}%`, fontSize: appearance.fontSize, lineHeight: appearance.lineHeight, textAlign: appearance.align }}>
        <WordLayer showStageDirections={appearance.showStageDirections} content={content} index={index} highlightIndex={highlightIndex} start={start} end={end} paged={paged} highlight={appearance.highlight} dimRead={appearance.dimRead} onSeek={onSeek}/>
        {paged && appearance.previewNextLine && pages[pageIndex + 1] && <div className="next-page-preview" aria-hidden="true" style={{ height: `${appearance.lineHeight}em` }}><WordLayer showStageDirections={appearance.showStageDirections} content={content} index={-1} start={pages[pageIndex + 1].start} end={Math.min(pages[pageIndex + 1].end, pages[pageIndex + 1].start + 100)} paged highlight={false} dimRead={false}/></div>}
      </div>
    </div>
    {paged && page && <div className="page-number">{pageIndex + 1} / {pages.length}</div>}
    {appearance.flow === 'page' && session.manualScroll && <div className="page-number" title="Page layout resumes with navigation or playback">Manual scroll · navigate or play to resume pages</div>}
    {session.countdownUntil > Date.now() && session.playing && <div className="countdown">{Math.ceil((session.countdownUntil - Date.now()) / 1000)}</div>}
    {session.blackout && <div className="blackout-cover"/>}
  </div>;
}
