import { test, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHost } from '../server/host';
import { defaultPreferences } from '../shared/model';

test('remote retains safe keyboard defaults with public-only preferences', async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), 'prmta-remote-keys-'));
  const host = await createHost({ dataDir: dir, port: 0, staticDir: resolve('dist') });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    const headers = { Authorization: `Bearer ${host.tokens.admin}`, 'Content-Type': 'application/json' };
    await fetch(host.origin + '/api/preferences', { method: 'POST', headers, body: JSON.stringify({ ...defaultPreferences, countdown: 0, keyboardScrollSpeed: 330, shortcuts: { ...defaultPreferences.shortcuts, nextPage: 'Shift+KeyN' } }) });
    host.session.load({ id: 'remote', title: 'Remote fixture', content: 'First page here.\n\n---\n\nSecond page here.\n\n---\n\nThird page here.' });
    await page.goto(host.url('remote'));
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    const publicState = await (await fetch(host.origin + '/api/state', { headers: { Authorization: `Bearer ${host.tokens.remote}` } })).json();
    expect(Object.keys(publicState.preferences).sort()).toEqual(['countdown', 'profiles']);
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('PageDown');
    await expect.poll(() => host.session.state.position).toBe(3);
    await page.keyboard.press('Shift+KeyN');
    expect(host.session.state.position).toBe(3);
    await page.keyboard.down('Shift'); await page.keyboard.down('ArrowDown');
    await expect.poll(() => host.session.state.manualScrollActive).toBe(true);
    await page.keyboard.up('ArrowDown'); await page.keyboard.up('Shift');
    await expect.poll(() => host.session.state.manualScrollActive).toBe(false);
    expect(errors).toEqual([]);
  } finally { await host.close(); rmSync(dir, { recursive: true, force: true }); }
});
