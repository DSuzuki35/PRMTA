import { useEffect, useState } from 'react';
import type { Preferences } from '../shared/model';
import type { SystemSpeechStatus } from '../shared/system-speech';
import { api } from './api';

export function SystemSpeechSettings({ preferences, report }: { preferences: Preferences; report: (text: string) => void }) {
  const [status, setStatus] = useState<SystemSpeechStatus>(), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { let active = true; void api<SystemSpeechStatus>('/speech/system/status').then(value => { if (active) setStatus(value); }).catch(error => { if (active) setError(String(error)); }); return () => { active = false; }; }, []);
  const check = async () => {
    setBusy(true); setError('');
    try { setStatus(await api<SystemSpeechStatus>('/speech/system/start', { language: preferences.language })); }
    catch (error) { setError(String(error)); report(String(error)); }
    finally { setBusy(false); }
  };
  return <div className="voice-setup">
    <h3>{status?.engine || 'Windows / Apple system speech'}</h3>
    <p className="muted">Uses the speech recognizer installed with your operating system. Audio stays on this computer. English is the default; install the corresponding speech or on-device dictation language in system settings.</p>
    <p className="muted">Windows uses the installed System.Speech recognizer. On macOS, Apple Speech requires on-device support and speech recognition permission. Browser recognition is a separate option and may use an online service.</p>
    <p className="muted">Available languages: {status?.languages.length ? status.languages.join(', ') : 'None detected yet'}</p>
    <button type="button" className="button secondary" disabled={busy || !status?.supported} onClick={() => void check()}>{busy ? 'Preparing system speech…' : 'Prepare system speech'}</button>
    <p className="muted" role="status">{status?.message || 'Checking installed speech languages…'}</p>
    {error && <p className="error-text" role="alert">{error}</p>}
    <p className="muted">Turn the microphone off before changing engine or language, then reconnect it. Quality and speed depend on the installed recognizer.</p>
  </div>;
}
