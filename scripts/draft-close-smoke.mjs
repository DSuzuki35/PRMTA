import { _electron as electron, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'prmta-close-smoke-'));
const env = { ...process.env, PRMTA_DATA_DIR: join(dir, 'library'), PRMTA_PROFILE_DIR: join(dir, 'profile') }; delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ args: ['.'], env }); let page = await app.firstWindow();
  await page.getByText('Studio connected', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'New script', exact: true }).click();
  await page.getByLabel('Script title').fill(''); await page.getByLabel('Script text').fill('Keep this unfinished draft after closing.');
  const firstOrigin = await page.evaluate(() => location.origin);
  await app.close();
  app = await electron.launch({ args: ['.'], env }); page = await app.firstWindow();
  await page.getByText('Studio connected', { exact: true }).waitFor();
  expect(await page.evaluate(() => location.origin)).toBe(firstOrigin);
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: /Untitled script/ }).first().click();
  await expect(page.getByLabel('Script text')).toHaveValue('Keep this unfinished draft after closing.');
  await expect(page.getByLabel('Script title')).toHaveValue('');
  console.log('Verified closing with an invalid unsaved title and restoring the draft after relaunch.');
} finally { await app?.close(); rmSync(dir, { recursive: true, force: true }); }
