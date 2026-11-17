import { _electron as electron, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'prmta-clipboard-'));
const env = { ...process.env, PRMTA_PROFILE_DIR: dir }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.'], env });
try {
  const page = await app.firstWindow(); await page.getByText('Studio connected', { exact: true }).waitFor();
  await app.evaluate(async ({ clipboard, ClipboardItem }) => {
    globalThis.prmtaClipboardBackup = await Promise.all((await clipboard.read()).map(async item => new ClipboardItem(Object.fromEntries(await Promise.all(item.types.map(async type => [type, await item.getType(type)]))))));
  });
  await page.getByRole('button', { name: 'Outputs', exact: true }).click();
  const expected = await page.getByLabel('Browser & OBS Link').inputValue();
  await page.getByRole('button', { name: 'Copy link', exact: true }).first().click();
  await expect(page.getByText('Link copied. Paste it into your browser or OpenKneeboard.')).toBeVisible();
  const copied = await app.evaluate(async ({ clipboard }) => clipboard.readText());
  if (copied !== expected) throw new Error('Native clipboard content differs from the output URL');
  console.log('Native Copy link verified; URL matches the clipboard.');
} finally {
  await app.evaluate(async ({ clipboard }) => { if (globalThis.prmtaClipboardBackup) { await clipboard.write(globalThis.prmtaClipboardBackup); } });
  await app.close(); rmSync(dir, { recursive: true, force: true });
}
