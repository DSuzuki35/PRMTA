import { app, BrowserWindow, dialog, ipcMain, screen, session as electronSession, shell, powerSaveBlocker } from 'electron';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { createHost, type Host } from '../server/host';
import { WhisperService } from './whisper';
import { ModelStore } from './models';

let main: BrowserWindow | null = null; let host: Host; const outputs = new Map<number, BrowserWindow>();
let closing = false;
let whisper: WhisperService;
let models: ModelStore;
app.setName('PRMTA');
// Preserve the original profile and drafts when upgrading from PRMPT 0.1.
const legacyProfile = join(app.getPath('appData'), 'PRMPT');
if (process.env.PRMTA_PROFILE_DIR) app.setPath('userData', process.env.PRMTA_PROFILE_DIR);
else if (!existsSync(app.getPath('userData')) && existsSync(legacyProfile)) app.setPath('userData', legacyProfile);
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (main?.isMinimized()) main.restore(); main?.focus(); });
  app.whenReady().then(async () => {
    const dataDir = process.env.PRMTA_DATA_DIR || process.env.PRMPT_DATA_DIR || join(app.getPath('userData'), 'library');
    const whisperRoot = app.isPackaged ? join(process.resourcesPath, 'whisper') : join(__dirname, '../.tools/whisper');
    models = new ModelStore(whisperRoot, join(app.getPath('userData'), 'models'));
    whisper = new WhisperService(whisperRoot, id => models.path(id));
    const hostOptions = { dataDir, staticDir: join(__dirname, '../dist'), ensureSpeech: (url: string, model: string) => whisper.ensure(url, model), models: { list: () => ({ managed: true, models: models.list(), activeModel: whisper.activeModel }), install: (id: string) => models.install(id) } };
    try { host = await createHost({ ...hostOptions, port: 4317 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error; host = await createHost({ ...hostOptions, port: 0 }); }
    const safeWindow = (win: BrowserWindow) => {
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== host.origin) event.preventDefault(); });
    };
    main = new BrowserWindow({ title: 'PRMTA — Your words. Your pace.', icon: join(__dirname, '../build/icon.png'), width: 1480, height: 1000, minWidth: 800, minHeight: 650, backgroundColor: '#111214', autoHideMenuBar: true, show: false,
      webPreferences: { preload: join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false },
    });
    safeWindow(main);
    main.webContents.on('will-prevent-unload', event => {
      const choice = dialog.showMessageBoxSync(main!, { type: 'warning', buttons: ['Keep editing', 'Close anyway'], defaultId: 0, cancelId: 0, title: 'Unsaved draft', message: 'This draft could not be backed up. Keep editing to save or export your text before closing.' });
      if (choice === 1) event.preventDefault();
    });
    electronSession.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
      callback(contents === main?.webContents && permission === 'media' && details.requestingUrl.startsWith(host.origin + '/') && 'mediaTypes' in details && !details.mediaTypes?.includes('video'));
    });
    electronSession.defaultSession.setPermissionCheckHandler((contents, permission, origin) => contents === main?.webContents && permission === 'media' && origin.startsWith(host.origin));
    const admin = (event: Electron.IpcMainInvokeEvent) => { if (event.sender !== main?.webContents || !event.senderFrame?.url.startsWith(host.origin + '/')) throw new Error('Untrusted window'); };
    ipcMain.handle('displays', event => { admin(event); const primary = screen.getPrimaryDisplay().id; return screen.getAllDisplays().map((d, i) => ({ id: d.id, label: d.label || `Display ${i + 1}`, width: d.size.width, height: d.size.height, primary: primary === d.id })); });
    ipcMain.handle('output', async (event, id: number, profile: string) => {
      admin(event); const display = screen.getAllDisplays().find(d => d.id === id); if (!display) throw new Error('Display disconnected. Refresh the list.');
      if (!['display', 'vr'].includes(profile)) throw new Error('Invalid output profile.');
      const existing = outputs.get(id); if (existing) { existing.show(); existing.focus(); return; }
      const win = new BrowserWindow({ title: 'PRMTA Output', ...display.bounds, frame: false, fullscreen: true, backgroundColor: '#101113', autoHideMenuBar: true,
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false },
      });
      outputs.set(id, win); safeWindow(win); win.on('closed', () => outputs.delete(id));
      win.webContents.on('before-input-event', (_event, input) => { if (input.type === 'keyDown' && input.key === 'Escape') win.close(); });
      await win.loadURL(host.url('output', host.origin, profile));
    });
    ipcMain.handle('close-outputs', event => { admin(event); for (const output of outputs.values()) output.close(); });
    ipcMain.handle('choose-folder', async event => { admin(event); const result = await dialog.showOpenDialog(main!, { title: 'PRMTA Choose cloud folder', properties: ['openDirectory', 'createDirectory'] }); return result.canceled ? null : result.filePaths[0]; });
    ipcMain.handle('open-browser', async (event, url: string) => { admin(event); const target = new URL(url); if (target.origin !== host.origin || !['/output', '/remote'].includes(target.pathname)) throw new Error('Invalid output link.'); await shell.openExternal(url); });
    screen.on('display-removed', (_event, display) => outputs.get(display.id)?.close());
    screen.on('display-metrics-changed', (_event, display) => { const win = outputs.get(display.id); if (win) win.setBounds(display.bounds); });
    powerSaveBlocker.start('prevent-display-sleep');
    main.once('ready-to-show', () => main?.show()); main.on('closed', () => { main = null; for (const output of outputs.values()) output.close(); });
    await main.loadURL(host.url('admin'));
  }).catch(error => { dialog.showErrorBox('PRMTA could not start', String(error)); app.quit(); });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', event => { if (host && !closing) { event.preventDefault(); closing = true; whisper?.close(); void Promise.all([models?.close(), host.close()]).finally(() => app.exit(0)); } });
}
