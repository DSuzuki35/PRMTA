import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpdateService, updateMode, closeForUpdate } from '../electron/updater';

class Updater extends EventEmitter {
  autoDownload = false; autoInstallOnAppQuit = true; allowPrerelease = true; allowDowngrade = true;
  checkForUpdates = vi.fn(async () => null);
  quitAndInstall = vi.fn();
}
afterEach(() => vi.useRealTimers());
describe('desktop updates', () => {
  it('waits for the window to close and preserves an unload veto', async () => {
    class Window extends EventEmitter {
      webContents = new EventEmitter();
      close() { this.webContents.emit('will-prevent-unload'); }
    }
    const window = new Window();
    expect(await closeForUpdate(window)).toBe(false);
    expect(window.listenerCount('closed')).toBe(0);
    window.close = () => { window.emit('closed'); };
    expect(await closeForUpdate(window)).toBe(true);
    expect(window.webContents.listenerCount('will-prevent-unload')).toBe(0);
  });
  it('never checks from development, portable, unpacked or non-Windows apps', async () => {
    for (const mode of ['development', 'portable', 'unsupported'] as const) {
      const updater = new Updater(); const service = new UpdateService(updater, mode, '0.3.0', () => {}, async () => true);
      service.start(); await service.check();
      expect(service.status.phase).toBe('unavailable'); expect(updater.checkForUpdates).not.toHaveBeenCalled(); service.stop();
    }
    expect(updateMode(false, 'win32', false, true)).toBe('development');
    expect(updateMode(true, 'win32', true, true)).toBe('portable');
    expect(updateMode(true, 'win32', false, false)).toBe('unsupported');
    expect(updateMode(true, 'darwin', false, true)).toBe('unsupported');
    expect(updateMode(true, 'win32', false, true)).toBe('installed');
  });
  it('downloads automatically but only installs on explicit request after safe shutdown', async () => {
    const updater = new Updater(); const prepare = vi.fn(async () => true);
    const service = new UpdateService(updater, 'installed', '0.3.0', () => {}, prepare);
    expect(updater.autoDownload).toBe(true); expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(updater.allowPrerelease).toBe(false); expect(updater.allowDowngrade).toBe(false);
    await service.check(); updater.emit('update-available', { version: '0.3.1' });
    updater.emit('download-progress', { percent: 45.4 }); expect(service.status.percent).toBe(45);
    updater.emit('update-downloaded', { version: '0.3.1' });
    expect(service.status.phase).toBe('ready'); expect(updater.quitAndInstall).not.toHaveBeenCalled();
    await service.check(); expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    await service.install(); expect(prepare).toHaveBeenCalledOnce(); expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true);
  });
  it('preserves a downloaded update when closing is cancelled and rejects premature installation', async () => {
    const updater = new Updater(); const service = new UpdateService(updater, 'installed', '0.3.0', () => {}, async () => false);
    await expect(service.install()).rejects.toThrow();
    updater.emit('update-downloaded', { version: '0.3.1' }); await service.install();
    expect(service.status.phase).toBe('ready'); expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });
  it('does not interrupt an active take when restart is requested', async () => {
    const updater = new Updater(); const prepare = vi.fn(async () => true);
    const service = new UpdateService(updater, 'installed', '0.3.0', () => {}, prepare, () => false);
    updater.emit('update-downloaded', { version: '0.3.1' });
    await expect(service.install()).rejects.toThrow('Pause playback');
    expect(service.status.phase).toBe('ready'); expect(prepare).not.toHaveBeenCalled(); expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });
  it('reports errors, supports retry, and contains automatic download failures', async () => {
    const updater = new Updater(); const service = new UpdateService(updater, 'installed', '0.3.0', () => {}, async () => true);
    updater.checkForUpdates.mockRejectedValueOnce(new Error('offline'));
    await service.check(); expect(service.status.phase).toBe('error');
    updater.checkForUpdates.mockImplementationOnce(async () => { updater.emit('update-not-available'); return null; });
    await service.check(); expect(service.status.phase).toBe('current');
    updater.emit('error', new Error('download failed')); expect(service.status.phase).toBe('error');
  });
  it('checks on startup and periodically without overlapping downloads', async () => {
    vi.useFakeTimers(); const updater = new Updater();
    const service = new UpdateService(updater, 'installed', '0.3.0', () => {}, async () => true);
    service.start(); await vi.advanceTimersByTimeAsync(15_000); expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    updater.emit('update-available', { version: '0.3.1' });
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000); expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    service.stop();
  });
  it('defers checks during a take, retries every five minutes, and cancels retries on shutdown', async () => {
    vi.useFakeTimers(); const updater = new Updater(); let idle = false;
    const service = new UpdateService(updater, 'installed', '0.3.0', () => {}, async () => true, () => idle);
    service.start(); await vi.advanceTimersByTimeAsync(15_000);
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    expect((await service.check()).message).toMatch(/deferred.*playback/i);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    idle = true;
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 - 1);
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    idle = false; await service.check(); service.stop(); idle = true;
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
  });
});
