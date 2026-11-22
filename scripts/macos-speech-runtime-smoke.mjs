// Launch Services makes PRMTA (not the IDE/test runner) responsible for TCC.
// Uses the public JFK fixture and never requests a microphone stream.
// node scripts/macos-speech-runtime-smoke.mjs path/to/PRMTA.app
import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { assertSpeechFixture } from '../tests/helpers/speech-fixture.ts';
if (process.platform !== 'darwin') throw new Error('Run on macOS.');
const bundle = resolve(process.argv[2] || 'release-macos/mac-arm64/PRMTA.app');
const fixture = resolve('.tools/parakeet-proof/jfk-11.wav');
if (!existsSync(join(bundle, 'Contents/MacOS/PRMTA')) || !existsSync(fixture)) throw new Error('A packaged PRMTA.app and the public JFK WAV fixture are required.');
const audio = readFileSync(fixture);
const directory = mkdtempSync(join(tmpdir(), 'prmta-mac-speech-'));
const portProbe = createServer();
await new Promise(resolve => portProbe.listen(0, '127.0.0.1', resolve));
const port = portProbe.address().port;
await new Promise(resolve => portProbe.close(resolve));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const launcher = spawn('/usr/bin/open', ['-n', '-W', '-a', bundle, '--env', `PRMTA_PROFILE_DIR=${join(directory, 'profile')}`, '--env', `PRMTA_DATA_DIR=${join(directory, 'library')}`, '--args', `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', '--use-fake-device-for-media-stream'], { env, stdio: ['ignore', 'ignore', 'pipe'] });
let launchError = ''; launcher.stderr.on('data', data => { launchError += data; });
let browser, page;
try {
  const endpoint = `http://127.0.0.1:${port}`;
  await expect.poll(async () => { if (launcher.exitCode !== null) throw new Error(launchError || 'App launcher stopped'); try { return (await fetch(endpoint + '/json/version')).ok; } catch { return false; } }, { timeout: 30000 }).toBe(true);
  browser = await chromium.connectOverCDP(endpoint);
  page = browser.contexts()[0].pages().find(page => page.url().startsWith('http://127.0.0.1:')) || await browser.contexts()[0].waitForEvent('page');
  await page.getByText('Studio connected', { exact: true }).waitFor({ timeout: 30000 });
  await page.evaluate(() => {
    window.__smokeMicrophoneRequests = 0;
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => { window.__smokeMicrophoneRequests++; throw new Error('Microphone capture forbidden in fixture test'); } });
  });
  const api = (path, body) => page.evaluate(async ({ path, body }) => {
    const response = await fetch('/api' + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${sessionStorage.getItem('prmpt-token')}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { ok: response.ok, data: await response.json() };
  }, { path, body });
  const status = await api('/speech/system/status');
  expect(status.data.languages.some(language => /^en-/i.test(language))).toBe(true);
  const start = await api('/speech/system/start', { language: 'en' });
  expect(start.ok, start.data.error || 'English native startup').toBe(true);
  const transcriptions = [];
  for (let index = 0; index < 2; index++) {
    const result = await page.evaluate(async base64 => {
      const response = await fetch('/api/speech?provider=system&language=en', { method: 'POST', headers: { Authorization: `Bearer ${sessionStorage.getItem('prmpt-token')}`, 'Content-Type': 'audio/wav' }, body: Uint8Array.from(atob(base64), c => c.charCodeAt(0)) });
      const data = await response.json(); return { ok: response.ok, text: data.text, ms: data.ms };
    }, audio.toString('base64'));
    transcriptions.push(assertSpeechFixture(result));
  }
  if (!status.data.languages.some(language => /^de-/i.test(language))) {
    expect((await api('/speech/system/start', { language: 'de' })).ok).toBe(false);
    expect((await api('/speech/system/start', { language: 'en' })).ok).toBe(true);
  }
  expect(await page.evaluate(() => window.__smokeMicrophoneRequests)).toBe(0);
  console.log(JSON.stringify({ passed: true, launchServices: true, transcriptions, microphoneRequests: 0 }));
} finally {
  if (page && !page.isClosed()) await page.close();
  await browser?.close();
  await expect.poll(() => launcher.exitCode, { timeout: 15000 }).toBe(0);
  rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
