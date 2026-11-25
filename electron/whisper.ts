import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { modelById } from '../shared/whisper-models';
import { whisperEndpoint, isManagedWhisperUrl } from '../shared/whisper-endpoint';
export class WhisperService {
  private process: ChildProcess | null = null;
  private pending: Promise<void> | null = null;
  private closed = false;
  private activeUrl: string | null = null;
  activeModel: string | null = null;
  constructor(private root: string, private modelPath: (id: string) => string | null, private platform: NodeJS.Platform = process.platform) {}
  get managed() { return this.platform === 'win32'; }
  async ensure(url: string, model = 'base'): Promise<void> {
    modelById(model);
    url = whisperEndpoint(url).origin;
    if (this.closed) throw new Error('Whisper service is closed.');
    if (this.pending) { try { await this.pending; } catch { /* Each caller may retry with its own model. */ } return this.ensure(url, model); }
    if (this.activeUrl === url && this.process && this.activeModel === model) return;
    this.pending = this.start(url, model);
    try { await this.pending; } finally { this.pending = null; }
  }
  private async stopOwned() {
    const child = this.process; if (!child) return;
    await new Promise<void>(resolve => { child.once('exit', () => resolve()); child.kill(); });
    if (this.process === child) this.process = null;
    this.activeModel = null;
    this.activeUrl = null;
  }
  private async start(url: string, model: string) {
    const healthy = async () => { try { const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500), redirect: 'error' }); return response.ok && (await response.json() as { status?: string }).status === 'ok'; } catch { return false; } };
    if (!this.managed || !isManagedWhisperUrl(url)) {
      if (await healthy()) return;
      throw new Error(this.managed ? 'Start your own Whisper server at this address. Automatic startup uses 127.0.0.1 with the port selected in Settings.' : 'Start an external Whisper server at this address, or select Apple system speech on macOS. Built-in Whisper setup is available on Windows only.');
    }
    const endpoint = whisperEndpoint(url), port = Number(endpoint.port || 80);
    const path = this.modelPath(model), exe = join(this.root, 'Release', 'whisper-server.exe');
    if (!path) throw new Error('Download this model in Settings before starting the microphone.');
    if (!existsSync(exe)) throw new Error('The voice engine is missing. Install the complete Windows release and try again.');
    await this.stopOwned();
    if (await healthy()) {
      if (model !== 'base') throw new Error(`A separate whisper-server.exe is running on port ${port}. Choose another Whisper port in Settings to use the selected model, or manage that server separately.`);
      return;
    }
    // Binding detects non-Whisper services too, including ones whose /health is 404.
    await new Promise<void>((resolve, reject) => {
      const probe = createServer();
      probe.once('error', (error: NodeJS.ErrnoException) => reject(new Error(error.code === 'EADDRINUSE'
        ? `Whisper port ${port} is already in use by another application. Choose another port in Settings.`
        : `Cannot use Whisper port ${port}: ${error.message}`)));
      probe.listen({ host: endpoint.hostname, port, exclusive: true }, () => probe.close(error => error ? reject(error) : resolve()));
    });
    if (this.closed) throw new Error('Whisper service is closed.');
    const child = spawn(exe, ['-m', path, '--host', endpoint.hostname, '--port', String(port), '-l', 'auto', '-t', '4'], { cwd: join(this.root, 'Release'), windowsHide: true, stdio: 'ignore' });
    this.process = child; let failure: string | null = null;
    const clear = () => { if (this.process === child) { this.process = null; this.activeModel = null; this.activeUrl = null; } };
    child.once('error', error => { failure = error.message; clear(); });
    child.once('exit', code => { failure = `Whisper exited (${code}).`; clear(); });
    try {
      for (let attempt = 0; attempt < 120; attempt++) {
        if (failure || this.closed) throw new Error(failure || 'Whisper service is closed.');
        if (await healthy()) { if (failure) throw new Error(failure); this.activeModel = model; this.activeUrl = url; return; }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      throw new Error('Whisper startup timed out. Try a smaller model.');
    } catch (error) { child.kill(); clear(); throw error; }
  }
  close() { this.closed = true; this.process?.kill(); this.process = null; this.activeModel = null; this.activeUrl = null; }
}
