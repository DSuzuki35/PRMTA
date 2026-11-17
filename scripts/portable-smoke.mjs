import { chromium, expect } from '@playwright/test';
import { spawn, execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { resolve, join } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'prmta-portable-smoke-'));
const listener = createServer(); await new Promise(r => listener.listen(0, '127.0.0.1', r)); const port = listener.address().port; await new Promise(r => listener.close(r));
const env = { ...process.env, PRMTA_DATA_DIR: join(dir, 'library'), PRMTA_PROFILE_DIR: join(dir, 'profile') }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(resolve(process.argv[2] ?? 'release/PRMTA 0.2.1.exe'), [`--remote-debugging-port=${port}`], { env, windowsHide: true, stdio: 'ignore' });
const exited = new Promise((resolve, reject) => { child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Portable exit ${code}`))); child.once('error', reject); });
exited.catch(() => {});
let browser;
try {
  await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok; } catch { return false; } }, { timeout: 90000, intervals: [500] }).toBe(true);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = browser.contexts()[0].pages()[0]; await page.getByText('Studio connected', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Try a sample', exact: true }).click();
  await expect(page.locator('.prompter')).toContainText('Great stories');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Set up voice', exact: true }).click();
  await page.getByRole('button', { name: 'Voice ready', exact: true }).waitFor({ timeout: 60000 });
  if (process.env.PRMTA_TEST_REAL_VOICE) {
    const result = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/voice-smoke.ts'], { windowsHide: true, timeout: 70000 });
    console.log(result.stdout.trim());
  }
  await page.evaluate(() => window.close());
  const timeout = new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Portable did not close')), 30000); timer.unref(); });
  await Promise.race([exited, timeout]);
  console.log('Portable extraction, sample script, one-button bundled voice setup, and clean shutdown passed.');
} finally {
  await browser?.close().catch(() => {});
  if (child.exitCode === null) child.kill();
  // The normal successful path has no running process holding this temporary profile.
  if (child.exitCode !== null) rmSync(dir, { recursive: true, force: true });
}
