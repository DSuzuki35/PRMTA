import type { Command, Preferences, SessionState } from '../shared/model';
import type { HostInfo } from '../server/host';
import type { UpdateStatus } from '../shared/updater';
export const token = location.hash.slice(1) || sessionStorage.getItem('prmpt-token') || '';
if (token) { sessionStorage.setItem('prmpt-token', token); history.replaceState(null, '', location.pathname + location.search); }
export async function api<T>(path: string, body?: unknown, raw?: Blob | ArrayBuffer): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: body !== undefined || raw ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(raw ? { 'Content-Type': raw instanceof Blob ? raw.type : 'application/octet-stream' } : body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  if (!response.ok) { const error = await response.json().catch(() => ({ error: `HTTP ${response.status}` })); throw new Error(error.error || 'Connection failed'); }
  return response.json();
}
export const command = (body: Command) => api<SessionState | null>('/command', body);
export type StateMessage = { type: string; session?: SessionState; preferences?: Preferences; workspace?: string; upgradeRequired?: boolean };
export type Display = { id: number; label: string; width: number; height: number; primary: boolean };
declare global {
  interface Window {
    desktop?: {
      displays(): Promise<Display[]>;
      output(displayId: number, profile: string): Promise<void>;
      closeOutputs(): Promise<void>;
      chooseFolder(): Promise<string | null>;
      openBrowser(url: string): Promise<void>;
      copyText(text: string): Promise<void>;
      updateStatus(): Promise<UpdateStatus>;
      checkForUpdates(): Promise<UpdateStatus>;
      installUpdate(): Promise<UpdateStatus>;
      openReleases(): Promise<void>;
      onUpdateStatus(callback: (status: UpdateStatus) => void): () => void;
    };
    OpenKneeboard?: { SetPreferredPixelSize?(width: number, height: number): Promise<void> };
  }
}
export type { HostInfo };
