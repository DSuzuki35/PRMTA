import { useEffect, useState } from 'react';
import { Cloud, FolderOpen, RefreshCw } from 'lucide-react';
import type { Draft, Preferences } from '../shared/model';
import { api, type HostInfo } from './api';
import { Modal } from './Modal';
export function CloudSettings({ preferences, onChange, report }: { preferences: Preferences; onChange: (p: Preferences) => void; report: (text: string) => void }) {
  const [folder, setFolder] = useState(preferences.cloudFolder), [info, setInfo] = useState<HostInfo | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refresh = () => api<HostInfo>('/info').then(setInfo).catch(e => report(String(e)));
  useEffect(() => { setFolder(preferences.cloudFolder); void refresh(); const timer = setInterval(() => void refresh(), 5000); return () => clearInterval(timer); }, [preferences.cloudFolder]);
  const switchLibrary = async (copyCurrent: boolean) => {
    if (confirm === null) return; setBusy(true); setError('');
    try { const next = await api<Preferences>('/workspace', { folder: confirm, copyCurrent }); onChange(next); setConfirm(null); await refresh(); }
    catch (e) { setError(String(e).replace(/^Error: /, '')); } finally { setBusy(false); }
  };
  return <section className="settings-card"><h2><Cloud size={21}/>Script library & cloud</h2>
    {info?.upgradeRequired && <p className="notice warning">Your previous cloud folder needs an upgrade. Open it below to confirm conversion. Until then, your local library stays active.</p>}
    <p className="muted">Use your local library or open a Dropbox, OneDrive or iCloud Drive folder as the active library. Each cloud script has one current TXT file. Edits and deletions work both ways; version history and trash stay on this computer.</p>
    <label>Cloud library folder<div className="input-with-button"><input aria-label="Cloud library folder" value={folder} onChange={e => setFolder(e.target.value)} placeholder="Choose a cloud folder"/>{window.desktop && <button className="icon-button" aria-label="Choose cloud folder" onClick={() => void window.desktop!.chooseFolder().then(path => { if (path) setFolder(path); }).catch(e => report(String(e)))}><FolderOpen size={18}/></button>}</div></label>
    <div className="button-row"><button className="button secondary" disabled={!folder.trim() || busy} onClick={() => setConfirm(folder.trim())}>Open cloud library</button>{preferences.cloudFolder && <button className="button secondary" disabled={busy} onClick={() => setConfirm('')}>Use local library</button>}<button className="button secondary" disabled={!preferences.cloudFolder || busy} onClick={() => void api<HostInfo['sync']>('/sync', {}).then(result => { report(result.errors.length ? result.errors.join('\n') : 'Cloud folder checked. Library is up to date.'); return refresh(); }).catch(e => report(String(e)))}><RefreshCw size={15}/>Sync now</button></div>
    {info?.sync.errors.map((error, i) => <div className="notice warning" key={i}>{error}</div>)}
    <div className="storage-note"><span className="status-dot"/>{preferences.cloudFolder ? 'Active cloud library' : 'Active local library'}<code>{preferences.cloudFolder || info?.dataDir || 'Loading…'}</code></div>
    <p className="muted">Your cloud app handles online uploads. PRMTA checks the folder on this computer; it cannot confirm that OneDrive or another provider has uploaded it.</p>
    {info?.legacyBackup && <details className="storage-note"><summary>Previous version files backed up locally</summary><code>{info.legacyBackup}</code></details>}
    {!!info?.recoveredDrafts.length && <div className="recovered-drafts"><h3>Recovered drafts</h3><p>An interrupted save met a newer cloud edit. Your draft was preserved separately.</p>{info.recoveredDrafts.map(d => <div key={d.id}><strong>{d.title}</strong><div className="button-row"><button className="button secondary" onClick={() => void api('/recovery', { id: d.id, workspace: info.workspace }).then(refresh).catch(e => report(String(e)))}>Restore copy</button><button className="button secondary" onClick={() => void api<Draft>(`/recovery/${d.id}`).then(draft => { const url = URL.createObjectURL(new Blob([draft.content], { type: 'text/plain;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = `${draft.title.replace(/[<>:"/\\|?*]/g, '_')}.txt`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }).catch(e => report(String(e)))}>Export TXT</button></div></div>)}</div>}
    {confirm !== null && <Modal label="Switch script library" onClose={() => { if (!busy) setConfirm(null); }}><h2>Switch script library</h2>
      {confirm ? <><p>Open this folder as your library?</p><code className="folder-path">{confirm}</code><p>Choose whether to copy your current scripts into it. Existing scripts are kept. Matching scripts are skipped. Your original library stays available.</p><p className="muted">Older PRMTA revision files will be backed up locally and replaced with one current TXT per script. Deleted scripts are not copied.</p></> : <p>Return to the local library on this computer? The cloud folder and its scripts will be kept. Cloud scripts are not copied into the local library.</p>}
      {error && <p className="notice warning" role="alert">{error}</p>}<div className="button-row"><button disabled={busy} className="button secondary" onClick={() => setConfirm(null)}>Cancel</button><button disabled={busy} className="button secondary" onClick={() => void switchLibrary(false)}>{confirm ? 'Open folder only' : 'Open local library'}</button>{confirm && <button disabled={busy} className="button primary" onClick={() => void switchLibrary(true)}>Copy current scripts</button>}</div>{busy && <p role="status">Preparing library…</p>}
    </Modal>}
  </section>;
}
