import { app, BrowserWindow, clipboard, dialog, ipcMain, screen, session as electronSession, shell, powerSaveBlocker } from 'electron';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { createHost, type Host } from '../server/host';
import { WhisperService } from './whisper';
import { ModelStore } from './models';
import { autoUpdater } from 'electron-updater';
import { UpdateService, updateMode, closeForUpdate } from './updater';
import { RELEASES_URL } from '../shared/updater';
import { NativeControllerService, type ControllerSampler } from './controller-service';
import { createSdlControllerSampler } from './controller-sdl';
import type { ControllerContext, ControllerState } from '../shared/controller';
import { ParakeetService } from './parakeet';
import type { ParakeetAcceleration } from '../shared/parakeet';

let main: BrowserWindow | null = null; let host: Host; const outputs = new Map<number, BrowserWindow>();
let closing = false;
let whisper: WhisperService;
let parakeet: ParakeetService;
let models: ModelStore;
let updates: UpdateService;
let installing = false;
let controllers: NativeControllerService;
let shutdown: Promise<unknown> | undefined;
function closeServices() {
  if (!shutdown) { closing = true; controllers?.close(); updates?.stop(); whisper?.close(); shutdown = Promise.all([models?.close(), parakeet?.close(), host?.close()]); }
  return shutdown;
}
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
    parakeet = new ParakeetService(app.getPath('userData'), app.isPackaged ? join(process.resourcesPath, 'parakeet') : join(__dirname, '../scripts'));
    const hostOptions = { dataDir, staticDir: join(__dirname, '../dist'), canControl: () => !installing, ensureSpeech: (url: string, model: string) => whisper.ensure(url, model), models: { list: () => ({ managed: true, models: models.list(), activeModel: whisper.activeModel }), install: (id: string) => models.install(id) }, parakeet: { status: () => parakeet.status(), install: () => parakeet.install(), ensure: (acceleration?: ParakeetAcceleration) => parakeet.ensure(acceleration), transcribe: (wav: Buffer) => parakeet.transcribe(wav), cancelInstall: () => parakeet.cancelInstall() } };
    try { host = await createHost({ ...hostOptions, port: 4317 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error; host = await createHost({ ...hostOptions, port: 0 }); }
    const safeWindow = (win: BrowserWindow) => {
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== host.origin) event.preventDefault(); });
    };
    main = new BrowserWindow({ title: 'PRMTA | Your words. Your pace.', icon: join(__dirname, '../build/icon.png'), width: 1480, height: 1000, minWidth: 800, minHeight: 650, backgroundColor: '#111214', autoHideMenuBar: true, show: false,
      webPreferences: { preload: join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false },
    });
    safeWindow(main);
    main.webContents.on('will-prevent-unload', event => {
      // An update never overrides the editor's unload protection.
      if (installing) return;
      const choice = dialog.showMessageBoxSync(main!, { type: 'warning', buttons: ['Keep editing', 'Close anyway'], defaultId: 0, cancelId: 0, title: 'Unsaved draft', message: 'This draft could not be backed up. Keep editing to save or export your text before closing.' });
      if (choice === 1) event.preventDefault();
    });
    electronSession.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
      callback(contents === main?.webContents && permission === 'media' && details.requestingUrl.startsWith(host.origin + '/') && 'mediaTypes' in details && !details.mediaTypes?.includes('video'));
    });
    electronSession.defaultSession.setPermissionCheckHandler((contents, permission, origin) => contents === main?.webContents && permission === 'media' && origin.startsWith(host.origin));
    const admin = (event: Electron.IpcMainInvokeEvent) => { if (event.sender !== main?.webContents || event.senderFrame !== main?.webContents.mainFrame || !event.senderFrame?.url.startsWith(host.origin + '/')) throw new Error('Untrusted window'); };
    let sampler: ControllerSampler | null = null;
    let unavailable: Pick<ControllerState, 'status' | 'message'> | undefined;
    if (process.platform !== 'win32') unavailable = { status: 'unsupported', message: 'Native background controller input is available in the Windows app.' };
    else try { sampler = await createSdlControllerSampler(); }
    catch (error) { unavailable = { status: 'error', message: `Native controller input could not start: ${String(error).replace(/^Error: /, '')}` }; }
    controllers = new NativeControllerService({ sampler, unavailable, getPreferences: () => host.getPreferences(), dispatch: command => host.dispatchCommand(command), isFocused: () => !!main?.isFocused(), canControl: () => !closing && !installing });
    ipcMain.handle('controller-state', event => { admin(event); return controllers.state; });
    ipcMain.handle('controller-context', (event, context: ControllerContext) => {
      admin(event);
      if (!context || typeof context.blocked !== 'boolean' || typeof context.assigning !== 'boolean') throw new Error('Invalid controller context.');
      controllers.setContext({ blocked: context.blocked, assigning: context.assigning });
    });
    // A dead or reloading renderer must explicitly establish its UI context
    // again, but normal blur/minimize never invalidates native background input.
    main.webContents.on('did-start-loading', () => controllers.invalidateContext());
    main.webContents.on('render-process-gone', () => controllers.invalidateContext());
    main.on('unresponsive', () => controllers.invalidateContext());
    main.on('closed', () => controllers.invalidateContext());
    updates = new UpdateService(autoUpdater, updateMode(app.isPackaged, process.platform, !!(process.env.PORTABLE_EXECUTABLE_DIR || process.env.PORTABLE_EXECUTABLE_FILE), existsSync(join(dirname(process.execPath), 'Uninstall PRMTA.exe'))), app.getVersion(), status => {
      if (main && !main.isDestroyed()) main.webContents.send('update-status', status);
    }, async () => {
      if (!main || main.isDestroyed()) return false;
      installing = true;
      const closed = await closeForUpdate(main);
      if (!closed) { installing = false; return false; }
      await closeServices();
      return true;
    }, () => !host.session.state.playing && !host.session.scrolling);
    ipcMain.handle('update-status', event => { admin(event); return updates.status; });
    ipcMain.handle('update-check', event => { admin(event); return updates.check(); });
    ipcMain.handle('update-install', async event => {
      admin(event);
      const status = await updates.install();
      if (status.phase === 'error' && !main) { dialog.showErrorBox('PRMTA update could not start', 'Your work has been saved. Reopen PRMTA and retry the update, or download Setup from the official release page.'); app.quit(); }
      return status;
    });
    ipcMain.handle('update-releases', async event => { admin(event); await shell.openExternal(RELEASES_URL); });
    ipcMain.handle('copy-text', async (event, text: string) => { admin(event); if (typeof text !== 'string' || text.length > 16000) throw new Error('Invalid clipboard text.'); await clipboard.writeText(text); });
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
    ipcMain.handle('parakeet-runtime-help', async event => { admin(event); await shell.openExternal('https://aka.ms/vc14/vc_redist.x64.exe'); });
    ipcMain.handle('open-browser', async (event, url: string) => { admin(event); const target = new URL(url); if (target.origin !== host.origin || !['/output', '/remote'].includes(target.pathname)) throw new Error('Invalid output link.'); await shell.openExternal(url); });
    screen.on('display-removed', (_event, display) => outputs.get(display.id)?.close());
    screen.on('display-metrics-changed', (_event, display) => { const win = outputs.get(display.id); if (win) win.setBounds(display.bounds); });
    powerSaveBlocker.start('prevent-display-sleep');
    main.once('ready-to-show', () => main?.show()); main.on('closed', () => { main = null; for (const output of outputs.values()) output.close(); });
    await main.loadURL(host.url('admin'));
    updates.start();
  }).catch(error => { dialog.showErrorBox('PRMTA could not start', String(error)); app.quit(); });
  app.on('window-all-closed', () => { if (!installing) app.quit(); });
  // Complete the deferred ordinary quit directly. Re-entering app.quit() from
  // this cancelled will-quit can leave Electron headless. Update installation
  // already closes services (closing=true) before its own quitAndInstall path.
  app.on('will-quit', event => { if (host && !closing) { event.preventDefault(); void closeServices().finally(() => app.exit(0)); } });
}
