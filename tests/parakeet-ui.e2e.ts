import { test, expect, chromium } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHost, type Host } from '../server/host';
let host: Host, dir: string;
test.beforeEach(async () => { dir = mkdtempSync(join(tmpdir(), 'prmta-parakeet-ui-')); host = await createHost({ dataDir: dir, port: 0, staticDir: resolve('dist') }); });
test.afterEach(async () => { await host.close(); rmSync(dir, { recursive: true, force: true }); });

test('English is the default, Parakeet offers button setup with progress and CPU/GPU selection', async ({ page }) => {
  let installed = false, ready = false, polls = 0, startingDevice = '';
  const status = () => ({ managed: true, supported: true, installed: installed && ++polls > 2, phase: ready ? 'ready' : installed ? polls > 2 ? 'installed' : 'installing' : 'not-installed', model: 'Parakeet TDT 0.6B v3', provider: ready ? 'CPUExecutionProvider' : null, received: installed ? 100 : 0, total: 200, percent: installed ? 50 : 0, message: ready ? 'Parakeet ready.' : 'Prepare Parakeet.', error: null });
  await page.route('**/api/speech/parakeet/status', route => route.fulfill({ json: status() }));
  await page.route('**/api/speech/parakeet/install', route => { installed = true; return route.fulfill({ json: status() }); });
  await page.route('**/api/speech/parakeet/start', route => { startingDevice = route.request().postDataJSON().acceleration; ready = true; return route.fulfill({ json: status() }); });
  await page.goto(host.url('admin')); await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Script language', exact: true })).toHaveValue('en');
  await page.getByRole('combobox', { name: 'Speech recognition', exact: true }).selectOption('parakeet');
  await expect(page.getByText('Automatic language detection', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Parakeet processing', exact: true })).toHaveValue('cpu');
  await page.getByRole('button', { name: 'Set up Parakeet', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Parakeet ready', exact: true })).toBeVisible();
  expect(startingDevice).toBe('cpu');
  await page.getByRole('combobox', { name: 'Parakeet processing', exact: true }).selectOption('directml');
  await expect.poll(() => host.getPreferences().parakeetAcceleration).toBe('directml');
  await expect(page.locator('pre')).toHaveCount(0);
});


test('microphone capture sends Parakeet audio and advances the matching script without Whisper', async () => {
  const rate = 16000, count = rate * 8, wav = Buffer.alloc(44 + count * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) wav.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / rate) * 6000), 44 + i * 2);
  const audioFile = join(dir, 'fixture.wav'); writeFileSync(audioFile, wav);
  await fetch(`${host.origin}/api/preferences`, { method: 'POST', headers: { Authorization: `Bearer ${host.tokens.admin}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...host.getPreferences(), provider: 'parakeet', countdown: 0 }) });
  host.session.load({ id: 'parakeet-fixture', title: 'Parakeet fixture', content: 'And so my fellow Americans ask not what your country can do for you. Ask what you can do for your country.' });
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${audioFile}`] });
  try {
    const page = await browser.newPage(); let speechCalls = 0, whisperCalls = 0;
    await page.route('**/api/speech/parakeet/start', route => route.fulfill({ json: { phase: 'ready' } }));
    await page.route('**/api/speech?*', route => {
      if (route.request().url().includes('provider=parakeet')) { speechCalls++; expect(route.request().postDataBuffer()?.subarray(0, 4).toString()).toBe('RIFF'); return route.fulfill({ json: { text: 'And so my fellow Americans', ms: 60 } }); }
      whisperCalls++; return route.abort();
    });
    await page.goto(host.url('admin')); await page.getByRole('button', { name: 'Voice', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Mic on', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect.poll(() => speechCalls, { timeout: 10000 }).toBeGreaterThan(0);
    await expect.poll(() => host.session.state.position).toBeGreaterThan(2);
    expect(whisperCalls).toBe(0);
    await page.getByRole('button', { name: 'Mic on', exact: true }).click();
  } finally { await browser.close(); }
});


test('repair waits for runtime replacement and reports a ready CPU fallback for GPU selection', async ({ page }) => {
  let phase = 'error', polls = 0;
  const status = () => ({ managed: true, supported: true, installed: true, phase, requestedAcceleration: 'directml', model: 'Parakeet', provider: phase === 'ready' ? 'CPUExecutionProvider' : null, received: 1, total: 2, percent: 50, message: phase === 'error' ? 'Runtime failed' : 'Preparing runtime', error: phase === 'error' ? 'Runtime failed' : null });
  await fetch(`${host.origin}/api/preferences`, { method: 'POST', headers: { Authorization: `Bearer ${host.tokens.admin}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...host.getPreferences(), provider: 'parakeet', parakeetAcceleration: 'directml' }) });
  await page.route('**/api/speech/parakeet/status', route => { if (phase === 'installing' && ++polls > 3) phase = 'installed'; return route.fulfill({ json: status() }); });
  await page.route('**/api/speech/parakeet/install', route => { phase = 'installing'; return route.fulfill({ json: status() }); });
  await page.route('**/api/speech/parakeet/start', route => { expect(phase).toBe('installed'); phase = 'ready'; return route.fulfill({ json: status() }); });
  await page.goto(host.url('admin')); await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Repair Parakeet', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Parakeet ready', exact: true })).toBeDisabled();
  await expect(page.getByText('Active processor: CPU', { exact: true })).toBeVisible();
});
