import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Download, LoaderCircle } from 'lucide-react';
import { api } from './api';
import type { Preferences } from '../shared/model';
import { modelById, type ModelsInfo } from '../shared/whisper-models';
import { isManagedWhisperUrl } from '../shared/whisper-endpoint';

export function VoiceSetup({ preferences, disabled = false }: { preferences: Preferences; disabled?: boolean }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('Whisper is included in the Windows app. Prepare it here, then enable the microphone in the studio.');
  const [progress, setProgress] = useState<number | null>(null), [ready, setReady] = useState(false), [error, setError] = useState(false);
  const mounted = useRef(true); const generation = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; }; }, []);
  useEffect(() => { generation.current++; setReady(false); setBusy(false); setProgress(null); }, [preferences.whisperModel, preferences.whisperUrl]);
  const prepare = async () => {
    const run = ++generation.current;
    const active = () => mounted.current && run === generation.current;
    setBusy(true); setReady(false); setError(false); setProgress(null); setMessage('Preparing local voice…');
    try {
      const info = await api<ModelsInfo>('/speech/models');
      if (!active()) return;
      const managed = info.managed && isManagedWhisperUrl(preferences.whisperUrl);
      if (managed) {
        const model = modelById(preferences.whisperModel);
        let installed = info.models.find(m => m.id === model.id)?.installed;
        if (!installed) {
          await api('/speech/models/install', { id: model.id });
          const deadline = Date.now() + 31 * 60_000;
          while (!installed && active()) {
            const current = (await api<ModelsInfo>('/speech/models')).models.find(m => m.id === model.id);
            if (current?.error) throw new Error(current.error);
            if (Date.now() > deadline) throw new Error('Download timed out. Please try again.');
            installed = current?.installed; const percent = Math.round((current?.received ?? 0) / model.size * 100);
            if (active()) { setProgress(percent); setMessage(`Downloading ${model.name} · ${percent}%`); }
            if (!installed) await new Promise(resolve => setTimeout(resolve, 800));
          }
        }
        if (!active()) return;
        setProgress(null); setMessage('Starting Whisper…');
        // Submit this selection before starting, including immediately after a dropdown change.
        await api('/speech/start', { model: preferences.whisperModel, whisperUrl: preferences.whisperUrl });
      } else {
        const status = await api<{ ok: boolean }>(`/speech/status?whisperUrl=${encodeURIComponent(preferences.whisperUrl)}`);
        if (!status.ok) throw new Error('The voice server is not available. Open the Windows app for built-in setup, or check your external server.');
      }
      if (active()) { setReady(true); setMessage('Voice is ready. Turn on the microphone in the studio and press Play.'); }
    } catch (cause) { if (active()) { setError(true); setMessage(String(cause).replace(/^Error: /, '')); } }
    finally { if (active()) { setBusy(false); setProgress(null); } }
  };
  return <div className="voice-setup"><div className="button-row"><button className={`button ${ready ? 'secondary' : 'primary'}`} disabled={busy || disabled} onClick={() => void prepare()}>{busy ? <LoaderCircle size={16}/> : ready ? <CheckCircle2 size={16}/> : <Download size={16}/>} {busy ? 'Setting up voice…' : ready ? 'Voice ready' : 'Set up voice'}</button><span role="status" className={error ? 'error-text' : 'muted'}>{message}</span></div>{progress !== null && <progress className="model-progress" aria-label="Voice model download" max={100} value={progress}/>}</div>;
}
