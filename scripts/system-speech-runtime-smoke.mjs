import { _electron as electron, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { assertSpeechFixture } from '../tests/helpers/speech-fixture.ts';

// node scripts/system-speech-runtime-smoke.mjs [path/to/unpacked/PRMTA.exe]
// Uses only the existing public JFK fixture. Never opens a microphone, downloads
// audio, or uses the user's profile. macOS uses the Launch Services harness
// below so its privacy permission belongs to PRMTA rather than the calling IDE.
if (process.platform === 'darwin') throw new Error('For macOS privacy permissions, use node scripts/macos-speech-runtime-smoke.mjs /path/to/PRMTA.app (Launch Services).');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = join(root, '.tools', 'parakeet-proof', 'jfk-11.wav');
if (!existsSync(fixture)) throw new Error('Existing public fixture .tools/parakeet-proof/jfk-11.wav is required; this smoke test does not download audio.');
const audio = readFileSync(fixture);
if (audio.length < 44 || audio.toString('ascii', 0, 4) !== 'RIFF') throw new Error('Invalid public WAV fixture.');
const executable = process.argv[2] ? resolve(process.argv[2]) : undefined;
if (executable && !existsSync(executable)) throw new Error('The specified unpacked executable does not exist.');
const directory = mkdtempSync(join(tmpdir(), 'prmta-system-speech-runtime-'));
const env = { ...process.env, PRMTA_PROFILE_DIR: join(directory, 'profile'), PRMTA_DATA_DIR: join(directory, 'library') };
delete env.ELECTRON_RUN_AS_NODE;
let app, child, cleanShutdown = false, evidence;
const workerPids = new Set();
const run = promisify(execFile);

async function rememberWindowsWorkers(parentPid) {
  if (process.platform !== 'win32') return;
  // Capture only this isolated Electron process's native speech children, never
  // user-owned PowerShell processes. PIDs are used for observation, never killing.
  const query = `@(Get-CimInstance Win32_Process -Filter 'ParentProcessId = ${parentPid}' | Where-Object { $_.Name -eq 'powershell.exe' -and $_.CommandLine -like '*system-speech-windows.ps1*' } | ForEach-Object { $_.ProcessId }) | ConvertTo-Json -Compress`;
  const result = await run(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', query], { windowsHide: true, timeout: 15_000 });
  if (result.stdout.trim()) for (const pid of [].concat(JSON.parse(result.stdout))) workerPids.add(pid);
}

try {
  app = await electron.launch({ ...(executable ? { executablePath: executable, args: [] } : { args: [root] }), cwd: root, env, timeout: 30_000 });
  child = app.process();
  const page = await app.firstWindow();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow, session }) => {
    for (const window of BrowserWindow.getAllWindows()) window.hide();
    // Even an unexpected renderer request cannot obtain real microphone access.
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
  });
  await page.getByText('Studio connected', { exact: true }).waitFor({ timeout: 30_000 });
  await page.evaluate(() => {
    Object.defineProperty(window, '__smokeMicrophoneRequests', { value: 0, writable: true });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
      window.__smokeMicrophoneRequests++;
      throw new Error('Runtime fixture smoke forbids microphone capture.');
    } });
  });
  const runtime = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, platform: process.platform, mainPid: process.pid }));
  const helper = runtime.packaged ? join(runtime.resourcesPath, 'system-speech', runtime.platform === 'darwin' ? 'prmta-speech' : 'system-speech-windows.ps1') : runtime.platform === 'darwin' ? join(root, '.tools', 'system-speech', process.arch, 'prmta-speech') : join(root, 'scripts', 'system-speech-windows.ps1');
  expect(existsSync(helper), 'Native helper must be present in the expected source or packaged resources directory').toBe(true);
  if (executable) expect(runtime.packaged).toBe(true);
  const api = (path, body) => page.evaluate(async ({ path, body }) => {
    const response = await fetch('/api' + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${sessionStorage.getItem('prmpt-token')}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, ok: response.ok, data: await response.json() };
  }, { path, body });
  const status = await api('/speech/system/status');
  expect(status.ok).toBe(true); expect(status.data.supported).toBe(true); expect(status.data.phase).toBe('available');
  expect(status.data.languages.some(language => /^en-/i.test(language)), 'An installed English native recognizer is required for this fixture').toBe(true);
  const begin = Date.now();
  const started = await api('/speech/system/start', { language: 'en' });
  expect(started.ok, started.data.error || 'Explicit English startup must succeed').toBe(true); expect(started.data.phase).toBe('ready');
  const startupMs = Date.now() - begin;
  await rememberWindowsWorkers(runtime.mainPid);
  if (runtime.platform === 'win32') expect(workerPids.size, 'The native worker must remain alive between requests').toBeGreaterThan(0);
  const transcriptions = [];
  for (let index = 0; index < 2; index++) {
    // Validate the public fixture text in memory; evidence contains only counts.
    const result = await page.evaluate(async base64 => {
      const bytes = Uint8Array.from(atob(base64), value => value.charCodeAt(0));
      const response = await fetch('/api/speech?provider=system&language=en', { method: 'POST', headers: { Authorization: `Bearer ${sessionStorage.getItem('prmpt-token')}`, 'Content-Type': 'audio/wav' }, body: bytes });
      const data = await response.json();
      return { ok: response.ok, text: data.text, ms: data.ms };
    }, audio.toString('base64'));
    transcriptions.push(assertSpeechFixture(result));
  }
  let missingGermanRejected = null;
  if (!status.data.languages.some(language => /^de-/i.test(language))) {
    const missing = await api('/speech/system/start', { language: 'de' });
    expect(missing.ok).toBe(false); expect(typeof missing.data.error).toBe('string'); expect(missing.data.error).toMatch(/German|\bde\b|language/i);
    expect((await api('/speech/system/status')).data.phase).toBe('error');
    missingGermanRejected = true;
    // An unavailable language must not prevent explicit English recovery.
    expect((await api('/speech/system/start', { language: 'en' })).data.phase).toBe('ready');
    await rememberWindowsWorkers(runtime.mainPid);
  }
  const microphoneRequests = await page.evaluate(() => window.__smokeMicrophoneRequests);
  expect(microphoneRequests).toBe(0); expect(errors.length, 'Renderer must not report runtime errors').toBe(0);
  evidence = { passed: true, packaged: runtime.packaged, helperPresent: true, platform: runtime.platform, initialPhase: status.data.phase, readyPhase: started.data.phase, languages: status.data.languages, startupMs, transcriptions, missingGermanRejected, microphoneRequests, rendererErrorCount: errors.length, observedWorkerCount: workerPids.size };
} finally {
  if (app) {
    await app.close();
    await expect.poll(() => child.exitCode, { timeout: 15_000 }).toBe(0);
    for (const pid of workerPids) await expect.poll(() => { try { process.kill(pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; } }, { timeout: 10_000 }).toBe(true);
    cleanShutdown = true;
  }
  if (!app || cleanShutdown) rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
console.log(JSON.stringify({ ...evidence, cleanShutdown }));
