import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { RELEASES_URL, type UpdateStatus } from '../shared/updater';
import { prepareForUpdate } from './updateSafety';

export function UpdateSettings({ report }: { report: (message: string) => void }) {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const desktop = window.desktop; if (!desktop?.updateStatus) return;
    let active = true; const accept = (value: UpdateStatus) => { if (active) setStatus(value); };
    const unsubscribe = desktop.onUpdateStatus(accept);
    void desktop.updateStatus().then(accept).catch(error => report(String(error)));
    return () => { active = false; unsubscribe(); };
  }, []);
  const install = async () => {
    setSaving(true);
    try { await prepareForUpdate(); await window.desktop!.installUpdate(); }
    catch (error) { report(`Could not restart. ${error instanceof Error ? error.message : String(error)}`); }
    finally { setSaving(false); }
  };
  return <section className="settings-card" aria-labelledby="updates-heading">
    <div className="section-heading"><h2 id="updates-heading"><Download size={21}/>App updates</h2>{status && <span className="pill">Version {status.currentVersion}</span>}</div>
    <p className="muted">{window.desktop?.platform === 'darwin' || status?.mode === 'macos-manual' ? 'Mac test builds are updated manually. Choose the download for your Mac: Apple Silicon (M-series) or Intel.' : 'Installed Windows apps check and download updates automatically. Installation starts only when you choose Restart and install.'}</p>
    <p role="status" aria-live="polite">{status?.message ?? (window.desktop ? 'Loading update status…' : 'Updates are managed in the PRMTA desktop app.')}</p>
    {status?.phase === 'downloading' && <label>Download progress: {status.percent ?? 0}%<progress aria-label="Update download progress" max={100} value={status.percent ?? 0}/></label>}
    <div className="button-row">
      {status?.mode === 'installed' && <button className="button secondary" disabled={saving || ['checking', 'downloading', 'ready', 'installing'].includes(status.phase)} onClick={() => void window.desktop!.checkForUpdates().then(setStatus).catch(error => report(String(error)))}>{status.phase === 'error' ? 'Retry update' : 'Check for updates'}</button>}
      {status?.phase === 'ready' && <button className="button primary" disabled={saving} onClick={() => void install()}>{saving ? 'Saving your work…' : 'Restart and install'}</button>}
      {window.desktop?.openReleases ? <button className="button secondary" onClick={() => void window.desktop!.openReleases().catch(error => report(String(error)))}>Official downloads</button> : <a className="button secondary" href={RELEASES_URL} target="_blank" rel="noreferrer">Official downloads</a>}
    </div>
  </section>;
}
