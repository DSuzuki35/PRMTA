import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { SystemSpeechLanguage, SystemSpeechStatus } from '../shared/system-speech';

type Result = { text: string; ms: number };
type Ready = { languages: string[]; language?: string };

export function selectSystemSpeechLanguage(languages: string[], language: SystemSpeechLanguage): string {
  if (!['en', 'de', 'auto'].includes(language)) throw new Error('Invalid system speech language.');
  const prefix = language === 'de' ? 'de' : 'en';
  const selected = languages.find(value => value.toLowerCase() === `${prefix}-${prefix === 'en' ? 'us' : 'de'}`) || languages.find(value => value.toLowerCase().startsWith(`${prefix}-`));
  if (!selected) throw new Error(`No installed ${prefix === 'en' ? 'English' : 'German'} offline speech recognizer. Install the language's speech support in system settings.`);
  return selected;
}

export function validateSystemSpeechWav(wav: Buffer) {
  if (wav.length < 44 || wav.length > 810_000 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE' || wav.readUInt32LE(4) !== wav.length - 8) throw new Error('Invalid audio. Expected a WAV recording of at most 25 seconds.');
  let format = false, data = false;
  for (let offset = 12; offset < wav.length;) {
    if (offset + 8 > wav.length) throw new Error('Truncated WAV audio.');
    const size = wav.readUInt32LE(offset + 4), start = offset + 8, end = start + size + size % 2;
    if (end > wav.length) throw new Error('Truncated WAV audio.');
    const kind = wav.toString('ascii', offset, offset + 4);
    if (kind === 'fmt ') {
      if (format || size < 16 || wav.readUInt16LE(start) !== 1 || wav.readUInt16LE(start + 2) !== 1 || wav.readUInt16LE(start + 14) !== 16) throw new Error('System speech requires mono PCM16 audio.');
      if (wav.readUInt32LE(start + 4) !== 16000) throw new Error('System speech requires audio at 16000 Hz.');
      if (wav.readUInt32LE(start + 8) !== 32000 || wav.readUInt16LE(start + 12) !== 2) throw new Error('Invalid PCM byte rate or alignment.');
      format = true;
    }
    if (kind === 'data') { if (!format || data || !size || size > 800_000 || size % 2) throw new Error('Invalid audio duration or WAV data.'); data = true; }
    offset = end;
  }
  if (!format || !data) throw new Error('WAV audio is missing its format or samples.');
}

export class SystemSpeechProcess {
  readonly ready: Promise<Ready>;
  private readyResolve!: (ready: Ready) => void;
  private readyReject!: (error: Error) => void;
  private startup: ReturnType<typeof setTimeout>;
  private pending?: { id: number; resolve: (result: Result) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
  private counter = 0;
  private stopped = false;
  private output = '';
  get busy() { return !!this.pending; }
  constructor(private child: ChildProcessWithoutNullStreams, private failure: (error: Error) => void = () => {}, private timeouts = { startupMs: 120_000, requestMs: 45_000 }) {
    this.ready = new Promise((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject; });
    this.startup = setTimeout(() => this.fail(new Error('System speech startup timed out. Check speech permission and installed languages.')), timeouts.startupMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (this.stopped) return;
      this.output += chunk;
      if (this.output.length > 64_000) { this.fail(new Error('Invalid response from system speech.')); return; }
      let end: number;
      while ((end = this.output.indexOf('\n')) >= 0) {
        const line = this.output.slice(0, end); this.output = this.output.slice(end + 1);
        try { this.receive(JSON.parse(line)); } catch { this.fail(new Error('Invalid response from system speech.')); return; }
      }
    });
    // Consume diagnostics without recording private audio or recognition text.
    child.stderr.resume();
    child.on('error', error => this.fail(error));
    child.on('close', () => this.fail(new Error('System speech stopped. Reconnect the microphone to restart.')));
    child.stdin.on('error', error => this.fail(error));
  }
  private receive(message: Record<string, unknown>) {
    if (!message || typeof message !== 'object') throw new Error('Invalid response');
    if (message.type === 'ready') {
      if (!Array.isArray(message.languages) || message.languages.some(value => typeof value !== 'string') || (message.language !== undefined && typeof message.language !== 'string')) throw new Error('Invalid readiness response');
      clearTimeout(this.startup); this.readyResolve({ languages: message.languages, language: message.language as string | undefined }); return;
    }
    if (message.type === 'fatal') { this.fail(new Error(typeof message.error === 'string' ? message.error : 'System speech could not load.')); return; }
    const pending = this.pending;
    if (!pending || message.id !== pending.id) return;
    clearTimeout(pending.timer); this.pending = undefined;
    if (typeof message.error === 'string') pending.reject(new Error(message.error));
    else if (typeof message.text === 'string' && typeof message.ms === 'number' && Number.isFinite(message.ms) && message.ms >= 0) pending.resolve({ text: message.text, ms: message.ms });
    else { pending.reject(new Error('Invalid transcription response.')); this.fail(new Error('Invalid transcription response.')); }
  }
  private fail(error: Error) {
    clearTimeout(this.startup); this.readyReject(error);
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = undefined; }
    if (!this.stopped) { this.stopped = true; this.child.kill(); this.failure(error); }
  }
  async transcribe(wav: Buffer): Promise<Result> {
    validateSystemSpeechWav(wav); await this.ready;
    if (this.stopped) throw new Error('System speech is closed.');
    if (this.pending) throw new Error('System speech is busy. Wait for the current audio chunk.');
    const id = ++this.counter;
    return new Promise<Result>((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error('System speech transcription timed out. Reconnect the microphone.')), this.timeouts.requestMs);
      this.pending = { id, resolve, reject, timer };
      this.child.stdin.write(JSON.stringify({ id, wav: wav.toString('base64') }) + '\n');
    });
  }
  async close() {
    this.stopped = true; this.fail(new Error('System speech is closed.'));
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    await new Promise<void>(resolve => {
      const force = setTimeout(() => { this.child.kill(); resolve(); }, 1500);
      this.child.once('close', () => { clearTimeout(force); resolve(); });
      this.child.stdin.end();
    });
  }
}

export class SystemSpeechService {
  private worker?: SystemSpeechProcess;
  private probe?: SystemSpeechProcess;
  private probing?: Promise<SystemSpeechStatus>;
  private starting?: Promise<void>;
  private language: SystemSpeechLanguage = 'auto';
  private closed = false;
  private state: SystemSpeechStatus;
  constructor(private resourcesDir: string) {
    const supported = process.platform === 'win32' || process.platform === 'darwin';
    this.state = { managed: true, supported, platform: process.platform, engine: process.platform === 'darwin' ? 'Apple Speech (on-device)' : 'Windows System.Speech', phase: 'unavailable', languages: [], message: supported ? 'Checking installed offline speech languages.' : 'System speech is available on Windows and macOS only.' };
  }
  private helper() {
    const root = resolve(this.resourcesDir);
    const bundled = join(root, process.platform === 'darwin' ? 'prmta-speech' : 'system-speech-windows.ps1');
    const development = join(root, '..', '.tools', 'system-speech', process.arch, 'prmta-speech');
    return process.platform === 'darwin' && !existsSync(bundled) && existsSync(join(root, 'system-speech-macos.swift')) && existsSync(development) ? development : bundled;
  }
  private launch(probe: boolean, language: SystemSpeechLanguage, failure?: (error: Error) => void) {
    const helper = this.helper();
    if (!this.state.supported || !existsSync(helper)) throw new Error('Native speech helper unavailable for this platform or installation.');
    const executable = process.platform === 'win32' ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : helper;
    const args = process.platform === 'win32' ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper, '-Language', language, ...(probe ? ['-StatusOnly'] : [])] : ['--language', language, ...(probe ? ['--status'] : [])];
    return new SystemSpeechProcess(spawn(executable, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }), failure, { startupMs: probe ? 20_000 : 120_000, requestMs: 45_000 });
  }
  async status(): Promise<SystemSpeechStatus> {
    if (this.closed || this.worker || this.starting || this.state.phase === 'error') return { ...this.state, languages: [...this.state.languages] };
    if (this.probing) return this.probing;
    this.probing = (async () => {
      try {
        const probe = this.launch(true, this.language); this.probe = probe;
        const ready = await probe.ready;
        if (!this.closed && !this.starting && !this.worker) this.state = { ...this.state, languages: ready.languages, phase: ready.languages.length ? 'available' : 'unavailable', error: null, message: ready.languages.length ? 'Native offline speech is available. Connect the microphone to start.' : 'No offline speech languages found. Install English or German speech support in system settings.' };
      } catch (error) { if (!this.closed && !this.starting && !this.worker) this.state = { ...this.state, phase: 'unavailable', message: String(error), error: String(error) }; }
      finally { await this.probe?.close(); this.probe = undefined; }
      return { ...this.state, languages: [...this.state.languages] };
    })().finally(() => { this.probing = undefined; });
    return this.probing;
  }
  async ensure(language: SystemSpeechLanguage = this.language): Promise<void> {
    if (this.closed) throw new Error('System speech service is closed.');
    if (!['en', 'de', 'auto'].includes(language)) throw new Error('Invalid system speech language.');
    if (this.starting) { if (language !== this.language) throw new Error('Wait for system speech to start before changing language.'); return this.starting; }
    if (this.worker && this.language === language) return;
    if (this.worker?.busy) throw new Error('System speech is busy. Disconnect before changing language.');
    this.language = language;
    this.starting = (async () => {
      const previous = this.worker; this.worker = undefined; await previous?.close();
      if (this.closed) throw new Error('System speech service is closed.');
      this.state = { ...this.state, phase: 'starting', error: null, message: 'Starting native offline speech recognition…' };
      try {
        const worker = this.launch(false, language, error => { if (this.worker === worker) { this.worker = undefined; this.state = { ...this.state, phase: 'error', error: error.message, message: error.message }; } });
        this.worker = worker;
        const ready = await worker.ready;
        if (this.closed) throw new Error('System speech service is closed.');
        this.state = { ...this.state, phase: 'ready', languages: ready.languages, error: null, message: `${this.state.engine} ready · ${ready.language || selectSystemSpeechLanguage(ready.languages, language)}. Audio stays on this computer.` };
      } catch (error) { const failed = this.worker; this.worker = undefined; await failed?.close(); if (!this.closed) this.state = { ...this.state, phase: 'error', error: String(error), message: String(error) }; throw error; }
    })().finally(() => { this.starting = undefined; });
    return this.starting;
  }
  async transcribe(wav: Buffer, language?: SystemSpeechLanguage): Promise<Result> { validateSystemSpeechWav(wav); await this.ensure(language); if (!this.worker) throw new Error('System speech is not ready.'); return this.worker.transcribe(wav); }
  async close() {
    this.closed = true; const worker = this.worker; this.worker = undefined;
    await Promise.all([worker?.close(), this.probe?.close()]); await this.starting?.catch(() => {}); await this.probing?.catch(() => {});
    this.state = { ...this.state, phase: 'unavailable', message: 'System speech is closed.' };
  }
}
