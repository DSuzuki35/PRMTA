import express, { type Request, type Response, type NextFunction } from 'express';
import { createServer, type Server } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join, resolve, relative, parse } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import mammoth from 'mammoth';
import { z, ZodError } from 'zod';
import { Library } from './library';
import { CloudLibrary } from './cloud-library';
import { Session } from './session';
import { commandSchema, defaultPreferences, draftSchema, preferencesSchema, type Draft } from '../shared/model';
import { modelById, type ModelsInfo } from '../shared/whisper-models';
import { whisperEndpoint } from '../shared/whisper-endpoint';

type Role = 'admin' | 'output' | 'remote';
type AuthRequest = Request & { role?: Role };
const isLocal = (address?: string) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address ?? '');
export async function createHost(options: { dataDir: string; port?: number; staticDir?: string; ensureSpeech?: (url: string, model: string) => Promise<void>; models?: { list: () => ModelsInfo; install: (id: string) => void } }) {
  const localLibrary = new Library(options.dataDir); let library = localLibrary;
  let cloud: CloudLibrary | null = null;
  const opened = new Map<string, Library>(); const session = new Session();
  let preferences = preferencesSchema.parse(library.getSetting('preferences', defaultPreferences));
  const tokens = library.getSetting<Record<Role, string>>('tokens', { admin: randomBytes(32).toString('hex'), output: randomBytes(32).toString('hex'), remote: randomBytes(32).toString('hex') });
  library.setSetting('tokens', tokens);
  session.state.speed = preferences.speed; session.state.loop = preferences.loop;
  const app = express(); const sockets = new Map<WebSocket, Role>(); const socketServers = new Map<WebSocket, Server>();
  const servers: Server[] = []; let lan: Server | null = null; let lanPort = 0;
  let syncStatus = { errors: [] as string[], imported: 0, exported: 0, at: '' };
  let speechBusy = false;
  const approvedClouds = localLibrary.getSetting<string[]>('approvedCloudLibraries', []);
  let upgradeRequired = !!preferences.cloudFolder && !approvedClouds.includes(resolve(preferences.cloudFolder));
  const workspaceKey = () => cloud ? `cloud:${createHash('sha256').update(cloud.folder.toLowerCase()).digest('hex').slice(0, 24)}` : 'local';
  const openCloud = (folder: string, create = false) => {
    const root = resolve(folder), local = resolve(options.dataDir);
    const inside = (a: string, b: string) => { const r = relative(a, b); return !r || (!r.startsWith('..') && !r.includes(':')); };
    if (root === parse(root).root || inside(local, root) || inside(root, local)) throw new Error('Choose a separate scripts folder outside the application database.');
    if (create) mkdirSync(root, { recursive: true });
    const key = createHash('sha256').update(process.platform === 'win32' ? root.toLowerCase() : root).digest('hex');
    let cache = opened.get(key);
    if (!cache) { cache = new Library(join(options.dataDir, 'workspaces', key)); opened.set(key, cache); }
    return new CloudLibrary(cache, root, join(options.dataDir, 'backups'));
  };
  if (preferences.cloudFolder && !upgradeRequired) {
    try { cloud = openCloud(preferences.cloudFolder); library = cloud.library; cloud.sync(); }
    catch (e) { syncStatus.errors = [String(e)]; }
  }
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws:; media-src 'self' blob:; object-src 'none'; frame-ancestors 'none'");
    next();
  });
  const roleFor = (token: string) => (Object.keys(tokens) as Role[]).find(r => tokens[r] === token);
  app.use('/api', (req: AuthRequest, res, next) => {
    req.role = roleFor((req.headers.authorization ?? '').replace(/^Bearer /, ''));
    if (!req.role) { res.status(401).json({ error: 'Connection link missing or invalid.' }); return; }
    if (req.role === 'admin' && !isLocal(req.socket.remoteAddress)) { res.status(403).json({ error: 'Studio is only available on this computer.' }); return; }
    res.setHeader('Cache-Control', 'no-store'); next();
  });
  const allow = (...roles: Role[]) => (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!roles.includes(req.role!)) { res.status(403).json({ error: 'This output does not have permission for this action.' }); return; } next();
  };
  const admin = allow('admin'); const control = allow('admin', 'remote');
  app.use(express.json({ limit: '2mb' }));
  const state = (role: Role) => ({ type: 'state', session: session.snapshot(), workspace: role === 'admin' ? workspaceKey() : undefined, upgradeRequired: role === 'admin' ? upgradeRequired : undefined, preferences: role === 'admin' ? preferences : { profiles: preferences.profiles, countdown: preferences.countdown } });
  const broadcast = (kind: 'state' | 'tick' | 'library') => {
    for (const [ws, role] of sockets) {
      if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 2_000_000) continue;
      if (kind === 'library' && role !== 'admin') continue;
      ws.send(JSON.stringify(kind === 'state' ? state(role) : kind === 'library' ? { type: 'library' } : { type: 'tick', session: { ...session.state, script: undefined } }));
    }
  };
  const sync = () => {
    if (upgradeRequired) return { ...syncStatus, errors: ['Open your cloud library in Settings to confirm the new folder format.'] };
    try { syncStatus = { ...(cloud ? cloud.sync() : { errors: [], imported: 0, exported: 0 }), at: new Date().toISOString() }; if (syncStatus.imported) broadcast('library'); }
    catch (e) { syncStatus = { errors: [String(e)], imported: 0, exported: 0, at: new Date().toISOString() }; }
    return syncStatus;
  };
  app.get('/api/state', (req: AuthRequest, res) => res.json(state(req.role!)));
  app.get('/api/scripts', admin, (_req, res) => res.json(library.list().map(s => ({ ...s, workspace: workspaceKey(), storage: cloud ? 'cloud' : 'local' }))));
  app.post('/api/scripts', admin, (req, res) => {
    const body = z.object({ draft: draftSchema, expectedHeads: z.array(z.string().uuid()).max(100), workspace: z.string().optional() }).parse(req.body);
    if (body.workspace !== undefined ? body.workspace !== workspaceKey() : !!cloud) { res.status(409).json({ error: 'Library changed. Reopen the script in the active library before saving.' }); return; }
    try {
      const saved = cloud ? cloud.save(body.draft, body.expectedHeads) : library.save(body.draft, body.expectedHeads); res.json({ ...saved, workspace: workspaceKey(), storage: cloud ? 'cloud' : 'local' });
    } finally { broadcast('library'); } // A rejected save may already have imported an external edit.
  });
  app.get('/api/scripts/:id/history', admin, (req, res) => res.json(library.history(String(req.params.id))));
  app.get('/api/recovery/:id', admin, (req, res) => {
    const draft = library.getSetting<Draft[]>('recoveredCloudDrafts', []).find(d => d.id === req.params.id);
    if (!draft) { res.sendStatus(404); return; } res.json(draft);
  });
  app.post('/api/recovery', admin, (req, res) => {
    const { id, workspace } = z.object({ id: z.string().uuid(), workspace: z.string() }).parse(req.body);
    if (workspace !== workspaceKey()) { res.status(409).json({ error: 'Library changed. Reopen Settings.' }); return; }
    const drafts = library.getSetting<Draft[]>('recoveredCloudDrafts', []), draft = drafts.find(d => d.id === id);
    if (!draft) { res.sendStatus(404); return; }
    const saved = cloud ? cloud.save(draft, []) : library.save(draft, []);
    library.setSetting('recoveredCloudDrafts', drafts.filter(d => d.id !== id)); broadcast('library'); res.json(saved);
  });
  app.post('/api/load', admin, (req, res) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.body);
    const script = library.get(id);
    if (!script || script.deleted) { res.status(404).json({ error: 'Script not found.' }); return; }
    session.load(script); broadcast('state'); res.json({ ok: true });
  });
  app.post('/api/command', control, (req: AuthRequest, res) => {
    const command = commandSchema.parse(req.body);
    if (['transcript', 'voiceActivity'].includes(command.type) && req.role !== 'admin') { res.sendStatus(403); return; }
    session.command(command.type === 'play' && command.countdown === undefined ? { ...command, countdown: preferences.countdown } : command);
    // Audio heartbeats are small and frequent. The existing ticker publishes the
    // visual position; never echo a potentially book-length script on each beat.
    if (command.type === 'voiceActivity') { res.json(null); return; }
    broadcast('tick'); res.json(session.snapshot());
  });
  app.post('/api/preferences', admin, (req, res) => {
    const next = preferencesSchema.parse(req.body);
    if (next.cloudFolder !== preferences.cloudFolder) { res.status(409).json({ error: 'Use Switch library and choose whether to copy your current scripts.' }); return; }
    if (next.cloudFolder && resolve(next.cloudFolder) === library.dir) throw new Error('Cloud folder and database folder must be different.');
    if (next.speed !== preferences.speed) session.command({ type: 'speed', speed: next.speed });
    if (next.loop !== preferences.loop) session.command({ type: 'loop', loop: next.loop });
    preferences = next; localLibrary.setSetting('preferences', preferences);
    broadcast('state'); res.json(preferences);
  });
  app.post('/api/sync', admin, (_req, res) => res.json(sync()));
  app.post('/api/workspace', admin, (req, res) => {
    const { folder, copyCurrent } = z.object({ folder: z.string().max(2000), copyCurrent: z.boolean() }).parse(req.body);
    const source = library.list().filter(s => !s.deleted);
    const next = folder ? openCloud(folder, true) : null;
    if (next) {
      next.sync();
      if (copyCurrent) for (const s of source) {
        const existing = next.library.list().filter(s => !s.deleted);
        if (!existing.some(e => e.id === s.id || (e.title === s.title && e.content === s.content))) next.save(s, next.library.get(s.id)?.heads ?? []);
      }
    }
    cloud = next; library = next?.library ?? localLibrary;
    upgradeRequired = false;
    if (next && !approvedClouds.includes(next.folder)) { approvedClouds.push(next.folder); localLibrary.setSetting('approvedCloudLibraries', approvedClouds); }
    preferences = { ...preferences, cloudFolder: next?.folder ?? '' }; localLibrary.setSetting('preferences', preferences);
    session.command({ type: 'reset' }); session.state.script = null;
    syncStatus = { errors: [], imported: 0, exported: 0, at: new Date().toISOString() };
    broadcast('state'); broadcast('library'); res.json(preferences);
  });
  app.post('/api/import/docx', admin, express.raw({ type: 'application/octet-stream', limit: '10mb' }), async (req, res) => {
    if (!Buffer.isBuffer(req.body)) { res.status(400).json({ error: 'DOCX file missing.' }); return; }
    const result = await mammoth.extractRawText({ buffer: req.body }); res.json({ text: result.value });
  });
  const whisperBase = (value = preferences.whisperUrl) => whisperEndpoint(value).origin;
  app.get('/api/speech/status', admin, async (req, res) => {
    const { whisperUrl } = z.object({ whisperUrl: z.string().max(2000).optional() }).parse(req.query);
    try { const response = await fetch(`${whisperBase(whisperUrl)}/health`, { signal: AbortSignal.timeout(2500), redirect: 'error' }); const body = await response.json() as { status?: string }; const ok = response.ok && body.status === 'ok'; res.json({ ok, message: ok ? 'Whisper connected' : 'No compatible Whisper server at this address.' }); }
    catch { res.json({ ok: false, message: 'Voice is not running yet. Use Set up voice to prepare it.' }); }
  });
  app.post('/api/speech/start', admin, async (req, res) => {
    const { model, whisperUrl } = z.object({ model: preferencesSchema.shape.whisperModel.optional(), whisperUrl: z.string().max(2000).optional() }).parse(req.body ?? {});
    if (!options.ensureSpeech) { res.status(503).json({ error: 'Built-in voice setup is available in the Windows app. Check your external server connection.' }); return; }
    if (speechBusy) { res.status(409).json({ error: 'Wait for the current transcription before switching models.' }); return; }
    await options.ensureSpeech(whisperBase(whisperUrl), model ?? preferences.whisperModel); res.json({ ok: true });
  });
  app.get('/api/speech/models', admin, (_req, res) => res.json(options.models?.list() ?? { managed: false, models: [], activeModel: null }));
  app.post('/api/speech/models/install', admin, (req, res) => {
    const { id } = z.object({ id: preferencesSchema.shape.whisperModel }).parse(req.body); modelById(id);
    if (!options.models) { res.status(503).json({ error: 'Model downloads are available in the desktop app. Configure your standalone Whisper server separately.' }); return; }
    options.models.install(id); res.json(options.models.list());
  });
  app.post('/api/speech', admin, express.raw({ type: 'audio/wav', limit: '1mb' }), async (req, res) => {
    const { whisperUrl } = z.object({ whisperUrl: z.string().max(2000).optional() }).parse(req.query);
    const endpoint = whisperBase(whisperUrl);
    if (speechBusy) { res.status(429).json({ error: 'Speech recognition is still processing the previous audio.' }); return; }
    if (!Buffer.isBuffer(req.body) || req.body.length < 44 || req.body.toString('ascii', 0, 4) !== 'RIFF' || req.body.toString('ascii', 8, 12) !== 'WAVE') { res.status(400).json({ error: 'Expected valid WAV audio.' }); return; }
    speechBusy = true;
    try {
      const form = new FormData(); form.append('file', new Blob([new Uint8Array(req.body)], { type: 'audio/wav' }), 'speech.wav');
      form.append('response_format', 'json'); form.append('language', preferences.language); form.append('temperature', '0');
      const response = await fetch(`${endpoint}/inference`, { method: 'POST', body: form, signal: AbortSignal.timeout(20000), redirect: 'error' });
      if (!response.ok) throw new Error(`Whisper HTTP ${response.status}`);
      const result = await response.json() as { text?: string };
      res.json({ text: typeof result.text === 'string' ? result.text.slice(0, 2000).trim() : '' });
    } catch { res.status(502).json({ error: 'Whisper unavailable or too slow. Check the server and model.' }); }
    finally { speechBusy = false; }
  });
  const createListener = async (port: number, hostname: string) => {
    const server = createServer(app); const wss = new WebSocketServer({ noServer: true, maxPayload: 4096, handleProtocols: protocols => protocols.has('prmpt') ? 'prmpt' : false });
    server.on('upgrade', (req, socket, head) => {
      const protocols = String(req.headers['sec-websocket-protocol'] ?? '').split(',').map(s => s.trim());
      const role = protocols.map(roleFor).find(Boolean);
      if (!role || req.url !== '/ws' || (role === 'admin' && !isLocal(req.socket.remoteAddress))) { socket.destroy(); return; }
      wss.handleUpgrade(req, socket, head, ws => { sockets.set(ws, role); socketServers.set(ws, server); ws.send(JSON.stringify(state(role))); ws.on('close', () => { sockets.delete(ws); socketServers.delete(ws); }); ws.on('error', () => { sockets.delete(ws); socketServers.delete(ws); }); });
    });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, hostname, () => { server.off('error', reject); resolve(); }); });
    servers.push(server); return server;
  };
  let local: Server;
  try { local = await createListener(options.port ?? 4317, '127.0.0.1'); }
  catch (error) { library.close(); throw error; }
  const port = (local.address() as { port: number }).port; const origin = `http://127.0.0.1:${port}`;
  const url = (role: Role, base = origin, profile = 'display') => `${base}/${role === 'admin' ? '' : role === 'output' ? `output?profile=${profile}` : 'remote'}#${tokens[role]}`;
  const info = () => ({ origin, outputUrl: url('output'), vrUrl: url('output', origin, 'vr'), remoteUrl: url('remote'), dataDir: library.dir, sync: syncStatus, workspace: workspaceKey(), upgradeRequired, cloudFolder: preferences.cloudFolder, legacyBackup: library.getSetting<string>('legacyBackup', ''),
    recoveredDrafts: library.getSetting<Draft[]>('recoveredCloudDrafts', []).map(d => ({ id: d.id, title: d.title })),
    connections: [...sockets.values()].filter(r => r !== 'admin').length, lanEnabled: !!lan,
    lanUrls: lan ? Object.values(networkInterfaces()).flatMap(list => (list ?? []).filter(n => n.family === 'IPv4' && !n.internal).map(n => ({ output: url('output', `http://${n.address}:${lanPort}`), remote: url('remote', `http://${n.address}:${lanPort}`) }))) : [],
  });
  app.get('/api/info', admin, (_req, res) => res.json(info()));
  app.post('/api/network', admin, async (req, res) => {
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    if (enabled && !lan) { lan = await createListener(0, '0.0.0.0'); lanPort = (lan.address() as { port: number }).port; }
    if (!enabled && lan) {
      const closing = lan; lan = null;
      // Disconnect only clients on this listener; local outputs remain connected.
      for (const [socket, server] of socketServers) if (server === closing) socket.terminate();
      closing.closeAllConnections(); await new Promise<void>(r => closing.close(() => r()));
    }
    res.json(info());
  });
  if (options.staticDir) {
    app.use(express.static(options.staticDir));
    app.get(['/', '/output', '/remote'], (_req, res) => res.sendFile(join(resolve(options.staticDir!), 'index.html')));
  }
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown action.' }));
  app.use((error: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    res.status(error instanceof ZodError ? 400 : error.status ?? 500).json({ error: error instanceof ZodError ? 'Invalid input. Check values and file format.' : error.message });
  });
  const ticker = setInterval(() => { if (session.state.playing) { session.tick(); broadcast('tick'); } }, 100);
  const syncTimer = setInterval(sync, 5000);
  return { origin, tokens, url, get library() { return library; }, session, info,
    async close() { clearInterval(ticker); clearInterval(syncTimer); for (const ws of sockets.keys()) ws.terminate(); await Promise.all(servers.map(s => new Promise<void>(r => { s.closeAllConnections(); s.close(() => r()); }))); for (const cache of opened.values()) cache.close(); localLibrary.close(); },
  };
}
export type Host = Awaited<ReturnType<typeof createHost>>;
export type HostInfo = ReturnType<Host['info']>;
