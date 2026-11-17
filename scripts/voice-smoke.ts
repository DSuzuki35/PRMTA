import { chromium, expect } from '@playwright/test';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createHost } from '../server/host';
import { defaultPreferences } from '../shared/model';
const dir = mkdtempSync(join(tmpdir(), 'prmpt-voice-'));
const host = await createHost({ dataDir: dir, port: 0, staticDir: resolve('dist') });
const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${resolve('.tools/whisper/jfk.wav')}`] });
try {
  const script = host.library.save({ id: randomUUID(), title: 'Speech integration fixture', content: 'And so my fellow Americans ask not what your country can do for you ask what you can do for your country.', folder: '', tags: [], favorite: false, deleted: false, notes: '' }, []);
  host.session.load(script);
  await fetch(`${host.origin}/api/preferences`, { method: 'POST', headers: { Authorization: `Bearer ${host.tokens.admin}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...defaultPreferences, language: 'en', countdown: 0 }) });
  const page = await browser.newPage(); const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  let audioHeartbeats = 0, maxVisualLead = 0;
  page.on('request', request => { if (request.url().endsWith('/api/command') && request.postDataJSON()?.type === 'voiceActivity') audioHeartbeats++; });
  await page.goto(host.url('admin')); await page.getByText('Studio connected', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Turn microphone on' }).click();
  await page.getByRole('button', { name: 'Turn microphone off' }).waitFor({ timeout: 15000 });
  const startedAt = Date.now();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const previewSampler = setInterval(() => { maxVisualLead = Math.max(maxVisualLead, (host.session.state.voiceHighlight ?? 0) - host.session.state.position); }, 50);
  try {
  await expect.poll(() => host.session.state.position, { timeout: 45000 }).toBeGreaterThan(7);
  await expect.poll(() => maxVisualLead, { timeout: 10000 }).toBeGreaterThan(0);
  expect(maxVisualLead).toBeLessThanOrEqual(2); expect(audioHeartbeats).toBeGreaterThan(0); expect(errors).toEqual([]);
  console.log(JSON.stringify({ elapsedMs: Date.now() - startedAt, position: host.session.state.position, recognized: host.session.state.speech.transcript, confidence: host.session.state.speech.confidence, audioHeartbeats, maxVisualLead, errors }));
  } finally { clearInterval(previewSampler); }
  await page.getByRole('button', { name: 'Turn microphone off' }).click();
} finally { await browser.close(); await host.close(); rmSync(dir, { recursive: true, force: true }); }
