import { afterEach, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ParakeetProcess, ParakeetService, validateParakeetWav } from '../electron/parakeet';

const cleanup: (() => Promise<unknown> | void)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); vi.restoreAllMocks(); });
const wav = () => {
  const data = Buffer.alloc(44 + 3200); data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(16000, 24); data.writeUInt32LE(32000, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(3200, 40); return data;
};
it('rejects malformed or oversized audio before sending anything to the worker', () => {
  expect(() => validateParakeetWav(wav())).not.toThrow();
  expect(() => validateParakeetWav(Buffer.from('RIFF'))).toThrow();
  const stereo = wav(); stereo.writeUInt16LE(2, 22); expect(() => validateParakeetWav(stereo)).toThrow(/mono/i);
  const badRate = wav(); badRate.writeUInt32LE(48000, 24); expect(() => validateParakeetWav(badRate)).toThrow(/16000/);
  expect(() => validateParakeetWav(Buffer.alloc(1_000_000))).toThrow();
});
it('does not silently download a model when recognition starts before setup', async () => {
  const root = mkdtempSync(join(tmpdir(), 'prmta-parakeet-')); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const service = new ParakeetService(root, 'scripts'); cleanup.push(() => service.close());
  expect(service.status().installed).toBe(false);
  await expect(service.ensure()).rejects.toThrow(/install|setup/i);
  expect(service.status().phase).not.toBe('installing');
});
it('uses a persistent private pipe, rejects overlapping requests and releases pending work on close', async () => {
  const child = spawn(process.execPath, ['-e', `
    console.log(JSON.stringify({type:'ready',provider:'CPUExecutionProvider'}));
    require('node:readline').createInterface({input:process.stdin}).on('line', line => {
      const request=JSON.parse(line); setTimeout(()=>console.log(JSON.stringify({id:request.id,text:'Local result',ms:12})),80);
    }).on('close',()=>process.exit(0));
  `], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const worker = new ParakeetProcess(child); cleanup.push(() => worker.close());
  expect(await worker.ready).toBe('CPUExecutionProvider');
  const first = worker.transcribe(wav()); await expect(worker.transcribe(wav())).rejects.toThrow(/busy/i);
  expect(await first).toEqual({ text: 'Local result', ms: 12 });
  const pending = worker.transcribe(wav()); const rejected = expect(pending).rejects.toThrow(/closed|stopped/i);
  await worker.close(); await rejected;
});
it('reports startup failures rather than leaving recognition promises hanging', async () => {
  const child = spawn(process.execPath, ['-e', `console.log(JSON.stringify({type:'fatal',error:'model cannot load'}));`], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const worker = new ParakeetProcess(child); cleanup.push(() => worker.close());
  await expect(worker.ready).rejects.toThrow('model cannot load');
});
it('cancels an in-progress setup download and keeps setup retryable', async () => {
  const root = mkdtempSync(join(tmpdir(), 'prmta-parakeet-cancel-')); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  let started!: () => void; const downloadStarted = new Promise<void>(resolve => { started = resolve; });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
    started();
    return new Promise((_resolve, reject) => { options?.signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }); });
  });
  const service = new ParakeetService(root, 'scripts'); cleanup.push(() => service.close());
  const installing = service.install(); await downloadStarted;
  expect(service.status().phase).toBe('installing');
  await expect(service.ensure()).rejects.toThrow(/finish.*setup/i);
  expect(service.install()).toBe(installing);
  await service.cancelInstall(); await installing;
  expect(service.status().phase).toBe('not-installed'); expect(service.status().installed).toBe(false);
  vi.mocked(fetch).mockResolvedValue(new Response('unavailable', { status: 503 }));
  await expect(service.install()).rejects.toThrow(/503/);
  expect(service.status().phase).toBe('error');
});
