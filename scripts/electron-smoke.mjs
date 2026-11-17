import { _electron as electron } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'prmpt-electron-'));
const env = { ...process.env, PRMTA_DATA_DIR: dir, PRMTA_PROFILE_DIR: join(dir, 'profile') }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ ...(process.env.PRMTA_EXE ? { executablePath: process.env.PRMTA_EXE } : {}), args: process.env.PRMTA_EXE ? [] : ['.'], env });
try {
  const page = await app.firstWindow(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.getByText('Studio connected', { exact: true }).waitFor();
  const displays = await page.evaluate(() => window.desktop.displays());
  if (!displays.length) throw new Error('No display detected');
  await page.getByRole('button', { name: 'Try a sample', exact: true }).click();
  await page.locator('.prompter').getByText('Great', { exact: true }).waitFor();
  mkdirSync('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/electron.png' });
  const versions = await app.evaluate(() => process.versions);
  let bundledWhisper = null;
  if (process.env.PRMTA_CHECK_WHISPER) {
    bundledWhisper = await page.evaluate(async () => {
      const token = sessionStorage.getItem('prmpt-token');
      const start = await fetch('/api/speech/start', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' });
      if (!start.ok) throw new Error(await start.text());
      return (await fetch('/api/speech/status', { headers: { Authorization: `Bearer ${token}` } })).json();
    });
  }
  console.log(JSON.stringify({ versions: { electron: versions.electron, node: versions.node }, displays, errors, bundledWhisper }));
} finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
