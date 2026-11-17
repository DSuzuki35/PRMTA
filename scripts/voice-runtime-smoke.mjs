import { _electron as electron } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const dir = mkdtempSync(join(tmpdir(), 'prmta-voice-runtime-'));
const env = { ...process.env, PRMTA_PROFILE_DIR: dir }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.'], env });
try {
  const page = await app.firstWindow(); await page.getByText('Studio connected', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Set up voice', exact: true }).click();
  await page.getByRole('button', { name: 'Voice ready', exact: true }).waitFor({ timeout: 60000 });
  const result = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/voice-smoke.ts'], { windowsHide: true, timeout: 70000 });
  console.log(result.stdout.trim());
} finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
