import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, statSync, readdirSync, rmSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { modelById, whisperModels, type ModelStatus } from '../shared/whisper-models';

export async function downloadVerified(url: string, target: string, size: number, sha256: string, progress: (received: number) => void, fetcher: (url: string, options: RequestInit) => Promise<Response> = fetch, signal?: AbortSignal) {
  const temporary = `${target}.${randomUUID()}.part`;
  await mkdir(dirname(target), { recursive: true });
  try {
    const response = await fetcher(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30 * 60_000)]) : AbortSignal.timeout(30 * 60_000) });
    if (!response.ok || !response.body) throw new Error(`Model download failed (HTTP ${response.status})`);
    const hash = createHash('sha256'); let received = 0;
    const verify = new Transform({ transform(chunk, _encoding, callback) { received += chunk.length; if (received > size) { callback(new Error('Model size mismatch')); return; } hash.update(chunk); progress(received); callback(null, chunk); } });
    await pipeline(Readable.fromWeb(response.body as any), verify, createWriteStream(temporary, { flags: 'wx' }));
    if (received !== size) throw new Error('Model size mismatch');
    if (hash.digest('hex') !== sha256) throw new Error('Model checksum mismatch');
    await rename(temporary, target);
  } finally { await rm(temporary, { force: true }); }
}

export class ModelStore {
  private jobs = new Map<string, { received: number; downloading: boolean; error: string }>();
  private controller = new AbortController();
  private tasks = new Set<Promise<void>>();
  constructor(private bundled: string, private downloads: string) {
    if (existsSync(downloads)) for (const file of readdirSync(downloads)) {
      if (whisperModels.some(m => file.startsWith(`${m.file}.`)) && /\.[0-9a-f-]{36}\.part$/.test(file)) rmSync(join(downloads, file), { force: true });
    }
  }
  path(id: string) {
    const model = modelById(id);
    for (const root of [this.downloads, this.bundled]) { const file = join(root, model.file); if (existsSync(file) && statSync(file).size === model.size) return file; }
    return null;
  }
  list(): ModelStatus[] { return whisperModels.map(model => ({ id: model.id, installed: !!this.path(model.id), received: 0, downloading: false, error: '', ...this.jobs.get(model.id) })); }
  install(id: string) {
    const model = modelById(id);
    if (this.path(id) || this.jobs.get(id)?.downloading) return;
    if ([...this.jobs.values()].some(j => j.downloading)) throw new Error('Wait for the current model download to finish.');
    const job = { received: 0, downloading: true, error: '' }; this.jobs.set(id, job);
    const task = downloadVerified(`https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${model.file}`, join(this.downloads, model.file), model.size, model.sha256, n => { job.received = n; }, fetch, this.controller.signal)
      .catch(error => { job.error = String(error); }).finally(() => { job.downloading = false; this.tasks.delete(task); });
    this.tasks.add(task);
  }
  async close() { this.controller.abort(); await Promise.all(this.tasks); }
}
