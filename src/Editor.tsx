import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Bold, Copy, Download, Highlighter, History, Save, Star, Trash2, Undo2 } from 'lucide-react';
import type { Revision, Script } from '../shared/model';
import { tokenize, formatTime } from '../shared/text';
import { api } from './api';
import { recoverDraft } from './drafts';

export function Editor({ script, onSaved, onLoad, onCopy, report }: { script: Script; onSaved: (s: Script) => void; onLoad: (id: string) => Promise<void>; onCopy: (s: Script) => Promise<void>; report: (s: string) => void }) {
  const cacheKey = `prmpt-draft:${script.id}`;
  const [draft, setDraft] = useState<Script>(() => { try { return recoverDraft(script, localStorage.getItem(cacheKey)); } catch { return script; } });
  const current = useRef(draft); const heads = useRef(draft.heads);
  const [status, setStatus] = useState(draft !== script ? 'Draft recovered' : 'Saved'); const dirty = useRef(draft !== script); const pending = useRef<Promise<Script> | null>(null);
  const [externalChange, setExternalChange] = useState(false);
  const backupFailed = useRef(false);
  const [version, setVersion] = useState(0); const textarea = useRef<HTMLTextAreaElement>(null);
  const [history, setHistory] = useState<Revision[] | null>(null);
  const update = (patch: Partial<Script>) => {
    current.current = { ...current.current, ...patch }; setDraft(current.current); dirty.current = true; setStatus('Unsaved'); setVersion(v => v + 1);
    try { localStorage.setItem(cacheKey, JSON.stringify({ ...current.current, heads: heads.current })); backupFailed.current = false; } catch { backupFailed.current = true; report('Could not back up your draft locally. Save or export TXT before navigating away.'); }
  };
  useEffect(() => {
    if (JSON.stringify(script.heads) === JSON.stringify(heads.current)) return;
    if (dirty.current) { setExternalChange(true); return; }
    current.current = script; heads.current = script.heads; setDraft(script); setExternalChange(false); setStatus('Saved');
  }, [script]);
  const persist = async (): Promise<Script> => {
    if (pending.current) { await pending.current; if (dirty.current) return persist(); return current.current; }
    if (!dirty.current) return current.current;
    const snapshot = current.current;
    setStatus('Saving…');
    pending.current = api<Script>('/scripts', { draft: snapshot, expectedHeads: heads.current });
    try {
      const saved = await pending.current; heads.current = saved.heads;
      if (current.current === snapshot) {
        current.current = saved; setDraft(saved); dirty.current = false; setStatus('Saved'); setExternalChange(false);
        try { const cached = JSON.parse(localStorage.getItem(cacheKey) ?? 'null'); if (cached?.content === snapshot.content && cached?.title === snapshot.title) localStorage.removeItem(cacheKey); } catch { /* Draft is retained when storage is unavailable. */ }
      }
      else { setStatus('Unsaved'); try { localStorage.setItem(cacheKey, JSON.stringify({ ...current.current, heads: heads.current })); } catch { /* Keep the existing durable draft. */ } }
      onSaved(saved); return saved;
    } catch (error) { setStatus('Save failed'); report(String(error)); throw error; }
    finally { pending.current = null; }
  };
  useEffect(() => { if (!dirty.current) return; const timer = setTimeout(() => { void persist().catch(() => {}); }, 900); return () => clearTimeout(timer); }, [version]);
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => { if (dirty.current && (!window.desktop || backupFailed.current)) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', prevent); return () => { window.removeEventListener('beforeunload', prevent); void persist().catch(() => {}); };
  }, []);
  const wrap = (marker: string) => { const el = textarea.current; if (!el) return; const a = el.selectionStart, b = el.selectionEnd; update({ content: draft.content.slice(0, a) + marker + draft.content.slice(a, b) + marker + draft.content.slice(b) }); requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + marker.length, b + marker.length); }); };
  const download = () => { const blob = new Blob([draft.content], { type: 'text/plain;charset=utf-8' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${draft.title.replace(/[<>:"/\\|?*]/g, '_')}.txt`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  const words = tokenize(draft.content).length;
  return <section className="editor">
    <div className="editor-heading"><div className="eyebrow">SCRIPT EDITOR</div><span className={`save-state ${status.includes('failed') ? 'error-text' : ''}`}>{status}</span></div>
    <input className="title-input" aria-label="Script title" value={draft.title} onChange={e => update({ title: e.target.value })} maxLength={200}/>
    <div className="editor-meta"><span>{words} words</span><span>~ {formatTime(words / 130 * 60)} at 130 WPM</span><button className={`icon-button ${draft.favorite ? 'accent-text' : ''}`} aria-label="Favorite" onClick={() => update({ favorite: !draft.favorite })}><Star size={16} fill={draft.favorite ? 'currentColor' : 'none'}/></button></div>
    <div className="editor-toolbar">
      <button aria-label="Bold" title="Bold" onClick={() => wrap('**')}><Bold size={16}/></button>
      <button aria-label="Highlight text" title="Highlight text" onClick={() => wrap('==')}><Highlighter size={16}/></button>
      <span className="toolbar-divider"/>
      <button onClick={download} title="Export TXT"><Download size={16}/><span>TXT</span></button>
      <button onClick={() => { const el = textarea.current; if (!el) return; update({ content: draft.content.slice(0, el.selectionStart) + '\n---\n' + draft.content.slice(el.selectionEnd) }); }}>Page break</button>
      <button onClick={() => void api<Revision[]>(`/scripts/${script.id}/history`).then(setHistory).catch(e => report(String(e)))}><History size={16}/><span>History</span></button>
      <button aria-label="Duplicate script" onClick={() => void onCopy(current.current)}><Copy size={16}/></button>
    </div>
    {draft.conflict && <div className="notice warning">Multiple versions exist. Compare them in History. Restore a version to resolve the conflict.</div>}
    {externalChange && <div className="notice warning">This script changed elsewhere. Your draft is backed up locally. Compare the versions or save your text as a copy.<button className="text-button" onClick={() => void onCopy(current.current)}>Save draft as copy</button></div>}
    <textarea ref={textarea} className="script-textarea" aria-label="Script text" value={draft.content} onChange={e => update({ content: e.target.value })} placeholder="A great take starts with your words…" spellCheck/>
    <div className="editor-fields"><label>Folder<input value={draft.folder} onChange={e => update({ folder: e.target.value })} placeholder="e.g. YouTube" maxLength={100}/></label><label>Tags<input value={draft.tags.join(', ')} onChange={e => update({ tags: e.target.value.split(',').map(t => t.trim()).filter(Boolean).slice(0,30) })} placeholder="intro, tutorial"/></label></div>
    <details className="notes"><summary>Production notes</summary><textarea value={draft.notes} onChange={e => update({ notes: e.target.value })} placeholder="Notes do not appear in the prompter."/></details>
    <div className="editor-footer"><button className="icon-button danger-hover" aria-label={draft.deleted ? 'Restore' : 'Move to trash'} onClick={() => { update({ deleted: !draft.deleted }); void persist().catch(() => {}); }}>{draft.deleted ? <Undo2 size={18}/> : <Trash2 size={18}/>}</button><div className="spacer"/><button className="button secondary" onClick={() => void persist().catch(() => {})}><Save size={15}/>Save</button><button className="button primary" disabled={draft.deleted || !words} onClick={() => void persist().then(s => onLoad(s.id)).catch(e => report(String(e)))}>Load in prompter<ArrowUpRight size={17}/></button></div>
    {history && <div className="modal-backdrop"><section className="modal"><div className="section-heading"><h2>Version history</h2><button onClick={() => setHistory(null)}>Close</button></div><p className="muted">Restoring creates a new version. All previous versions are preserved.</p><div className="revision-list">{history.map(r => <article key={r.revision}><div className="section-heading"><strong>{new Date(r.updatedAt).toLocaleString('en-GB')}{script.heads.includes(r.revision) ? ' · Current version' : ''}</strong><button onClick={() => { heads.current = script.heads; update({ content: r.content, title: r.title, notes: r.notes }); setHistory(null); void persist().catch(() => {}); }}>Restore version</button></div><pre>{r.content}</pre></article>)}</div></section></div>}
  </section>;
}
