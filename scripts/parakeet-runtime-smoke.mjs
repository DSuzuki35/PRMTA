import { _electron as electron, expect } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
// Uses only the isolated benchmark model profile and a fresh throwaway library.
const dir = mkdtempSync(join(tmpdir(), 'prmta-parakeet-runtime-'));
const env = { ...process.env, PRMTA_PROFILE_DIR: resolve('.tools/parakeet-proof/managed-profile'), PRMTA_DATA_DIR: join(dir, 'library') };
delete env.ELECTRON_RUN_AS_NODE;
const flags = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${resolve('.tools/parakeet-proof/jfk-11.wav')}`];
const app = await electron.launch({ ...(process.argv[2] ? { executablePath: resolve(process.argv[2]), args: flags } : { args: ['.', ...flags] }), env });
try {
  const page = await app.firstWindow(); await page.getByText('Studio connected', { exact: true }).waitFor();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const api = (path, body) => page.evaluate(async ({ path, body }) => {
    const response = await fetch('/api' + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${sessionStorage.getItem('prmpt-token')}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error); return data;
  }, { path, body });
  const state = await api('/state');
  await api('/preferences', { ...state.preferences, provider: 'parakeet', parakeetAcceleration: 'cpu', language: 'en', countdown: 0 });
  const script = await api('/scripts', { draft: { id: crypto.randomUUID(), title: 'Public speech fixture', content: 'And so my fellow Americans ask not what your country can do for you ask what you can do for your country.', folder: '', tags: [], favorite: false, deleted: false, notes: '' }, expectedHeads: [] });
  await api('/load', { id: script.id });
  const controllers = await page.evaluate(() => window.desktop.controllerState());
  expect(controllers.status).toBe('ready');
  await page.getByRole('button', { name: 'Voice', exact: true }).click();
  await page.getByRole('button', { name: 'Mic on', exact: true }).waitFor({ timeout: 30000 });
  const ready = await api('/speech/parakeet/status'); expect(ready.provider).toBe('CPUExecutionProvider');
  let maxVisualLead = 0, activity = 0, chunks = 0;
  page.on('request', request => { if (request.url().endsWith('/api/command') && request.postDataJSON()?.type === 'voiceActivity') activity++; if (request.url().includes('/api/speech?provider=parakeet')) chunks++; });
  const started = Date.now(); await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(async () => { const state = (await api('/state')).session; maxVisualLead = Math.max(maxVisualLead, (state.voiceHighlight ?? 0) - state.position); return state.position; }, { timeout: 30000, intervals: [100] }).toBeGreaterThan(7);
  const final = (await api('/state')).session;
  expect(activity).toBeGreaterThan(0); expect(chunks).toBeGreaterThan(0); expect(errors).toEqual([]); expect(maxVisualLead).toBeLessThanOrEqual(2);
  await page.getByRole('button', { name: 'Mic on', exact: true }).click();
  const evidence = { passed: true, packaged: !!process.argv[2], provider: ready.provider, elapsedMs: Date.now() - started, position: final.position, confidence: final.speech.confidence, activity, chunks, maxVisualLead, nativeControllers: controllers.status, errors };
  mkdirSync('artifacts', { recursive: true }); writeFileSync('artifacts/parakeet-runtime-smoke.json', JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence));
} finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
