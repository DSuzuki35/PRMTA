import { expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHost } from '../server/host';
it('inventories native speech without starting recognition and protects native setup/audio routes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'prmta-system-host-'));
  let language = '', calls = 0;
  const host = await createHost({ dataDir: dir, port: 0, systemSpeech: {
    status: async () => ({ managed: true, supported: true, platform: 'win32', engine: 'Windows System.Speech', phase: 'available', languages: ['en-US'], message: 'Available' }),
    ensure: async value => { language = value; calls++; },
    transcribe: async (_wav, value) => { language = value!; return { text: 'A native transcript.', ms: 50 }; },
  } });
  const headers = { Authorization: `Bearer ${host.tokens.admin}`, 'Content-Type': 'application/json' };
  try {
    expect((await fetch(host.origin + '/api/speech/system/status', { headers })).ok).toBe(true); expect(calls).toBe(0);
    expect((await fetch(host.origin + '/api/speech/system/start', { method: 'POST', headers: { ...headers, Authorization: `Bearer ${host.tokens.remote}` }, body: '{}' })).status).toBe(403);
    expect((await fetch(host.origin + '/api/speech/system/start', { method: 'POST', headers, body: '{"language":"en"}' })).ok).toBe(true); expect(language).toBe('en');
    const wav = Buffer.alloc(48); wav.write('RIFF'); wav.write('WAVE', 8);
    const response = await fetch(host.origin + '/api/speech?provider=system&language=de', { method: 'POST', headers: { ...headers, 'Content-Type': 'audio/wav' }, body: wav });
    expect(await response.json()).toEqual({ text: 'A native transcript.', ms: 50 }); expect(language).toBe('de');
  } finally { await host.close(); rmSync(dir, { recursive: true, force: true }); }
});
