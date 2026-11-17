import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHost, type Host } from '../server/host';
let host: Host, dir: string;
test.beforeAll(async () => { dir = mkdtempSync(join(tmpdir(), 'prmta-accessibility-')); host = await createHost({ dataDir: dir, port: 0, staticDir: resolve('dist') }); });
test.afterAll(async () => { await host.close(); rmSync(dir, { recursive: true, force: true }); });
test('main screens have no automated WCAG A/AA accessibility violations', async ({ page }) => {
  await page.goto(host.url('admin')); await page.getByRole('button', { name: 'Try a sample', exact: true }).click();
  for (const view of ['Prompter', 'Library', 'Outputs', 'Settings']) {
    await page.getByRole('button', { name: view, exact: true }).click();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(results.violations.map(v => ({ rule: v.id, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) })), view).toEqual([]);
  }
});
test('switches have space below selects, a visible focus ring and keyboard activation', async ({ page }) => {
  await page.goto(host.url('admin')); await page.getByLabel('Text flow').selectOption('page');
  const toggle = page.getByRole('switch', { name: 'Preview next line', exact: true });
  await toggle.focus(); await expect(toggle).toBeFocused(); await page.keyboard.press('Space'); await expect(toggle).toBeChecked();
  const geometry = await toggle.evaluate(el => {
    const row = el.closest('.toggle-field')!, flow = document.querySelector('.flow-field select')!;
    const track = row.querySelector('.switch')!;
    return { gap: row.getBoundingClientRect().top - flow.getBoundingClientRect().bottom, height: row.getBoundingClientRect().height, focusWidth: getComputedStyle(track).outlineWidth };
  });
  expect(geometry.gap).toBeGreaterThanOrEqual(12); expect(geometry.height).toBeGreaterThanOrEqual(40); expect(parseFloat(geometry.focusWidth)).toBeGreaterThanOrEqual(2);
});
test('help traps focus, closes with Escape and restores the opener without playback changes', async ({ page }) => {
  host.session.load({ id: 'dialog', title: 'Dialog', content: 'A take stays active while help is open.' });
  host.session.command({ type: 'mode', mode: 'manual' }); host.session.command({ type: 'play', countdown: 0 });
  await page.goto(host.url('admin')); const opener = page.getByRole('button', { name: 'Quick start', exact: true });
  await opener.click(); const dialog = page.getByRole('dialog', { name: 'Quick start' }); await expect(dialog).toBeVisible();
  await page.keyboard.press('ArrowRight'); expect(host.session.state.position).toBe(0);
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
  for (let i = 0; i < 5; i++) { await page.keyboard.press('Tab'); expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true); }
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
  expect(host.session.state.playing).toBe(true); host.session.command({ type: 'pause' });
});

test('narrow layouts retain named controls without horizontal content clipping', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 1000 }); await page.goto(host.url('admin'));
  for (const view of ['Prompter', 'Library', 'Outputs', 'Settings']) {
    await page.getByRole('button', { name: view, exact: true }).click();
    expect(await page.locator('main').evaluate(el => el.scrollWidth - el.clientWidth), view).toBeLessThanOrEqual(1);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(results.violations.map(v => ({ rule: v.id, targets: v.nodes.map(n => n.target) })), view).toEqual([]);
  }
});
