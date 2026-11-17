import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { modelById } from '../shared/whisper-models';
export class WhisperService {
  private process: ChildProcess | null = null;
  private pending: Promise<void> | null = null;
  private closed = false;
  activeModel: string | null = null;
  constructor(private root: string, private modelPath: (id: string) => string | null) {}
  async ensure(url: string, model = 'base'): Promise<void> {
    modelById(model);
    if (this.closed) throw new Error('Whisper service is closed.');
    if (this.pending) { try { await this.pending; } catch { /* Each caller may retry with its own model. */ } return this.ensure(url, model); }
    if (url === 'http://127.0.0.1:8080' && this.process && this.activeModel === model) return;
    this.pending = this.start(url, model);
    try { await this.pending; } finally { this.pending = null; }
  }
  private async stopOwned() {
    const child = this.process; if (!child) return;
    await new Promise<void>(resolve => { child.once('exit', () => resolve()); child.kill(); });
    if (this.process === child) this.process = null;
    this.activeModel = null;
  }
  private async start(url: string, model: string) {
    const healthy = async () => { try { const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500), redirect: 'error' }); return response.ok && (await response.json() as { status?: string }).status === 'ok'; } catch { return false; } };
    if (url !== 'http://127.0.0.1:8080') {
      if (await healthy()) return;
      throw new Error('Start your own Whisper server at this address. Automatic startup uses 127.0.0.1:8080.');
    }
    const path = this.modelPath(model), exe = join(this.root, 'Release', 'whisper-server.exe');
    if (!path) throw new Error('Download this model in Settings before starting the microphone.');
    if (!existsSync(exe)) throw new Error('The voice engine is missing. Install the complete Windows release and try again.');
    await this.stopOwned();
    if (await healthy()) {
      if (model !== 'base') throw new Error('A separate whisper-server.exe is running on port 8080 (possibly left after a crash). Stop that server in Task Manager to use the selected model, or manage its model separately.');
      return;
    }
    if (this.closed) throw new Error('Whisper service is closed.');
    const child = spawn(exe, ['-m', path, '--host', '127.0.0.1', '--port', '8080', '-l', 'auto', '-t', '4'], { cwd: join(this.root, 'Release'), windowsHide: true, stdio: 'ignore' });
    this.process = child; let failure: string | null = null;
    const clear = () => { if (this.process === child) { this.process = null; this.activeModel = null; } };
    child.once('error', error => { failure = error.message; clear(); });
    child.once('exit', code => { failure = `Whisper exited (${code}).`; clear(); });
    try {
      for (let attempt = 0; attempt < 120; attempt++) {
        if (failure || this.closed) throw new Error(failure || 'Whisper service is closed.');
        if (await healthy()) { if (failure) throw new Error(failure); this.activeModel = model; return; }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      throw new Error('Whisper startup timed out. Try a smaller model.');
    } catch (error) { child.kill(); clear(); throw error; }
  }
  close() { this.closed = true; this.process?.kill(); this.process = null; this.activeModel = null; }
}
