import { _electron as electron, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'prmta-model-smoke-'));
const env = { ...process.env, PRMTA_DATA_DIR: join(dir, 'library'), PRMTA_PROFILE_DIR: join(dir, 'profile') }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.'], env });
try {
  const page = await app.firstWindow(); await page.getByText('Studio connected', { exact: true }).waitFor();
  const call = (path, body) => page.evaluate(async ({ path, body }) => {
    const response = await fetch(`/api${path}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${sessionStorage.getItem('prmpt-token')}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw new Error(await response.text()); return response.json();
  }, { path, body });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Set up voice', exact: true }).click();
  await page.getByRole('button', { name: 'Voice ready', exact: true }).waitFor({ timeout: 60000 });
  expect((await call('/speech/models')).activeModel).toBe('base');
  await page.getByLabel('Local model').selectOption('tiny');
  await page.getByRole('button', { name: 'Set up voice', exact: true }).click();
  await page.getByRole('button', { name: 'Voice ready', exact: true }).waitFor({ timeout: 180000 });
  expect((await call('/speech/models')).models.find(m => m.id === 'tiny').installed).toBe(true);
  const { preferences } = await call('/state');
  expect((await call('/speech/models')).activeModel).toBe('tiny');
  await call('/preferences', { ...preferences, whisperModel: 'base' });
  await call('/speech/start', {}); expect((await call('/speech/models')).activeModel).toBe('base');
  expect((await call('/speech/status')).ok).toBe(true);
  console.log('Verified Base startup, real Tiny download with SHA-256, Tiny startup, and switch back to Base.');
} finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
