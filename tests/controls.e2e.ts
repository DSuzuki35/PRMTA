import { test, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHost, type Host } from '../server/host';
import { defaultPreferences } from '../shared/model';
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });
let host: Host, dir: string;
test.beforeAll(async () => { dir = mkdtempSync(join(tmpdir(), 'prmta-controls-')); host = await createHost({ dataDir: dir, port: 0, staticDir: resolve('dist') }); });
test.afterAll(async () => { await host.close(); rmSync(dir, { recursive: true, force: true }); });
test('microphone meter reacts to audio and releases the input on stop', async ({ page }) => {
  await page.goto(host.url('admin')); await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Test microphone', exact: true }).click();
  await expect.poll(() => page.getByRole('meter').getAttribute('aria-valuenow')).not.toBe('-60');
  await page.getByRole('button', { name: 'Stop test', exact: true }).click();
  await expect(page.getByRole('meter')).toHaveAttribute('aria-valuenow', '-60');
  await expect(page.getByText('Microphone test stopped.')).toBeVisible();
});
test('assignment ignores a held button and commits only after release', async ({ page }) => {
  await page.goto(host.url('admin')); await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.evaluate(() => {
    (window as any).pad = { index: 0, id: 'Fixture', buttons: Array.from({ length: 10 }, (_, i) => ({ pressed: i === 0 })) };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [(window as any).pad] });
  });
  await page.getByRole('button', { name: 'Assign next page button' }).click();
  await expect(page.getByText('Press and release a button. Already-held buttons are ignored.')).toBeVisible();
  await page.evaluate(() => { (window as any).pad.buttons[7].pressed = true; });
  await expect(page.getByText('Release the button to finish assigning.')).toBeVisible();
  expect(host.library.getSetting<any>('preferences', defaultPreferences).nextButton).toBe(5);
  await page.evaluate(() => { (window as any).pad.buttons[7].pressed = false; });
  await expect(page.getByText('Button 7 assigned to Next page.')).toBeVisible();
  await expect.poll(() => host.library.getSetting<any>('preferences', {}).nextButton).toBe(7);
});
test('responsive speech sends short overlapping windows, one at a time, and stops work while paused', async ({ page }) => {
  host.session.load({ id: 'speech', title: 'Speech', content: 'One two three four five six seven eight nine ten.' });
  await page.route(/\/api\/speech\/status(?:\?|$)/, route => route.fulfill({ json: { ok: true, message: 'Ready' } }));
  const requests: { at: number; bytes: number }[] = []; let active = 0, maxActive = 0;
  await page.route(/\/api\/speech(?:\?|$)/, async route => {
    requests.push({ at: Date.now(), bytes: route.request().postDataBuffer()!.length }); active++; maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setTimeout(resolve, 200)); active--;
    await route.fulfill({ json: { text: 'One two three four' } });
  });
  await page.goto(host.url('admin'));
  await page.getByRole('button', { name: 'Enable voice', exact: true }).click();
  await page.getByRole('button', { name: 'Mic on', exact: true }).waitFor();
  await page.waitForTimeout(1200); expect(requests).toHaveLength(0);
  await page.evaluate(async () => { await fetch('/api/command', { method: 'POST', headers: { Authorization: `Bearer ${sessionStorage.getItem('prmpt-token')}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'play', countdown: 0 }) }); });
  await expect.poll(() => requests.length, { timeout: 10000 }).toBeGreaterThanOrEqual(4);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const count = requests.length; await page.waitForTimeout(1300); expect(requests.length).toBe(count);
  expect(maxActive).toBe(1); expect(Math.max(...requests.map(r => r.bytes))).toBeLessThan(110000);
  expect(requests[3].at - requests[1].at).toBeLessThan(1600);
  await page.getByRole('button', { name: 'Mic on', exact: true }).click();
});
