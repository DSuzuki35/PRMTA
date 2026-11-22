import { test, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHost, type Host } from '../server/host';
import { defaultPreferences } from '../shared/model';
let host: Host, dir: string;
test.beforeEach(async ({ page }) => {
  dir = mkdtempSync(join(tmpdir(), 'prmta-native-ui-'));
  host = await createHost({ dataDir: dir, port: 0, staticDir: resolve('dist') });
  await fetch(`${host.origin}/api/preferences`, { method: 'POST', headers: { Authorization: `Bearer ${host.tokens.admin}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...defaultPreferences, gamepadEnabled: true }) });
  host.session.load({ id: 'fixture', title: 'Fixture', content: 'First sentence.\n---\nNext page.' });
  await page.addInitScript(() => {
    (window as any).nativeButtons = [];
    (window as any).contexts = [];
    (window as any).desktop = {
      controllerContext: async (context: unknown) => { (window as any).contexts.push(context); },
      controllerState: async () => (window as any).nativeUnavailable ? { status: 'error', backend: 'sdl', fallback: true, message: 'Native startup failed', pads: [] } : ({ status: 'ready', backend: 'sdl', message: 'Native controller ready.', pads: [{ index: 0, id: 'native-test', name: 'Fixture joystick', mapping: 'raw', buttons: Array.from({ length: 128 }, (_, i) => ({ pressed: (window as any).nativeButtons.includes(i) })) }] }),
    };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => { if ((window as any).nativeUnavailable) return [{ index: 0, id: 'browser-fallback', buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: (window as any).nativeButtons.includes(i) })) }]; throw new Error('Desktop must not also read browser gamepads.'); } });
  });
});
test.afterEach(async () => { await host.close(); rmSync(dir, { recursive: true, force: true }); });

test('desktop sends context and assigns using native button snapshots, including high buttons', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(host.url('admin'));
  await expect.poll(() => page.evaluate(() => (window as any).contexts.at(-1))).toEqual({ blocked: false, assigning: false });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Keep voice follow active', exact: true })).toBeChecked();
  await expect(page.getByRole('switch', { name: 'Controller input in background', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Assign next sentence button', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).contexts.at(-1))).toEqual({ blocked: true, assigning: true });
  await page.waitForTimeout(80);
  await page.evaluate(() => { (window as any).nativeButtons = [73]; });
  await expect(page.locator('.settings-card').filter({ has: page.getByRole('heading', { name: 'Joystick / Gamepad', exact: true }) }).locator('.assignment-status')).toContainText('Release the button');
  await page.evaluate(() => { (window as any).nativeButtons = []; });
  await expect(page.locator('.settings-card').filter({ has: page.getByRole('heading', { name: 'Joystick / Gamepad', exact: true }) }).locator('.assignment-status')).toContainText('Button 73 assigned');
  await expect.poll(() => host.getPreferences().nextSentenceButton).toBe(73);
  await expect.poll(() => page.evaluate(() => (window as any).contexts.at(-1))).toEqual({ blocked: true, assigning: false });
  await page.getByRole('switch', { name: 'Keep voice follow active', exact: true }).uncheck();
  await expect.poll(() => host.getPreferences().gamepadKeepVoiceActive).toBe(false);
  expect(errors).toEqual([]);
});


test('permanent native initialization failure retains foreground-only browser input and assignment', async ({ page }) => {
  await page.addInitScript(() => { (window as any).nativeUnavailable = true; });
  await page.goto(host.url('admin')); await page.getByText('Studio connected', { exact: true }).waitFor();
  await page.waitForTimeout(100); await page.evaluate(() => { (window as any).nativeButtons = [5]; });
  await expect.poll(() => host.session.state.position).toBe(2);
  await page.evaluate(() => { window.dispatchEvent(new Event('blur')); (window as any).nativeButtons = []; });
  await page.waitForTimeout(100); await page.evaluate(() => { (window as any).nativeButtons = [4]; });
  await page.waitForTimeout(100); expect(host.session.state.position).toBe(2);
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); (window as any).nativeButtons = []; });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByText(/Foreground browser input is active/)).toBeVisible();
  await page.getByRole('button', { name: 'Assign next sentence button', exact: true }).click();
  await page.waitForTimeout(100); await page.evaluate(() => { (window as any).nativeButtons = [7]; });
  await expect(page.locator('.settings-card').filter({ has: page.getByRole('heading', { name: 'Joystick / Gamepad', exact: true }) }).locator('.assignment-status')).toContainText('Release the button');
  await page.evaluate(() => { (window as any).nativeButtons = []; });
  await expect.poll(() => host.getPreferences().nextSentenceButton).toBe(7);
});
