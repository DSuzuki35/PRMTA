import { useEffect, useState } from 'react';
import type { Preferences } from '../shared/model';
import { whisperModels, type ModelsInfo } from '../shared/whisper-models';
import { api } from './api';
import { isManagedWhisperUrl } from '../shared/whisper-endpoint';
export function ModelPicker({ preferences, onChange, report }: { preferences: Preferences; onChange: (p: Preferences) => void; report: (text: string) => void }) {
  const [info, setInfo] = useState<ModelsInfo | null>(null);
  useEffect(() => { let alive = true; const refresh = () => void api<ModelsInfo>('/speech/models').then(s => { if (alive) setInfo(s); }).catch(() => {}); refresh(); const timer = setInterval(refresh, 1000); return () => { alive = false; clearInterval(timer); }; }, []);
  const model = whisperModels.find(m => m.id === preferences.whisperModel) ?? whisperModels[1];
  const state = info?.models.find(m => m.id === model.id);
  if (!isManagedWhisperUrl(preferences.whisperUrl) || info?.managed === false) return <p className="muted">Your external server controls the model. See the voice guide for compatible Whisper models.</p>;
  return <div className="model-select"><label>Local model<select aria-label="Local model" value={model.id} onChange={e => onChange({ ...preferences, whisperModel: e.target.value as Preferences['whisperModel'] })}>{whisperModels.map(m => <option value={m.id} key={m.id}>{m.name} · {Math.round(m.size / 1048576)} MiB</option>)}</select></label><div className="model-meta"><p className="muted">{model.description}</p><button className="button secondary" disabled={!info || state?.installed || info.models.some(m => m.downloading)} onClick={() => void api<ModelsInfo>('/speech/models/install', { id: model.id }).then(setInfo).catch(e => report(String(e)))}>{state?.installed ? 'Installed' : state?.downloading ? 'Downloading…' : 'Download model'}</button></div>{state?.downloading && <><progress className="model-progress" value={state.received} max={model.size}/><small>{Math.round(state.received / model.size * 100)}% · checksum verified before installation</small></>}{state?.error && <div className="notice warning">{state.error}</div>}<p className="muted">Turn the microphone off and on to apply a model change. All models here support German and English. Active managed model: {info?.activeModel ?? 'none (external servers manage their own model)'}.</p></div>;
}
