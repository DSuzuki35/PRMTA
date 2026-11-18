import { useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { Preferences } from '../shared/model';
import { whisperEndpoint } from '../shared/whisper-endpoint';
import { api } from './api';
import { VoiceSetup } from './VoiceSetup';

function portOf(value: string) { try { return new URL(value).port || '80'; } catch { return ''; } }

export function WhisperConnection({ preferences, onChange, report }: { preferences: Preferences; onChange: (p: Preferences) => void; report: (text: string) => void }) {
  const [url, setUrl] = useState(preferences.whisperUrl), [port, setPort] = useState(() => portOf(preferences.whisperUrl));
  const [status, setStatus] = useState('');
  useEffect(() => { setUrl(preferences.whisperUrl); setPort(portOf(preferences.whisperUrl)); setStatus(''); }, [preferences.whisperUrl]);
  let target = '', error = '';
  try {
    const endpoint = new URL(url);
    if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('Enter a Whisper port from 1 to 65535.');
    endpoint.port = port;
    target = whisperEndpoint(endpoint.origin).origin;
  } catch (cause) { error = (cause as Error).message; }
  const dirty = !!error || target !== preferences.whisperUrl;
  return <>
    <form onSubmit={event => { event.preventDefault(); if (!error) onChange({ ...preferences, whisperUrl: target }); }}>
      <div className="two-fields">
        <label>Local Whisper server<input value={url} onChange={event => { setUrl(event.target.value); setPort(portOf(event.target.value)); }}/></label>
        <label>Whisper port<input type="number" min={1} max={65535} step={1} value={port} aria-invalid={!!error} onChange={event => setPort(event.target.value)}/></label>
      </div>
      <p className="muted">The Windows app starts Whisper at 127.0.0.1 on this port. If another app uses 8080, try 18080. Apply changes, then reconnect the microphone.</p>
      {error && <p className="error-text" role="alert">{error}</p>}
      <button type="submit" className="button secondary" disabled={!dirty || !!error}>Apply server</button>
    </form>
    <div className="button-row"><button className="button secondary" disabled={dirty} onClick={() => void api<{ ok: boolean; message: string }>(`/speech/status?whisperUrl=${encodeURIComponent(preferences.whisperUrl)}`).then(s => setStatus(s.message)).catch(e => report(String(e)))}><CheckCircle2 size={16}/>Check connection</button><span className="muted">{status}</span></div>
    <VoiceSetup preferences={preferences} disabled={dirty}/>
  </>;
}
