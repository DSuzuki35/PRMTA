import { test, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHost, type Host } from '../server/host';

let host: Host, dir: string;
test.beforeEach(async ({ page }) => {
  dir = mkdtempSync(join(tmpdir(), 'prmta-update-ui-'));
  host = await createHost({ dataDir: dir, port: 0, staticDir: resolve('dist') });
  await page.addInitScript(() => {
    (window as any).installCalls = 0;
    (window as any).desktop = {
      updateStatus: async () => ({ mode: 'installed', phase: 'ready', currentVersion: '0.3.0', version: '0.3.1', message: 'Ready to install fixture.' }),
      onUpdateStatus: () => () => {},
      installUpdate: async () => { (window as any).installCalls++; },
      openReleases: async () => {},
    };
  });
  await page.goto(host.url('admin'));
  await page.getByRole('button', { name: 'Try a sample', exact: true }).click();
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: /Your words. Your pace./ }).first().click();
});
test.afterEach(async () => { await host.close(); rmSync(dir, { recursive: true, force: true }); });

test('restart waits for an unmounted editor save before invoking installation', async ({ page }) => {
  let release!: () => void, saving = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/scripts', async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    saving = true; await gate; await route.continue();
  });
  await page.getByRole('textbox', { name: 'Script text', exact: true }).fill('A draft that must finish saving before the update.');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect.poll(() => saving).toBe(true);
  await page.getByRole('button', { name: 'Restart and install', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saving your work…', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => (window as any).installCalls)).toBe(0);
  release();
  await expect.poll(() => page.evaluate(() => (window as any).installCalls)).toBe(1);
  expect(host.library.list().some(script => script.content === 'A draft that must finish saving before the update.')).toBe(true);
});

test('failed draft blocks restart and reopening/saving the editor recovers', async ({ page }) => {
  await page.route('**/api/scripts', async route => {
    if (route.request().method() === 'POST') await route.fulfill({ status: 500, json: { error: 'Fixture disk unavailable' } });
    else await route.continue();
  });
  await page.getByRole('textbox', { name: 'Script text', exact: true }).fill('A recoverable update draft.');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Restart and install', exact: true }).click();
  await expect(page.getByText(/Could not restart\./)).toBeVisible();
  expect(await page.evaluate(() => (window as any).installCalls)).toBe(0);
  await page.unroute('**/api/scripts');
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: /Your words. Your pace./ }).first().click();
  await expect(page.getByRole('textbox', { name: 'Script text', exact: true })).toHaveValue('A recoverable update draft.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.save-state')).toHaveText('Saved');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Restart and install', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).installCalls)).toBe(1);
});
