import type { UpdateMode, UpdateStatus } from '../shared/updater';
import type { EventEmitter } from 'node:events';

export function closeForUpdate(window: EventEmitter & { close(): void; webContents: EventEmitter }): Promise<boolean> {
  // Keep the contents reference: BrowserWindow.webContents is inaccessible once
  // its closed event fires. Do not destroy the window or bypass beforeunload.
  const contents = window.webContents;
  return new Promise<boolean>(resolve => {
    const done = (value: boolean) => { window.removeListener('closed', accepted); contents.removeListener('will-prevent-unload', cancelled); resolve(value); };
    const accepted = () => done(true), cancelled = () => done(false);
    window.once('closed', accepted); contents.once('will-prevent-unload', cancelled);
    window.close();
  });
}

// Small boundary around electron-updater so the lifecycle can be tested without
// downloading or running an installer on the developer's computer.
export interface UpdaterBackend {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  on(event: string, listener: (...args: any[]) => void): unknown;
  checkForUpdates(): Promise<{ downloadPromise?: Promise<unknown> | null } | null>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}
export function updateMode(packaged: boolean, platform: string, portable: boolean, installed: boolean): UpdateMode {
  if (!packaged) return 'development';
  if (platform === 'darwin') return 'macos-manual';
  if (portable) return 'portable';
  return platform === 'win32' && installed ? 'installed' : 'unsupported';
}
export class UpdateService {
  status: UpdateStatus;
  private startup?: ReturnType<typeof setTimeout>;
  private interval?: ReturnType<typeof setInterval>;
  private deferred?: ReturnType<typeof setTimeout>;
  private checking = false;
  constructor(private backend: UpdaterBackend, mode: UpdateMode, currentVersion: string, private changed: (status: UpdateStatus) => void, private prepareInstall: () => Promise<boolean>, private canInstall: () => boolean = () => true) {
    this.status = { mode, currentVersion, phase: mode === 'installed' ? 'idle' : 'unavailable', message: mode === 'installed' ? 'Updates download automatically. You choose when to restart.' : mode === 'macos-manual' ? 'This macOS test build uses manual updates. Download the macOS DMG for your Mac (Apple Silicon or Intel), quit PRMTA, and replace it in Applications. Your library and settings are kept.' : mode === 'portable' ? 'Portable copies cannot update automatically. Install PRMTA Setup to enable automatic updates.' : mode === 'development' ? 'Automatic updates are disabled in development.' : 'Automatic updates require the installed Windows app. Download PRMTA Setup from the official release page.' };
    backend.autoDownload = true;
    backend.autoInstallOnAppQuit = false;
    backend.allowPrerelease = false;
    backend.allowDowngrade = false;
    backend.on('checking-for-update', () => this.set({ phase: 'checking', message: 'Checking for updates…' }));
    backend.on('update-not-available', () => this.set({ phase: 'current', message: 'You have the latest version.', version: undefined, percent: undefined }));
    backend.on('update-available', info => this.set({ phase: 'downloading', version: info.version, percent: 0, message: `Downloading PRMTA ${info.version}…` }));
    backend.on('download-progress', progress => this.set({ percent: Math.max(0, Math.min(100, Math.round(progress.percent))) }));
    backend.on('update-downloaded', info => this.set({ phase: 'ready', version: info.version, percent: 100, message: `PRMTA ${info.version} is ready. Restart when your take is finished.` }));
    backend.on('error', () => this.fail());
    backend.on('update-cancelled', () => this.fail());
  }
  private set(patch: Partial<UpdateStatus>) { this.status = { ...this.status, ...patch }; this.changed(this.status); }
  private fail() { this.set({ phase: 'error', percent: undefined, message: 'The update could not be completed. Check your connection and retry, or download the installer from the official release page.' }); }
  start() {
    if (this.status.mode !== 'installed' || this.startup || this.interval) return;
    this.startup = setTimeout(() => { void this.check(); }, 15_000);
    this.interval = setInterval(() => { void this.check(); }, 6 * 60 * 60 * 1000);
    this.startup.unref?.(); this.interval.unref?.();
  }
  stop() { clearTimeout(this.startup); clearInterval(this.interval); clearTimeout(this.deferred); this.startup = undefined; this.interval = undefined; this.deferred = undefined; }
  async check() {
    if (this.status.mode !== 'installed' || this.checking || ['downloading', 'ready', 'installing'].includes(this.status.phase)) return this.status;
    if (!this.canInstall()) {
      this.set({ phase: 'idle', message: 'Update check deferred while playback is active. Retrying in 5 minutes.' });
      if (!this.deferred) {
        this.deferred = setTimeout(() => { this.deferred = undefined; void this.check(); }, 5 * 60 * 1000);
        this.deferred.unref?.();
      }
      return this.status;
    }
    clearTimeout(this.deferred); this.deferred = undefined;
    this.checking = true;
    this.set({ phase: 'checking', message: 'Checking for updates…', percent: undefined });
    try { const result = await this.backend.checkForUpdates(); await result?.downloadPromise; }
    catch { this.fail(); }
    finally { this.checking = false; }
    return this.status;
  }
  async install() {
    if (this.status.phase !== 'ready' || this.status.mode !== 'installed') throw new Error('No downloaded update is ready.');
    if (!this.canInstall()) throw new Error('Pause playback before restarting to install the update.');
    this.set({ phase: 'installing', message: 'Saving your work and restarting…' });
    try {
      if (!await this.prepareInstall()) { this.set({ phase: 'ready', message: 'Restart cancelled. Save or export your draft before trying again.' }); return this.status; }
      this.backend.quitAndInstall(true, true);
    } catch { this.fail(); }
    return this.status;
  }
}
