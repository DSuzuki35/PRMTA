import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, statSync, readFileSync } from 'node:fs';
import { mkdir, readdir, writeFile, rm, rename } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { downloadVerified } from './models';
import manifest from '../shared/parakeet-manifest.json';
import { PARAKEET_MODEL, type ParakeetAcceleration, type ParakeetStatus } from '../shared/parakeet';

export function validateParakeetWav(wav: Buffer) {
  if (wav.length < 44 || wav.length > 810_000 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Invalid audio. Expected a WAV recording of at most 25 seconds.');
  let format = false, data = false;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const size = wav.readUInt32LE(offset + 4), start = offset + 8;
    if (start + size > wav.length) throw new Error('Truncated WAV audio.');
    if (wav.toString('ascii', offset, offset + 4) === 'fmt ') {
      if (size < 16 || wav.readUInt16LE(start) !== 1 || wav.readUInt16LE(start + 2) !== 1 || wav.readUInt16LE(start + 14) !== 16) throw new Error('Parakeet requires mono PCM16 audio.');
      if (wav.readUInt32LE(start + 4) !== 16000) throw new Error('Parakeet requires audio at 16000 Hz.');
      format = true;
    }
    if (wav.toString('ascii', offset, offset + 4) === 'data') { if (!size || size > 800_000 || size % 2) throw new Error('Invalid audio duration.'); data = true; }
    offset = start + size + size % 2;
  }
  if (!format || !data) throw new Error('WAV audio is missing its format or samples.');
}

type Result = { text: string; ms: number };
export class ParakeetProcess {
  readonly ready: Promise<string>;
  private readyResolve!: (provider: string) => void;
  private readyReject!: (error: Error) => void;
  private startup: ReturnType<typeof setTimeout>;
  private pending?: { id: number; resolve: (result: Result) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
  private counter = 0;
  private stopped = false;
  private output = '';
  get busy() { return !!this.pending; }
  constructor(private child: ChildProcessWithoutNullStreams, private failure: (error: Error) => void = () => {}) {
    this.ready = new Promise((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject; });
    this.startup = setTimeout(() => { this.fail(new Error('Parakeet startup timed out. Try CPU acceleration.')); child.kill(); }, 120_000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      this.output += chunk;
      if (this.output.length > 64_000) { this.fail(new Error('Invalid response from Parakeet.')); child.kill(); return; }
      let end: number;
      while ((end = this.output.indexOf('\n')) >= 0) {
        const line = this.output.slice(0, end); this.output = this.output.slice(end + 1);
        try { this.receive(JSON.parse(line)); } catch { this.fail(new Error('Invalid response from Parakeet.')); child.kill(); }
      }
    });
    // Drain diagnostics without persisting model output or private audio/text.
    child.stderr.resume();
    child.on('error', error => this.fail(error));
    child.on('close', () => this.fail(new Error('Parakeet stopped. Reconnect the microphone to restart it.')));
    child.stdin.on('error', error => this.fail(error));
  }
  private receive(message: Record<string, unknown>) {
    if (message.type === 'ready' && typeof message.provider === 'string') { clearTimeout(this.startup); this.readyResolve(message.provider); return; }
    if (message.type === 'fatal') { this.fail(new Error(String(message.error || 'Parakeet could not load.'))); return; }
    const pending = this.pending;
    if (!pending || message.id !== pending.id) return;
    clearTimeout(pending.timer); this.pending = undefined;
    if (typeof message.error === 'string') pending.reject(new Error(message.error));
    else if (typeof message.text === 'string' && typeof message.ms === 'number' && Number.isFinite(message.ms)) pending.resolve({ text: message.text, ms: message.ms });
    else pending.reject(new Error('Invalid transcription response.'));
  }
  private fail(error: Error) {
    clearTimeout(this.startup); this.readyReject(error);
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = undefined; }
    if (!this.stopped) { this.stopped = true; this.failure(error); }
  }
  async transcribe(wav: Buffer): Promise<Result> {
    validateParakeetWav(wav);
    await this.ready;
    if (this.stopped) throw new Error('Parakeet is closed.');
    if (this.pending) throw new Error('Parakeet is busy. Wait for the current audio chunk.');
    const id = ++this.counter;
    return new Promise<Result>((resolve, reject) => {
      const timer = setTimeout(() => { this.fail(new Error('Parakeet transcription timed out. Reconnect the microphone.')); this.child.kill(); }, 60_000);
      this.pending = { id, resolve, reject, timer };
      this.child.stdin.write(JSON.stringify({ id, wav: wav.toString('base64') }) + '\n');
    });
  }
  async close() {
    this.stopped = true; this.fail(new Error('Parakeet is closed.'));
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    await new Promise<void>(resolve => {
      const force = setTimeout(() => this.child.kill(), 1500);
      this.child.once('close', () => { clearTimeout(force); resolve(); });
      this.child.stdin.end();
    });
  }
}

async function verified(path: string, size: number, sha256: string) {
  if (!existsSync(path) || statSync(path).size !== size) return false;
  const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex') === sha256;
}
function run(file: string, args: string[], signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], signal });
    let error = '', processError: Error | undefined; child.stderr.on('data', chunk => { error = (error + String(chunk)).slice(-2000); });
    // Wait for close after an abort, so a retry cannot race the old extractor.
    child.once('error', value => { processError = value; });
    child.once('close', code => code === 0 && !processError ? resolve() : reject(processError || new Error(error || `Parakeet setup exited (${code}).`)));
  });
}

export class ParakeetService {
  private root: string;
  private worker?: ParakeetProcess;
  private starting?: Promise<void>;
  private installing?: Promise<void>;
  private controller?: AbortController;
  private closed = false;
  private acceleration: ParakeetAcceleration = 'cpu';
  private state: ParakeetStatus;
  constructor(profileDir: string, private resourcesDir: string) {
    this.root = join(resolve(profileDir), 'parakeet', manifest.id);
    const supported = process.platform === 'win32' && process.arch === 'x64';
    const installed = this.isInstalled();
    this.state = { managed: true, supported, installed, phase: supported ? installed ? 'installed' : 'not-installed' : 'unavailable', model: PARAKEET_MODEL, provider: null, received: 0, total: manifest.files.reduce((sum, file) => sum + file.size, 0), percent: 0, message: supported ? installed ? 'Parakeet is installed. Connect the microphone to start.' : 'Install the optional local Parakeet model and runtime.' : 'Managed Parakeet requires Windows x64.', error: null };
  }
  private isInstalled() {
    try {
      return JSON.parse(readFileSync(join(this.root, 'installed.json'), 'utf8')).id === manifest.id && existsSync(join(this.root, 'runtime', 'python.exe')) && manifest.files.filter(file => file.name.startsWith('model/')).every(file => { const path = join(this.root, file.name); return existsSync(path) && statSync(path).size === file.size; });
    } catch { return false; }
  }
  status(): ParakeetStatus { return { ...this.state, installed: this.isInstalled(), requestedAcceleration: this.acceleration }; }
  private set(patch: Partial<ParakeetStatus>) { Object.assign(this.state, patch); }
  install(): Promise<void> {
    if (this.closed) return Promise.reject(new Error('Parakeet service is closed.'));
    if (!this.state.supported) return Promise.reject(new Error('Managed Parakeet requires Windows x64.'));
    if (this.installing) return this.installing;
    if (this.isInstalled() && this.state.phase !== 'error') return Promise.resolve();
    this.controller = new AbortController(); const signal = this.controller.signal;
    this.set({ phase: 'installing', error: null, received: 0, percent: 0, message: 'Downloading verified Parakeet files…' });
    this.installing = (async () => {
      // A failed startup may still be releasing DLLs. Complete that handoff
      // before replacing the runtime, and keep ensure() out until setup ends.
      await this.starting?.catch(() => {});
      const previous = this.worker; this.worker = undefined; await previous?.close();
      signal.throwIfAborted();
      this.set({ phase: 'installing', provider: null, error: null });
      await this.setup(signal);
    })().then(() => this.set({ phase: 'installed', installed: true, percent: 100, message: 'Parakeet is installed. Connect the microphone to start.' })).catch(error => {
      this.set({ phase: signal.aborted ? 'not-installed' : 'error', error: signal.aborted ? null : String(error), message: signal.aborted ? 'Parakeet setup cancelled. Completed verified downloads are kept for retry.' : 'Parakeet setup failed. Check the error below, then retry.' });
      if (!signal.aborted) throw error;
    }).finally(() => { this.installing = undefined; this.controller = undefined; });
    return this.installing;
  }
  private async setup(signal: AbortSignal) {
    await mkdir(this.root, { recursive: true });
    await rm(join(this.root, 'installed.json'), { force: true });
    const staging = join(this.root, 'runtime-staging');
    // This fixed child directory is the only staging cleanup target.
    if (!resolve(staging).startsWith(resolve(this.root) + sep)) throw new Error('Invalid Parakeet runtime directory.');
    await rm(staging, { recursive: true, force: true }); await mkdir(staging, { recursive: true });
    let completed = 0;
    for (const file of manifest.files) {
      signal.throwIfAborted();
      const target = join(this.root, file.name);
      // Recover abandoned downloads after a crash; only our UUID part files.
      if (existsSync(dirname(target))) for (const name of await readdir(dirname(target))) {
        if (name.startsWith(basename(target) + '.') && /\.[0-9a-f-]{36}\.part$/.test(name)) await rm(join(dirname(target), name), { force: true });
      }
      if (!await verified(target, file.size, file.sha256)) {
        this.set({ message: file.name.startsWith('model/') ? 'Downloading Parakeet multilingual model…' : 'Downloading the private recognition runtime…' });
        await downloadVerified(file.url, target, file.size, file.sha256, received => this.set({ received: completed + received, percent: Math.round((completed + received) / this.state.total * 100) }), fetch, signal);
      }
      completed += file.size; this.set({ received: completed, percent: Math.round(completed / this.state.total * 100) });
      if (file.name === 'python.zip') {
        this.set({ message: 'Checking Windows runtime prerequisites…' });
        await run(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', target, '-C', staging], signal);
        // Check actual DLL loading after only the 11 MB embedded interpreter,
        // before downloading any recognition wheels or the 670 MB model.
        await run(join(staging, 'python.exe'), ['-I', join(resolve(this.resourcesDir), 'parakeet-runtime.py'), '--check'], signal);
      }
    }
    signal.throwIfAborted(); this.set({ message: 'Preparing the private recognition runtime…' });
    await run(join(staging, 'python.exe'), ['-I', join(resolve(this.resourcesDir), 'parakeet-bootstrap.py'), join(this.root, 'wheels')], signal);
    await run(join(staging, 'python.exe'), ['-I', join(resolve(this.resourcesDir), 'parakeet-runtime.py'), '--verify'], signal);
    signal.throwIfAborted();
    const runtime = join(this.root, 'runtime');
    if (!resolve(runtime).startsWith(resolve(this.root) + sep)) throw new Error('Invalid Parakeet runtime directory.');
    await rm(runtime, { recursive: true, force: true }); await rename(staging, runtime);
    await writeFile(join(this.root, 'installed.json'), JSON.stringify({ id: manifest.id, modelRevision: manifest.modelRevision, installedAt: new Date().toISOString() }));
  }
  async cancelInstall() { this.controller?.abort(); await this.installing?.catch(() => {}); }
  async ensure(acceleration?: ParakeetAcceleration): Promise<void> {
    if (this.closed) throw new Error('Parakeet service is closed.');
    if (this.installing) throw new Error('Wait for Parakeet to finish setup before connecting the microphone.');
    if (!this.state.supported || !this.isInstalled()) throw new Error('Install Parakeet in Settings before connecting the microphone.');
    const selected = acceleration ?? this.acceleration;
    if (!['cpu', 'directml'].includes(selected)) throw new Error('Invalid Parakeet acceleration.');
    if (this.starting) { if (selected !== this.acceleration) throw new Error('Wait for Parakeet to finish starting before changing acceleration.'); return this.starting; }
    if (this.worker && selected === this.acceleration) return;
    if (this.worker?.busy) throw new Error('Disconnect the microphone before changing Parakeet acceleration.');
    this.acceleration = selected;
    this.starting = (async () => {
      const previous = this.worker; this.worker = undefined; await previous?.close();
      if (this.closed) throw new Error('Parakeet service is closed.');
      this.set({ phase: 'starting', provider: null, error: null, message: 'Loading and warming Parakeet. The first start can take a few seconds…' });
      const child = spawn(join(this.root, 'runtime', 'python.exe'), ['-I', '-u', join(resolve(this.resourcesDir), 'parakeet-worker.py'), join(this.root, 'model'), selected], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, HF_HUB_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1', PYTHONIOENCODING: 'utf-8' } });
      const worker = new ParakeetProcess(child, error => { if (this.worker === worker) { this.worker = undefined; this.set({ phase: 'error', provider: null, message: error.message, error: error.message }); } });
      this.worker = worker;
      try { const provider = await worker.ready; this.set({ phase: 'ready', provider, message: `Parakeet is ready · ${provider === 'DmlExecutionProvider' ? 'DirectML with CPU fallback' : 'CPU'}. Audio stays on this computer.`, error: null }); }
      catch (error) { await worker.close(); throw error; }
    })().finally(() => { this.starting = undefined; });
    return this.starting;
  }
  async transcribe(wav: Buffer): Promise<Result> { validateParakeetWav(wav); await this.ensure(); if (!this.worker) throw new Error('Parakeet is not ready.'); return this.worker.transcribe(wav); }
  async close() { this.closed = true; await this.cancelInstall(); const worker = this.worker; this.worker = undefined; await worker?.close(); await this.starting?.catch(() => {}); }
}
