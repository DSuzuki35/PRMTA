import { useEffect, useRef, useState } from 'react';
import type { Preferences } from '../shared/model';
import type { ParakeetStatus } from '../shared/parakeet';
import { api } from './api';

export function ParakeetSetup({ preferences, onChange, report }: { preferences: Preferences; onChange: (p: Preferences) => void; report: (message: string) => void }) {
  const [status, setStatus] = useState<ParakeetStatus>();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const mounted = useRef(false), operation = useRef(0);
  useEffect(() => {
    mounted.current = true;
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try { const next = await api<ParakeetStatus>('/speech/parakeet/status'); if (mounted.current) setStatus(next); }
      catch (error) { if (mounted.current) setFailure(String(error)); }
      finally { pending = false; }
    };
    void refresh(); const timer = setInterval(() => void refresh(), 1000);
    return () => { mounted.current = false; operation.current++; clearInterval(timer); };
  }, []);
  const prepare = async () => {
    const id = ++operation.current, acceleration = preferences.parakeetAcceleration;
    const current = () => mounted.current && operation.current === id;
    setBusy(true); setFailure('');
    try {
      let next = status;
      if (!next?.installed || next.phase === 'error') {
        next = await api<ParakeetStatus>('/speech/parakeet/install', {});
        const deadline = Date.now() + 45 * 60 * 1000;
        while (current() && (!next.installed || next.phase === 'installing')) {
          setStatus(next);
          if (next.phase === 'error' || next.phase === 'unavailable') throw new Error(next.error || next.message);
          if (Date.now() > deadline) throw new Error('Setup is taking longer than expected. Check the download status and try again.');
          await new Promise(resolve => setTimeout(resolve, 800));
          if (!current()) return;
          next = await api<ParakeetStatus>('/speech/parakeet/status');
          if (next.phase === 'not-installed') throw new Error('Parakeet setup was cancelled.');
        }
      }
      if (!current()) return;
      setStatus({ ...next!, phase: 'starting', message: 'Starting Parakeet…' });
      next = await api<ParakeetStatus>('/speech/parakeet/start', { acceleration });
      if (current()) setStatus(next);
    } catch (error) { if (current()) { setFailure(String(error)); report(String(error)); } }
    finally { if (current()) setBusy(false); }
  };
  const cancel = async () => {
    operation.current++; setBusy(false);
    try { const next = await api<ParakeetStatus>('/speech/parakeet/cancel', {}); if (mounted.current) setStatus(next); }
    catch (error) { if (mounted.current) setFailure(String(error)); }
  };
  const installing = status?.phase === 'installing';
  const working = busy || installing || status?.phase === 'starting';
  const ready = status?.phase === 'ready' && (status.requestedAcceleration ? status.requestedAcceleration === preferences.parakeetAcceleration : preferences.parakeetAcceleration === 'cpu' ? status.provider === 'CPUExecutionProvider' : status.provider === 'DmlExecutionProvider');
  return <div className="voice-setup parakeet-setup">
    <h3>NVIDIA Parakeet</h3>
    <p className="muted">Parakeet TDT v3 runs locally and detects English, German and other supported languages automatically. Setup downloads about 731 MB once. No terminal or Python installation needed.</p>
    <label>Parakeet processing<select disabled={working} value={preferences.parakeetAcceleration} onChange={event => onChange({ ...preferences, parakeetAcceleration: event.target.value as Preferences['parakeetAcceleration'] })}><option value="cpu">CPU · recommended for consistent response</option><option value="directml">GPU · DirectML</option></select></label>
    <p className="muted">GPU processing can take longer to warm up and may be slower for short audio chunks. Reconnect the microphone after changing this setting.</p>
    <div className="button-row"><button className="button secondary" disabled={!status?.supported || working || ready} onClick={() => void prepare()}>{working ? installing ? 'Downloading Parakeet…' : 'Preparing Parakeet…' : ready ? 'Parakeet ready' : status?.phase === 'error' ? 'Repair Parakeet' : status?.installed ? 'Start Parakeet' : 'Set up Parakeet'}</button>{installing && <button className="button secondary" onClick={() => void cancel()}>Cancel download</button>}</div>
    {installing && <progress aria-label="Parakeet download" value={status.percent} max={100}/>}
    <p className="muted" role="status">{status?.message || 'Checking Parakeet…'}{installing && ` ${Math.round(status.received / 1e6)} / ${Math.round(status.total / 1e6)} MB`}</p>
    {status?.provider && <p className="muted">Active processor: {status.provider === 'DmlExecutionProvider' ? 'GPU (DirectML)' : 'CPU'}</p>}
    {/Microsoft Visual C\+\+/i.test(failure || status?.error || '') && window.desktop?.openParakeetRuntimeHelp && <button className="button secondary" onClick={() => void window.desktop!.openParakeetRuntimeHelp().catch(error => report(String(error)))}>Get Microsoft Visual C++ runtime</button>}
    {(failure || status?.error) && <p className="error-text" role="alert">{failure || status?.error}</p>}
  </div>;
}
