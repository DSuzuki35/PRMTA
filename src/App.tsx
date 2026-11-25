import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpRight, BookOpen, ChevronRight, CircleHelp, FileText, FolderOpen, Grid2X2, Layers, Library as LibraryIcon, List, Maximize2, Mic, MicOff, Monitor, Pause, Play, Plus, Radio, RotateCcw, Search, Settings2, SkipBack, SkipForward, SlidersHorizontal, Sparkles, Square, Star, Trash2, X } from 'lucide-react';
import { defaultPreferences, gamepadActions, type Command, type Preferences, type Profile, type Script } from '../shared/model';
import { GamepadInput } from '../shared/gamepad';
import { tokenize, formatTime } from '../shared/text';
import { pagesFor } from '../shared/pages';
import { api, command, token } from './api';
import { useSession } from './useSession';
import { Prompter } from './Prompter';
import { AppearancePanel } from './AppearancePanel';
import { Editor, trashLibraryScript } from './Editor';
import { Outputs } from './Outputs';
import { Settings } from './Settings';
import { Modal } from './Modal';
import { startSpeech } from './speech';
import { useKeyboardControls } from './useKeyboardControls';
import { controlCommand } from '../shared/control-actions';
import { formatShortcut, shortcutActions, type ShortcutAction } from '../shared/shortcuts';
import './Library.css';
import { version as appVersion } from '../package.json';

type View = 'studio' | 'library' | 'outputs' | 'settings';
const demoContent = "Great stories do not need perfect words.\n\nThey need a voice that is ready to tell them.\n\nWelcome to ==PRMTA==. A little space for ideas worth sharing.\n\n---\n\nTake a moment. Find your rhythm.\n\nYou set the pace. Your script follows. On your display, in a browser, or right inside your VR world.\n\n---\n\nA small slip? Keep going.\n\nStay with your story. Speak naturally. Make this take your own.\n\n**Your words. Your pace.**";

export function App() {
  const route = location.pathname === '/output' ? 'output' : location.pathname === '/remote' ? 'remote' : 'studio';
  const [scripts, setScripts] = useState<Script[]>([]), [view, setView] = useState<View>(() => { const saved = sessionStorage.getItem('prmpt-view'); return ['studio', 'library', 'outputs', 'settings'].includes(saved ?? '') ? saved as View : 'studio'; }), [selected, setSelected] = useState<string | null>(() => sessionStorage.getItem('prmpt-selected'));
  const [query, setQuery] = useState(''), [filter, setFilter] = useState('all'), [profile, setProfile] = useState<Profile>('studio');
  const [libraryView, setLibraryView] = useState<'grid' | 'list'>(() => { try { return localStorage.getItem('prmpt-library-view') === 'list' ? 'list' : 'grid'; } catch { return 'grid'; } });
  const [pendingTrash, setPendingTrash] = useState<Script | null>(null), [trashing, setTrashing] = useState(false);
  const [notice, setNotice] = useState(''), [help, setHelp] = useState(false), [mic, setMic] = useState(false), [micStarting, setMicStarting] = useState(false), [speechStatus, setSpeechStatus] = useState('Microphone off'), [level, setLevel] = useState(0);
  const stopSpeech = useRef<(() => void) | null>(null), micGeneration = useRef(0), upload = useRef<HTMLInputElement>(null);
  const [preferences, setPreferences] = useState(defaultPreferences); const prefRef = useRef(defaultPreferences), prefTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), prefPending = useRef(false);
  const prefRevision = useRef(0), prefWrites = useRef(Promise.resolve());
  const report = useCallback((message: string) => setNotice(message.replace(/^Error: /, '')), []);
  const refresh = useCallback(() => { if (route === 'studio') void api<Script[]>('/scripts').then(setScripts).catch(e => report(String(e))); }, [route, report]);
  const live = useSession(refresh); const { session, connected } = live;
  const previousWorkspace = useRef(live.workspace);
  useEffect(() => { if (previousWorkspace.current !== live.workspace) { previousWorkspace.current = live.workspace; setSelected(null); refresh(); } }, [live.workspace, refresh]);
  useEffect(() => { if (!prefPending.current) { setPreferences(live.preferences); prefRef.current = live.preferences; } }, [live.preferences]);
  useEffect(refresh, [refresh]);
  useEffect(() => { if (route === 'studio') { sessionStorage.setItem('prmpt-view', view); if (selected) sessionStorage.setItem('prmpt-selected', selected); else sessionStorage.removeItem('prmpt-selected'); } }, [view, selected, route]);
  useEffect(() => { try { localStorage.setItem('prmpt-library-view', libraryView); } catch { /* The chosen view still works for this session. */ } }, [libraryView]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 9000); return () => clearTimeout(timer); }, [notice]);
  const captureEpoch = useRef(0);
  const send = useCallback((c: Command) => { if (['seek', 'step', 'reset', 'pause', 'mode', 'navigate', 'scroll'].includes(c.type)) captureEpoch.current++; void command(c).catch(e => { if (c.type !== 'voiceActivity' && c.type !== 'scroll') report(String(e)); }); }, [report]);
  const updatePreferences = (value: Preferences) => {
    const revision = ++prefRevision.current;
    setPreferences(value); prefRef.current = value; prefPending.current = true; clearTimeout(prefTimer.current);
    prefTimer.current = setTimeout(() => {
      // Serialize saves so an older request cannot land after a newer edit.
      // Its acknowledgement must not unlock incoming state for a pending edit.
      prefWrites.current = prefWrites.current.then(async () => {
        if (revision !== prefRevision.current) return;
        try { await api<Preferences>('/preferences', value); }
        catch (error) { if (revision === prefRevision.current) report(String(error)); }
        finally { if (revision === prefRevision.current) prefPending.current = false; }
      });
    }, 180);
  };
  const seek = useCallback((position: number) => send({ type: 'seek', position }), [send]);
  const remoteAppearance = useMemo(() => ({ ...defaultPreferences.profiles.studio, fontSize: 28 }), []);
  const words = useMemo(() => tokenize(session.script?.content ?? ''), [session.script?.content]);
  const pages = useMemo(() => pagesFor(session.script?.content ?? ''), [session.script?.content]);
  const pageIndex = Math.max(0, pages.findIndex(p => Math.min(session.position, words.length - 1) >= p.start && Math.min(session.position, words.length - 1) < p.end));
  const movePage = useCallback((direction: number) => {
    const index = pages.findIndex(p => session.position >= p.start && session.position < p.end);
    const next = pages[Math.max(0, Math.min(pages.length - 1, (index < 0 ? pages.length - 1 : index) + direction))];
    if (next) send({ type: 'seek', position: next.start });
  }, [pages, session.position, send]);
  const currentActions = useRef({ movePage, session }); currentActions.current = { movePage, session };
  const actionRef = useRef<(action: ShortcutAction, voice?: boolean) => void>(() => {});
  const keyboardSource = useRef(crypto.randomUUID()), keyboardSequence = useRef(0);
  const keyboardAction = useCallback((action: ShortcutAction) => actionRef.current(action), []);
  const keyboardScroll = useCallback((direction: -1 | 0 | 1) => send({ type: 'scroll', direction, speed: prefRef.current.keyboardScrollSpeed, keepVoiceActive: prefRef.current.keyboardKeepVoiceActive, source: keyboardSource.current, sequence: ++keyboardSequence.current }), [send]);
  useKeyboardControls(preferences, route !== 'output' && view !== 'settings' && connected, keyboardAction, keyboardScroll);
  const commandContext = useRef<() => string | null>(() => null);
  commandContext.current = () => !connected || view === 'settings' || currentActions.current.session.manualScrollActive || document.querySelector('dialog[open], .editor-expanded, [data-assigning="true"]') || document.activeElement?.closest('input,textarea,select,[contenteditable="true"]') ? null : `${currentActions.current.session.script?.id}:${currentActions.current.session.transportRevision}:${captureEpoch.current}`;
  const [lastVoiceCommand, setLastVoiceCommand] = useState('');
  useEffect(() => { if (!lastVoiceCommand) return; const timer = setTimeout(() => setLastVoiceCommand(''), 4000); return () => clearTimeout(timer); }, [lastVoiceCommand]);
  const [controllerFallback, setControllerFallback] = useState(false);
  useEffect(() => {
    let active = true;
    void window.desktop?.controllerState?.().then(state => { if (active) setControllerFallback(state.fallback === true); }).catch(() => {});
    return () => { active = false; };
  }, []);
  const controllerSource = useRef(crypto.randomUUID()), controllerSequence = useRef(0);
  // Depend only on controller settings: unrelated appearance updates must not interrupt a hold.
  const controllerBindings = JSON.stringify(gamepadActions.map(action => preferences[action.key]));
  useEffect(() => {
    const desktop = window.desktop;
    if (!desktop?.controllerContext || route !== 'studio') return;
    let previous = '';
    const update = () => {
      const context = {
        blocked: !connected || view === 'settings' || !!document.querySelector('dialog[open], .editor-expanded') || !!document.activeElement?.closest('input,textarea,select,[contenteditable="true"]'),
        assigning: !!document.querySelector('[data-assigning="true"]'),
      };
      const key = JSON.stringify(context); if (key === previous) return; previous = key;
      void desktop.controllerContext(context).catch(error => report(String(error)));
    };
    const observer = new MutationObserver(update);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open', 'class', 'data-assigning'] });
    document.addEventListener('focusin', update); document.addEventListener('focusout', update); update();
    return () => {
      observer.disconnect(); document.removeEventListener('focusin', update); document.removeEventListener('focusout', update);
      void desktop.controllerContext({ blocked: true, assigning: true }).catch(() => {});
    };
  }, [route, view, connected, report]);
  useEffect(() => {
    // Desktop input is sampled and dispatched in the main process, including
    // while minimized. Never process it a second time via Chromium's snapshots.
    if ((window.desktop?.controllerState && !controllerFallback) || !preferences.gamepadEnabled || route === 'output' || view === 'settings' || !connected) return;
    let input = new GamepadInput(), direction: -1 | 0 | 1 = 0, lastHeartbeat = 0, focused = document.hasFocus();
    const scroll = (next: -1 | 0 | 1) => {
      direction = next; lastHeartbeat = Date.now();
      send({ type: 'scroll', direction: next, speed: prefRef.current.gamepadScrollSpeed, source: controllerSource.current, sequence: ++controllerSequence.current, keepVoiceActive: prefRef.current.gamepadKeepVoiceActive });
    };
    const stop = () => { if (direction) scroll(0); input = new GamepadInput(); };
    const blur = () => { focused = false; stop(); };
    const focus = () => { focused = true; input = new GamepadInput(); };
    const visibility = () => { if (document.hidden) stop(); };
    const timer = setInterval(() => {
      if (!focused || document.hidden || document.querySelector('dialog[open], .editor-expanded') || document.activeElement?.closest('input,textarea,select,[contenteditable="true"]')) { stop(); return; }
      const sampled = input.sample(navigator.getGamepads?.() ?? [], prefRef.current);
      for (const key of sampled.actions) {
        const action = gamepadActions.find(action => action.key === key)!;
        if (action.unit !== 'scroll') { if (direction) scroll(0); send({ type: 'navigate', unit: action.unit, direction: action.direction, keepVoiceActive: prefRef.current.gamepadKeepVoiceActive }); }
      }
      if (sampled.actions.length) input = new GamepadInput();
      // A navigation press takes precedence over a simultaneous scroll hold.
      const next = sampled.actions.length ? 0 : sampled.scroll;
      if (next !== direction || (next && Date.now() - lastHeartbeat >= 200)) scroll(next);
    }, 25);
    window.addEventListener('blur', blur); window.addEventListener('focus', focus); window.addEventListener('pagehide', stop);
    document.addEventListener('visibilitychange', visibility);
    return () => { clearInterval(timer); stop(); window.removeEventListener('blur', blur); window.removeEventListener('focus', focus); window.removeEventListener('pagehide', stop); document.removeEventListener('visibilitychange', visibility); };
  }, [preferences.gamepadEnabled, preferences.gamepadScrollSpeed, controllerBindings, controllerFallback, route, view, connected, send]);
  useEffect(() => () => { micGeneration.current++; stopSpeech.current?.(); }, []);
  useEffect(() => { if (route === 'output') { document.body.classList.add('output-body'); document.documentElement.classList.add('output-root'); if (window.OpenKneeboard?.SetPreferredPixelSize) void window.OpenKneeboard.SetPreferredPixelSize(1200, 900); } }, [route]);
  const toggleMic = async () => {
    if (mic || micStarting) { send({ type: 'voiceActivity', active: false, transportRevision: currentActions.current.session.transportRevision }); micGeneration.current++; stopSpeech.current?.(); stopSpeech.current = null; setMic(false); setMicStarting(false); setLevel(0); setSpeechStatus('Microphone off'); return; }
    const generation = ++micGeneration.current; setMicStarting(true);
    try {
      const stop = await startSpeech(preferences, text => { if (generation === micGeneration.current) send({ type: 'transcript', text, transportRevision: currentActions.current.session.transportRevision }); }, (message, energy) => { if (generation === micGeneration.current) { setSpeechStatus(message); if (energy !== undefined) setLevel(energy); } }, message => { if (generation === micGeneration.current) { micGeneration.current++; setMic(false); setMicStarting(false); setLevel(0); setSpeechStatus(message); report(message); send({ type: 'pause' }); } }, () => { const s = currentActions.current.session; return s.playing && s.mode === 'voice' && !s.manualScrollActive && Date.now() >= s.countdownUntil ? `${s.script?.id}:${s.countdownUntil}:${s.transportRevision}:${captureEpoch.current}` : null; }, active => { if (generation === micGeneration.current) send({ type: 'voiceActivity', active, transportRevision: currentActions.current.session.transportRevision }); }, { enabled: () => prefRef.current.voiceCommandsEnabled, wakeWord: () => prefRef.current.voiceCommandWakeWord, context: () => commandContext.current(), onCommand: action => { if (generation === micGeneration.current) actionRef.current(action, true); } });
      if (generation !== micGeneration.current) { stop(); return; }
      stopSpeech.current = stop; setMic(true); send({ type: 'mode', mode: 'voice' });
    } catch (error) { if (generation === micGeneration.current) { report(String(error)); setMic(false); } } finally { if (generation === micGeneration.current) setMicStarting(false); }
  };
  actionRef.current = (action, voice = false) => {
    if (voice) { captureEpoch.current++; setLastVoiceCommand(`Command: ${shortcutActions.find(item => item.id === action)?.label ?? action}`); }
    if (action === 'fullscreen') { void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(error => report(String(error))); return; }
    if (action === 'microphone') { void toggleMic(); return; }
    const next = controlCommand(action, currentActions.current.session, voice || prefRef.current.keyboardKeepVoiceActive);
    if (next) send(next);
    if (action === 'modeVoice' && !mic && !micStarting) void toggleMic();
  };
  const create = async (title = 'Untitled script', content = '', source?: Script) => {
    try { const saved = await api<Script>('/scripts', { draft: { ...(source ?? {}), id: crypto.randomUUID(), title, content, folder: source?.folder ?? '', tags: source?.tags ?? [], favorite: false, deleted: false, notes: source?.notes ?? '' }, expectedHeads: [], workspace: live.workspace }); refresh(); setSelected(saved.id); setView('library'); setFilter('all'); return saved; } catch (error) { report(String(error)); }
  };
  const load = async (id: string) => { captureEpoch.current++; await api('/load', { id }); setView('studio'); };
  const importFile = async (file: File) => {
    try { if (file.size > 10_000_000) throw new Error('Choose a file smaller than 10 MB.'); const content = file.name.toLowerCase().endsWith('.docx') ? (await api<{ text: string }>('/import/docx', undefined, await file.arrayBuffer())).text : await file.text(); await create(file.name.replace(/\.(txt|md|docx)$/i, ''), content); } catch (error) { report(String(error)); }
  };
  const selectedScript = scripts.find(s => s.id === selected);
  const closeEditor = () => {
    const closing = selected;
    setSelected(previous => previous === closing ? null : previous);
    requestAnimationFrame(() => {
      if (document.querySelector('.editor')) return;
      const opener = document.querySelector<HTMLButtonElement>(`.script-card-open[data-script-id="${CSS.escape(closing ?? '')}"]`);
      (opener ?? document.querySelector<HTMLInputElement>('.library-panel .search-field input'))?.focus();
    });
  };
  const confirmTrash = async () => {
    if (!pendingTrash || trashing) return;
    setTrashing(true);
    try {
      if ((pendingTrash.workspace ?? 'local') !== live.workspace) throw new Error('Library changed. Reopen the script before moving it to trash.');
      const saved = await trashLibraryScript(pendingTrash);
      setScripts(previous => previous.map(script => script.id === saved.id ? saved : script));
      setSelected(previous => previous === saved.id ? null : previous);
      setPendingTrash(null);
      requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.library-panel .search-field input')?.focus());
    } catch (error) { report(String(error)); }
    finally { setTrashing(false); }
  };
  const filtered = useMemo(() => scripts.filter(s => filter === 'trash' ? s.deleted : !s.deleted).filter(s => filter === 'favorites' ? s.favorite : filter.startsWith('folder:') ? s.folder === filter.slice(7) : true).filter(s => `${s.title} ${s.content} ${s.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase())), [scripts, filter, query]);
  const wordCounts = useMemo(() => new Map(scripts.map(s => [s.id, tokenize(s.content).length])), [scripts]);
  const folders = [...new Set(scripts.filter(s => !s.deleted && s.folder).map(s => s.folder))].sort();
  const percent = words.length ? Math.min(100, session.position / words.length * 100) : 0;
  const controls = <><div className="transport-buttons"><button className="icon-button" aria-label="Back to start" onClick={() => send({ type: 'reset' })}><RotateCcw size={20}/></button><button className="icon-button" aria-label="Previous page" title={preferences.shortcuts.previousPage ? `Previous page · ${formatShortcut(preferences.shortcuts.previousPage)}` : "Previous page"} onClick={() => movePage(-1)}><SkipBack size={22}/></button><button className="play-button" aria-label={session.playing ? 'Pause' : 'Play'} disabled={!session.script} onClick={() => send({ type: session.playing ? 'pause' : 'play' })}>{session.playing ? <Pause size={24} fill="currentColor"/> : <Play size={24} fill="currentColor"/>}</button><button className="icon-button" aria-label="Next page" title={preferences.shortcuts.nextPage ? `Next page · ${formatShortcut(preferences.shortcuts.nextPage)}` : "Next page"} onClick={() => movePage(1)}><SkipForward size={22}/></button><button className={`icon-button ${session.blackout ? 'accent-text' : ''}`} aria-label="Blackout" aria-pressed={session.blackout} title={preferences.shortcuts.blackout ? `Blackout · ${formatShortcut(preferences.shortcuts.blackout)}` : "Blackout"} onClick={() => send({ type: 'blackout' })}><Square size={19}/></button></div><div className="speed-control"><span>SPEED</span><button aria-label="Slower" onClick={() => send({ type: 'speed', speed: Math.max(20, session.speed - 5) })}>−</button><strong>{session.speed}<small>WPM</small></strong><button aria-label="Faster" onClick={() => send({ type: 'speed', speed: Math.min(400, session.speed + 5) })}>+</button></div></>;
  if (!token) return <div className="access-screen"><div className="brand">PRMTA<span>_</span></div><h1>Open your studio link.</h1><p>Launch the desktop app or open the studio link printed in the terminal.</p></div>;
  if (route === 'output') { const p = new URLSearchParams(location.search).get('profile') === 'vr' ? 'vr' : 'display'; return <><Prompter session={session} appearance={preferences.profiles[p]} fullscreen/>{!connected && <div className="connection-overlay">Disconnected · output paused</div>}<button className="output-fullscreen" aria-label="Fullscreen" onClick={() => void document.documentElement.requestFullscreen()}>⛶</button></>; }
  if (route === 'remote') return <div className="remote-app"><div className="brand">PRMTA<span>_</span><small>REMOTE</small></div><span className={`connection-pill ${connected ? '' : 'offline'}`}><i/>{connected ? 'Connected' : 'Connecting'}</span><h1>{session.script?.title ?? 'Waiting for a script'}</h1><Prompter session={session} appearance={remoteAppearance} onSeek={seek}/><div className="remote-transport">{controls}</div><div className="remote-stats"><span>{formatTime(session.elapsed)}</span><span>Page {pageIndex + 1} / {pages.length}</span><span>{Math.round(percent)} %</span></div>{notice && <div className="notice warning">{notice}</div>}</div>;
  return <div className="app-shell"><a className="skip-link" href="#main-content">Skip to main content</a>
    <aside className="sidebar"><div className="brand">PRMTA<span>_</span></div><div className="workspace-switch"><span className="workspace-avatar">P</span><div>My studio<small>{live.workspace === 'local' ? 'LOCAL LIBRARY' : 'CLOUD LIBRARY'}</small></div></div>
      <div className="nav-caption">WORKSPACE</div><nav aria-label="Workspace">{[{ id: 'studio', icon: Radio, label: 'Prompter' }, { id: 'library', icon: LibraryIcon, label: 'Library' }, { id: 'outputs', icon: Monitor, label: 'Outputs' }].map(item => <button key={item.id} aria-label={item.label} title={item.label} aria-current={view === item.id ? 'page' : undefined} className={view === item.id ? 'active' : ''} onClick={() => { setView(item.id as View); if (item.id === 'library') setFilter('all'); }}><item.icon size={18}/>{item.label}{item.id === 'library' && <span className="nav-count">{scripts.filter(s => !s.deleted).length}</span>}{item.id === 'outputs' && <span className="tiny-tag">VR</span>}</button>)}</nav>
      <div className="nav-caption library-caption">YOUR SCRIPTS<button aria-label="New script" onClick={() => void create()}><Plus size={16}/></button></div><nav className="folder-nav" aria-label="Script library"><button className={filter === 'favorites' && view === 'library' ? 'active' : ''} onClick={() => { setView('library'); setFilter('favorites'); }}><Star size={16}/>Favorites</button>{folders.map(f => <button key={f} onClick={() => { setView('library'); setFilter(`folder:${f}`); }}><FolderOpen size={16}/><span>{f}</span></button>)}<button className={filter === 'trash' && view === 'library' ? 'active' : ''} onClick={() => { setView('library'); setFilter('trash'); }}><Trash2 size={16}/>Trash</button></nav>
      <div className="sidebar-bottom"><div className="local-card"><span className="status-dot"/><strong>Local first. Always.</strong><p>{live.workspace !== 'local' ? 'Cloud library active' : 'Your scripts stay with you.'}</p><button onClick={() => setView('settings')}>{preferences.cloudFolder ? 'Manage library' : 'Connect cloud folder'}<ArrowUpRight size={14}/></button></div><button aria-label="Settings" title="Settings" aria-current={view === 'settings' ? 'page' : undefined} className={view === 'settings' ? 'bottom-nav active' : 'bottom-nav'} onClick={() => setView('settings')}><Settings2 size={18}/>Settings</button><button className="bottom-nav" aria-label="Quick start" title="Quick start" onClick={() => setHelp(true)}><CircleHelp size={18}/>Quick start<span className="version">v{appVersion}</span></button></div>
    </aside>
    <main className="main-shell" id="main-content" tabIndex={-1}><header className="topbar"><div className="breadcrumbs">Workspace<ChevronRight size={13}/><strong>{{ studio: 'Prompter', library: 'Script library', outputs: 'Outputs', settings: 'Settings' }[view]}</strong></div><div className="topbar-actions"><span className={`connection-pill ${connected ? '' : 'offline'}`}><i/>{connected ? 'Studio connected' : 'Disconnected'}</span><button className="button secondary small" onClick={() => void create()}><Plus size={15}/>Create script</button></div></header>
      {live.upgradeRequired && <div className="notice warning">Your cloud library needs a format upgrade. Your local library is active.<button className="text-button" onClick={() => setView('settings')}>Review cloud library</button></div>}
      {view === 'studio' && <><div className="studio-heading"><div><div className="eyebrow">READY WHEN YOU ARE</div><h1>{session.script?.title ?? 'Your next great take.'}</h1><div className="take-meta"><span><FileText size={13}/>{words.length} words</span><span><Layers size={13}/>{pages.length} pages</span><span>{formatTime(words.length / session.speed * 60)} reading time</span></div></div><div className="button-row"><select aria-label="Prompter script" value={session.script?.id ?? ''} onChange={e => { if (e.target.value) void load(e.target.value).catch(e => report(String(e))); }}><option value="">Choose a script…</option>{scripts.filter(s => !s.deleted).map(s => <option value={s.id} key={s.id}>{s.title}</option>)}</select><button className="button secondary" onClick={() => setView('outputs')}><Monitor size={16}/>Open output<ArrowUpRight size={15}/></button></div></div>
      <div className="studio-layout"><section className="stage-column"><div className="stage-frame"><div className="stage-toolbar"><span className={`live-indicator ${session.playing ? 'playing' : ''}`}><i/>{session.playing ? 'ON AIR' : 'PREVIEW'}</span><span>{profile === 'studio' ? 'Studio' : profile === 'display' ? 'Display profile' : 'VR profile'}</span><button className="button secondary small voice-toggle" aria-pressed={mic} disabled={micStarting} onClick={() => void toggleMic()}>{mic ? <Mic size={14}/> : <MicOff size={14}/>} {micStarting ? 'Connecting…' : mic ? 'Mic on' : 'Enable voice'}</button><button className="icon-button" aria-label="Fullscreen preview" onClick={e => void e.currentTarget.closest('.stage-frame')?.requestFullscreen()}><Maximize2 size={15}/></button></div><Prompter session={session} appearance={preferences.profiles[profile]} onSeek={seek}/>{!session.script && <div className="welcome-actions"><button className="button primary" onClick={() => void create('Your words. Your pace.', demoContent).then(s => s && load(s.id))}><Sparkles size={17}/>Try a sample</button><button className="text-button" onClick={() => void create()}>Write your own script<ArrowUpRight size={15}/></button></div>}<div className="stage-footer"><span>{session.script ? 'Scroll or click a word to move through the script' : 'A great take starts here.'}</span><span>{profile.toUpperCase()} · {preferences.profiles[profile].flow === 'page' ? 'PAGES' : 'SCROLL'}</span></div></div>
        <div className="progress-track"><input aria-label="Reading position" aria-valuetext={`Word ${Math.min(Math.floor(session.position) + 1, words.length)} of ${words.length}`} type="range" min={0} max={Math.max(0, words.length - 1)} step={1} value={Math.min(session.position, Math.max(0, words.length - 1))} onChange={e => send({ type: 'seek', position: Number(e.target.value) })}/></div><div className="timeline-meta"><span>{formatTime(session.elapsed)}<small>ELAPSED</small></span><span>Page {pages.length ? pageIndex + 1 : 0} of {pages.length} · {Math.round(percent)} %</span><span>−{formatTime((words.length - session.position) / session.speed * 60)}<small>ESTIMATED REMAINING</small></span></div>
        <div className="transport"><div className="mode-control">{[{ id: 'timed', label: 'Auto' }, { id: 'voice', label: 'Voice' }, { id: 'manual', label: 'Manual' }].map(m => <button aria-pressed={session.mode === m.id} className={session.mode === m.id ? 'selected' : ''} key={m.id} onClick={() => { send({ type: 'mode', mode: m.id as typeof session.mode }); if (m.id === 'voice' && !mic && !micStarting) void toggleMic(); }}>{m.id === 'voice' && <Mic size={13}/>} {m.label}</button>)}</div>{controls}</div>
        <div className={`speech-strip ${mic ? 'listening' : ''}`}><button aria-label={mic ? 'Turn microphone off' : 'Turn microphone on'} className="mic-button" onClick={() => void toggleMic()}>{mic ? <Mic size={18}/> : <MicOff size={18}/>}</button><div><strong>{micStarting ? 'Preparing microphone…' : mic ? session.speech.status : 'Speak naturally. PRMTA follows.'}</strong><small className={lastVoiceCommand ? 'voice-command-feedback' : ''}>{lastVoiceCommand || (mic ? speechStatus : `${preferences.provider === 'system' ? 'System speech' : preferences.provider === 'parakeet' ? 'Local Parakeet' : preferences.provider === 'browser' ? 'Browser recognition' : 'Local Whisper'} · flexible script matching · word highlighting`)}</small></div><div className="audio-meter">{Array.from({ length: 12 }, (_, i) => <i key={i} style={{ height: `${6 + ((i * 7) % 17)}px`, opacity: mic && level * 12 > i ? 1 : .15 }}/>)}</div><button className="text-button" onClick={() => setView('settings')}>Set up<ArrowUpRight size={14}/></button></div>
        {mic && <div className="transcript-caption">{session.speech.transcript || 'Recognized words appear here. Play your take to follow along.'}</div>}
      </section><aside className="inspector"><div className="inspector-heading"><SlidersHorizontal size={17}/><h2>Appearance</h2></div><AppearancePanel preferences={preferences} profile={profile} setProfile={setProfile} onChange={updatePreferences}/><div className="inspector-tip"><BookOpen size={16}/><p><strong>One glance. One thought.</strong><br/>Narrower lines keep your eyes closer to the camera.</p></div></aside></div></>}
      {view === 'library' && <div className={`library-layout ${selectedScript ? 'with-editor' : ''}`}>
        <section className="library-panel">
          <div className="page-title"><div><div className="eyebrow">WORDS WORTH KEEPING</div><h1>{filter === 'trash' ? 'Trash' : filter === 'favorites' ? 'Favorites' : filter.startsWith('folder:') ? filter.slice(7) : 'Script library'}</h1><p>{filtered.length} scripts · {live.workspace === 'local' ? 'Local library' : 'Cloud folder library'}</p></div><button className="icon-button" aria-label="Import script" title="Import TXT, Markdown or DOCX" onClick={() => upload.current?.click()}><ArrowDownToLine size={20}/></button></div>
          <div className="library-tools"><div className="search-field"><Search size={17}/><input aria-label="Search scripts" placeholder="Search scripts, content or tags…" value={query} onChange={e => setQuery(e.target.value)}/></div>
            <div className="library-view-toggle" role="group" aria-label="Library view"><button type="button" className="icon-button" aria-label="Grid view" title="Grid view" aria-pressed={libraryView === 'grid'} onClick={() => setLibraryView('grid')}><Grid2X2 size={18}/></button><button type="button" className="icon-button" aria-label="List view" title="List view" aria-pressed={libraryView === 'list'} onClick={() => setLibraryView('list')}><List size={18}/></button></div>
          </div>
          <div className={`script-grid ${libraryView === 'list' ? 'script-list' : ''}`}>
            {filtered.map(s => <article className={`script-card ${selected === s.id ? 'selected' : ''}`} key={s.id}>
              <button type="button" className="script-card-open" data-script-id={s.id} aria-label={`Open ${s.title}`} aria-current={selected === s.id ? 'true' : undefined} onClick={() => setSelected(s.id)}>
                <div className="script-card-top"><span className="file-icon"><FileText size={20}/></span>{s.favorite && <Star size={15} className="accent-text" fill="currentColor"/>}<span className="spacer"/><small>TXT</small></div>
                <h3>{s.title}</h3><p>{s.content.replace(/[=#*]/g, '').slice(0,130) || 'A blank page. Your story is waiting.'}</p>
                <div className="script-card-tags"><span className="storage-badge">{s.deleted ? 'Local trash' : s.storage === 'cloud' ? 'Cloud folder' : 'Local'}</span>{s.conflict && <span className="conflict-tag">Version conflict</span>}{s.tags.slice(0,3).map(tag => <span key={tag}>{tag}</span>)}</div>
                <div className="script-card-bottom"><span>{wordCounts.get(s.id)} words</span><span>{new Date(s.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span></div>
              </button>
              {!s.deleted && <button type="button" className="icon-button danger-hover script-card-trash" aria-label={`Move ${s.title} to trash`} title="Move to trash" onClick={() => setPendingTrash(s)}><Trash2 size={16}/></button>}
            </article>)}
            {filter !== 'trash' && <button className="new-script-card" onClick={() => void create()}><Plus size={24}/><strong>New story</strong><span>Make room for your ideas.</span></button>}
          </div>
          {filter === 'trash' && !filtered.length && <div className="empty-list"><Trash2 size={30}/><h3>Everything in its place.</h3><p>Deleted scripts can be restored here.</p></div>}
        </section>
        {selectedScript && <Editor key={`${live.workspace}:${selectedScript.id}`} script={selectedScript} onSaved={saved => setScripts(previous => previous.map(s => s.id === saved.id ? saved : s))} onLoad={load} onCopy={async s => { await create(`${s.title} (Copy)`, s.content, s); }} onClose={closeEditor} report={report}/>}
      </div>}
      {view === 'outputs' && <Outputs report={report}/>}{view === 'settings' && <Settings preferences={preferences} onChange={updatePreferences} report={report}/>}
      <footer className="app-footer"><span><span className="status-dot"/> {live.workspace !== 'local' ? 'Cloud folder active' : 'Saved locally'}<span className="footer-separator">/</span>TXT + SQLite</span><span>YOUR WORDS. YOUR PACE.<span className="footer-separator">/</span>{preferences.shortcuts.togglePlay && <><kbd>{formatShortcut(preferences.shortcuts.togglePlay)}</kbd> Start / Pause</>}</span></footer>
    </main>
    <input ref={upload} type="file" accept=".txt,.md,.docx" hidden onChange={e => { const file = e.target.files?.[0]; if (file) void importFile(file); e.target.value = ''; }}/>
    {notice && <div role="status" className="toast"><span>{notice}</span><button aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={16}/></button></div>}
    {pendingTrash && <Modal label="Move script to trash" onClose={() => { if (!trashing) setPendingTrash(null); }}><h2>Move “{pendingTrash.title}” to trash?</h2><p className="muted">{pendingTrash.storage === 'cloud' ? 'This removes the TXT file from your cloud folder. You can restore the script from Trash.' : 'You can restore this script from Trash.'} Your latest edits are kept with the script.</p><div className="button-row"><button type="button" className="button secondary" disabled={trashing} onClick={() => setPendingTrash(null)}>Cancel</button><button type="button" className="button primary" disabled={trashing} onClick={() => void confirmTrash()}>{trashing ? 'Moving…' : 'Move to trash'}</button></div></Modal>}
    {help && <Modal label="Quick start" className="help-modal" onClose={() => setHelp(false)}><button className="modal-close icon-button" aria-label="Close help" onClick={() => setHelp(false)}><X/></button><div className="eyebrow">YOUR FIRST TAKE</div><h1>Read less.<br/>Tell more.</h1><ol><li><strong>Write your script.</strong><p>Import TXT or write directly. A line containing <code>---</code> starts a new page. Use <code>==Text==</code> to highlight important words. Put optional stage directions in <code>[square brackets]</code>; show or hide them per output in Appearance.</p></li><li><strong>Choose your screen.</strong><p>In Outputs, select your Elgato Prompter, open a browser link, or paste the VR link into OpenKneeboard.</p></li><li><strong>Find your pace.</strong><p>Auto scrolls at your WPM. Voice follows your script. Manual puts you in control. Set the reading line and page mode for each output.</p></li></ol><button className="button primary" onClick={() => setHelp(false)}>Ready for my take<ArrowUpRight size={16}/></button></Modal>}
  </div>;
}
