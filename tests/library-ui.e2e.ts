import { expect, test } from '@playwright/test';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHost, type Host } from '../server/host';
import type { Script } from '../shared/model';

let host: Host, root: string, alpha: Script;
const post = (path: string, body: unknown) => fetch(`${host.origin}/api${path}`, {
  method: 'POST', headers: { Authorization: `Bearer ${host.tokens.admin}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
test.beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'prmta-library-ui-'));
  host = await createHost({ dataDir: join(root, 'local'), port: 0, staticDir: resolve('dist') });
  alpha = await (await post('/scripts', { draft: { id: crypto.randomUUID(), title: 'Alpha', content: 'The first script.' }, expectedHeads: [] })).json();
  await post('/scripts', { draft: { id: crypto.randomUUID(), title: 'Beta', content: 'The second script.' }, expectedHeads: [] });
});
test.afterEach(async () => { await host.close(); rmSync(root, { recursive: true, force: true }); });

test('library grid and list view persist and expose separate open and trash buttons', async ({ page }) => {
  await page.goto(host.url('admin')); await page.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Grid view', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'List view', exact: true }).click();
  await expect(page.locator('.script-grid')).toHaveClass(/script-list/);
  expect(await page.locator('.script-card button button').count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Move Alpha to trash', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'List view', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.setViewportSize({ width: 800, height: 1000 });
  expect(await page.locator('main').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: 'Grid view', exact: true }).click();
  await expect(page.locator('.script-grid')).not.toHaveClass(/script-list/);
});

test('closing saves an expanded editor and keeps it open when its draft cannot be saved', async ({ page }) => {
  await page.goto(host.url('admin')); await page.getByRole('button', { name: 'Library', exact: true }).click();
  const overview = (await page.locator('.library-panel').boundingBox())!.width;
  await page.getByRole('button', { name: 'Open Alpha', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open Alpha', exact: true })).toHaveAttribute('aria-current', 'true');
  await page.getByLabel('Script text').fill('Keep my unsaved content.');
  await page.getByLabel('Script title').fill('');
  await page.getByRole('button', { name: 'Expand editor', exact: true }).click();
  await page.getByRole('button', { name: 'Close editor', exact: true }).click();
  await expect(page.getByText('Save failed', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Script text')).toHaveValue('Keep my unsaved content.');
  await page.getByLabel('Script title').fill('Alpha');
  await page.getByRole('button', { name: 'Close editor', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Script editor', exact: true })).toHaveCount(0);
  expect((await page.locator('.library-panel').boundingBox())!.width).toBeGreaterThan(overview - 2);
  expect(await page.locator('.sidebar').evaluate(el => (el as HTMLElement).inert)).toBe(false);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Script editor', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open Alpha', exact: true }).click();
  await expect(page.getByLabel('Script text')).toHaveValue('Keep my unsaved content.');
  await expect(page.getByLabel('Script title')).toHaveValue('Alpha');
});

test('overview deletion asks first, preserves the open draft in Trash, and closes the editor', async ({ page }) => {
  await page.goto(host.url('admin')); await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: 'Open Alpha', exact: true }).click();
  await page.getByLabel('Script text').fill('Keep this latest edit in Trash.');
  await page.getByRole('button', { name: 'Move Alpha to trash', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Move script to trash', exact: true });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(host.library.get(alpha.id)!.deleted).toBe(false);
  await page.getByRole('button', { name: 'Move Alpha to trash', exact: true }).click();
  await confirm.getByRole('button', { name: 'Move to trash', exact: true }).click();
  await expect.poll(() => host.library.get(alpha.id)!.deleted).toBe(true);
  await expect(page.getByRole('region', { name: 'Script editor', exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Search scripts', exact: true })).toBeFocused();
  await page.waitForTimeout(1100);
  expect(host.library.get(alpha.id)!.deleted).toBe(true);
  expect(host.library.get(alpha.id)!.content).toBe('Keep this latest edit in Trash.');
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  await page.getByRole('button', { name: 'Open Alpha', exact: true }).click();
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect.poll(() => host.library.get(alpha.id)!.deleted).toBe(false);
});

test('deleting a previously selected script waits for its in-flight autosave', async ({ page }) => {
  await page.goto(host.url('admin')); await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: 'Open Alpha', exact: true }).click();
  let saving = false, release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/scripts', async route => {
    if (route.request().method() === 'POST' && route.request().postDataJSON().draft?.content === 'Pending content.' && !route.request().postDataJSON().draft?.deleted) {
      saving = true; await held;
    }
    await route.continue();
  });
  await page.getByLabel('Script text').fill('Pending content.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => saving).toBe(true);
  await page.getByRole('button', { name: 'Open Beta', exact: true }).click();
  await page.getByRole('button', { name: 'Move Alpha to trash', exact: true }).click();
  await page.getByRole('dialog', { name: 'Move script to trash' }).getByRole('button', { name: 'Move to trash', exact: true }).click();
  release();
  await expect.poll(() => host.library.get(alpha.id)!.deleted).toBe(true);
  await page.waitForTimeout(1100);
  expect(host.library.get(alpha.id)!.deleted).toBe(true);
  expect(host.library.get(alpha.id)!.content).toBe('Pending content.');
  await expect(page.getByLabel('Script title')).toHaveValue('Beta');
});

test('cloud overview deletion removes the TXT through the existing trash flow', async ({ page }) => {
  const folder = join(root, 'cloud'); mkdirSync(folder); writeFileSync(join(folder, 'Cloud story.txt'), 'Cloud content.');
  await post('/workspace', { folder, copyCurrent: false });
  await page.goto(host.url('admin')); await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: 'Move Cloud story to trash', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Move script to trash' });
  await expect(confirm).toContainText('cloud folder');
  await confirm.getByRole('button', { name: 'Move to trash', exact: true }).click();
  await expect.poll(() => readdirSync(folder).filter(file => file.endsWith('.txt'))).toEqual([]);
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  await page.getByRole('button', { name: 'Open Cloud story', exact: true }).click();
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect.poll(() => readdirSync(folder).filter(file => file.endsWith('.txt'))).toEqual(['Cloud story.txt']);
});

test('a delayed close never closes a different script opened while the save is pending', async ({ page }) => {
  await page.goto(host.url('admin')); await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: 'Open Alpha', exact: true }).click();
  let saving = false, release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/scripts', async route => {
    if (route.request().method() === 'POST' && route.request().postDataJSON().draft?.content === 'Closing content.') { saving = true; await held; }
    await route.continue();
  });
  await page.getByLabel('Script text').fill('Closing content.');
  await page.getByRole('button', { name: 'Close editor', exact: true }).click();
  await expect.poll(() => saving).toBe(true);
  await page.getByRole('button', { name: 'Open Beta', exact: true }).click();
  release();
  await expect.poll(() => host.library.get(alpha.id)!.content).toBe('Closing content.');
  await expect(page.getByLabel('Script title')).toHaveValue('Beta');
});

test('overview deletion uses the completed save when it finishes before confirmation', async ({ page }) => {
  await page.goto(host.url('admin')); await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: 'Open Alpha', exact: true }).click();
  let saving = false, release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/scripts', async route => {
    if (route.request().method() === 'POST' && route.request().postDataJSON().draft?.content === 'Saved before confirmation.' && !route.request().postDataJSON().draft?.deleted) { saving = true; await held; }
    await route.continue();
  });
  await page.getByLabel('Script text').fill('Saved before confirmation.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => saving).toBe(true);
  await page.getByRole('button', { name: 'Open Beta', exact: true }).click();
  await page.getByRole('button', { name: 'Move Alpha to trash', exact: true }).click();
  release();
  await expect(page.getByRole('button', { name: 'Open Alpha', exact: true }).locator('p')).toHaveText('Saved before confirmation.');
  await page.getByRole('dialog', { name: 'Move script to trash' }).getByRole('button', { name: 'Move to trash', exact: true }).click();
  await expect.poll(() => host.library.get(alpha.id)!.deleted).toBe(true);
  expect(host.library.get(alpha.id)!.content).toBe('Saved before confirmation.');
});

test('a failed trash cannot silently delete the draft after cancelling and closing', async ({ page }) => {
  await page.goto(host.url('admin')); await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: 'Open Alpha', exact: true }).click();
  await page.getByLabel('Script text').fill('Keep this edit after the failed deletion.');
  let failed = false;
  await page.route('**/api/scripts', async route => {
    if (!failed && route.request().method() === 'POST' && route.request().postDataJSON().draft?.deleted) {
      failed = true; await route.fulfill({ status: 503, json: { error: 'Temporary trash failure.' } }); return;
    }
    await route.continue();
  });
  await page.getByRole('button', { name: 'Move Alpha to trash', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Move script to trash' });
  await confirm.getByRole('button', { name: 'Move to trash', exact: true }).click();
  await expect(page.getByText('Temporary trash failure.', { exact: true })).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Close editor', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Script editor' })).toHaveCount(0);
  expect(host.library.get(alpha.id)!.deleted).toBe(false);
  expect(host.library.get(alpha.id)!.content).toBe('Keep this edit after the failed deletion.');
  await page.waitForTimeout(1100);
  expect(host.library.get(alpha.id)!.deleted).toBe(false);
});

test('confirmation from a previous workspace cannot delete a script in the new library', async ({ page }) => {
  await page.goto(host.url('admin')); await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: 'Move Alpha to trash', exact: true }).click();
  const folder = join(root, 'new-cloud'); mkdirSync(folder);
  await post('/workspace', { folder, copyCurrent: true });
  await expect(page.locator('.workspace-switch small')).toHaveText('CLOUD LIBRARY');
  await page.getByRole('dialog', { name: 'Move script to trash' }).getByRole('button', { name: 'Move to trash', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Library changed');
  expect(host.library.get(alpha.id)!.deleted).toBe(false);
  expect(readdirSync(folder)).toContain('Alpha.txt');
});
