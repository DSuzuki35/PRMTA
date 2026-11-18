import { expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHost } from '../server/host';

it('routes Parakeet locally with admin-only setup and serialized speech requests', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'prmta-parakeet-host-'));
  let installed = false, acceleration = '', started = false, finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const host = await createHost({ dataDir: dir, port: 0, parakeet: {
    status: () => ({ installed, phase: installed ? 'installed' : 'not-installed' }),
    install: async () => { installed = true; }, cancelInstall: async () => {},
    ensure: async value => { acceleration = value; },
    transcribe: async () => { started = true; await gate; return { text: 'Hello from Parakeet.', ms: 55 }; },
  } });
  const headers = { Authorization: `Bearer ${host.tokens.admin}`, 'Content-Type': 'application/json' };
  try {
    expect((await fetch(host.origin + '/api/speech/parakeet/install', { method: 'POST', headers: { ...headers, Authorization: `Bearer ${host.tokens.remote}` }, body: '{}' })).status).toBe(403);
    expect((await fetch(host.origin + '/api/speech/parakeet/install', { method: 'POST', headers, body: '{}' })).ok).toBe(true);
    expect(installed).toBe(true);
    await fetch(host.origin + '/api/speech/parakeet/start', { method: 'POST', headers, body: JSON.stringify({ acceleration: 'directml' }) });
    expect(acceleration).toBe('directml');
    const wav = Buffer.alloc(48); wav.write('RIFF'); wav.write('WAVE', 8);
    const request = () => fetch(host.origin + '/api/speech?provider=parakeet', { method: 'POST', headers: { ...headers, 'Content-Type': 'audio/wav' }, body: wav });
    const first = request(); await expect.poll(() => started).toBe(true);
    expect((await request()).status).toBe(429);
    expect((await fetch(host.origin + '/api/speech/parakeet/start', { method: 'POST', headers, body: '{}' })).status).toBe(409);
    finish(); expect(await (await first).json()).toEqual({ text: 'Hello from Parakeet.', ms: 55 });
  } finally { finish(); await host.close(); rmSync(dir, { recursive: true, force: true }); }
});
