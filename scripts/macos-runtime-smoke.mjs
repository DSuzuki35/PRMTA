// Packaged Mac integration check. Uses an isolated profile and synthetic audio only.
// Usage: node scripts/macos-runtime-smoke.mjs path/to/PRMTA.app
import { _electron as electron, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
if (process.platform !== 'darwin') throw new Error('Run this check on macOS.');
const executable = resolve(process.argv[2] || 'release-macos/mac-arm64/PRMTA.app', 'Contents/MacOS/PRMTA');
if (!existsSync(executable)) throw new Error('Packaged PRMTA.app is required.');
const directory = mkdtempSync(join(tmpdir(), 'prmta-macos-smoke-'));
const env = { ...process.env, PRMTA_PROFILE_DIR: join(directory, 'profile'), PRMTA_DATA_DIR: join(directory, 'library') };
delete env.ELECTRON_RUN_AS_NODE;
const server = createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/health') res.end(JSON.stringify({ status: 'ok' }));
  else if (req.url === '/inference') { req.resume(); req.on('end', () => res.end(JSON.stringify({ text: 'Synthetic external Whisper result.' }))); }
  else { res.writeHead(404); res.end('{}'); }
});
let app, child;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  app = await electron.launch({ executablePath: executable, args: ['--use-fake-device-for-media-stream'], env, timeout: 30000 });
  child = app.process();
  await app.evaluate(({ session }) => {
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
  });
  const page = await app.firstWindow();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.getByText('Studio connected', { exact: true }).waitFor({ timeout: 30000 });
  const runtime = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion(), platform: process.platform, arch: process.arch }));
  expect(runtime.packaged).toBe(true);
  expect(await page.evaluate(() => window.desktop.platform)).toBe('darwin');
  const api = (path, body) => page.evaluate(async ({ path, body }) => {
    const response = await fetch('/api' + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${sessionStorage.getItem('prmpt-token')}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  }, { path, body });
  const initial = await api('/state');
  expect(initial.data.preferences.provider).toBe('system');
  expect(initial.data.preferences.shortcuts.previousSentence).toBe('Meta+ArrowLeft');
  const native = await api('/speech/system/status');
  expect(native.data.supported).toBe(true);
  expect(native.data.error).toBeNull();
  expect(['available', 'unavailable']).toContain(native.data.phase);
  expect(Array.isArray(native.data.languages)).toBe(true); // CI may have no offline assets.
  expect((await api('/speech/models')).data.managed).toBe(false);
  expect((await api('/speech/models/install', { id: 'base' })).status).toBe(503);
  const whisperUrl = `http://127.0.0.1:${server.address().port}`;
  expect((await api('/speech/start', { whisperUrl, model: 'base' })).status).toBe(200);
  const transcript = await page.evaluate(async whisperUrl => {
    const wav = new Uint8Array(48); wav.set(new TextEncoder().encode('RIFF'), 0); wav.set(new TextEncoder().encode('WAVE'), 8);
    const response = await fetch(`/api/speech?whisperUrl=${encodeURIComponent(whisperUrl)}`, { method: 'POST', headers: { Authorization: `Bearer ${sessionStorage.getItem('prmpt-token')}`, 'Content-Type': 'audio/wav' }, body: wav });
    return response.json();
  }, whisperUrl);
  expect(transcript.text).toBe('Synthetic external Whisper result.');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Speech recognition', exact: true })).toHaveValue('system');
  await page.getByRole('combobox', { name: 'Speech recognition', exact: true }).selectOption('whisper');
  await expect(page.getByRole('button', { name: 'Download model', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Set up voice', exact: true })).toHaveCount(0);
  const updates = await page.evaluate(() => window.desktop.updateStatus());
  expect(updates.mode).toBe('macos-manual');
  expect(updates.message).not.toMatch(/Windows|Setup/);
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ runtime, nativePhase: native.data.phase, languages: native.data.languages, externalWhisper: true, modelDownloadBlocked: true, rendererErrors: errors.length }));
} finally {
  try { if (app) { await app.close(); await expect.poll(() => child.exitCode, { timeout: 15000 }).toBe(0); console.log('cleanShutdown=true'); } }
  finally { await new Promise(resolve => server.close(resolve)); rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
}
