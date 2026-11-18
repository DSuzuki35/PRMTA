// Exercise the real packaged updater against known local installer bytes.
// Never installs an update and never uses the user's profile/update cache.
import { _electron as electron, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';

const executable = resolve(process.argv[2] ?? 'release/0.3.0/win-unpacked/PRMTA.exe');
const installer = resolve(process.argv[3] ?? 'release/0.3.0/PRMTA-Setup-0.3.0-x64.exe');
const releaseRoot = resolve('release') + sep;
if (!executable.startsWith(releaseRoot) || basename(dirname(executable)) !== 'win-unpacked') throw new Error('Use an isolated release/win-unpacked build, never an installed app.');
if (!existsSync(executable) || !existsSync(installer)) throw new Error('Build the unpacked app and Setup installer first.');
const marker = join(dirname(executable), 'Uninstall PRMTA.exe');
if (existsSync(marker)) throw new Error('Refusing to use a folder that already has an uninstaller.');
const dir = mkdtempSync(join(tmpdir(), 'prmta-updater-smoke-'));
const filename = basename(installer), size = statSync(installer).size;
const sha512 = createHash('sha512').update(readFileSync(installer)).digest('base64');
let fixtureVersion = '0.3.0';
let downloads = 0;
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  if (path === '/latest.yml') {
    response.setHeader('Content-Type', 'text/yaml');
    response.end(`version: ${fixtureVersion}\nfiles:\n  - url: ${filename}\n    sha512: ${sha512}\n    size: ${size}\npath: ${filename}\nsha512: ${sha512}\nreleaseDate: '2026-11-18T00:00:00.000Z'\n`);
  } else if (path === `/${filename}`) {
    downloads++; response.setHeader('Content-Length', size); createReadStream(installer).pipe(response);
  } else { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const feed = `http://127.0.0.1:${server.address().port}`;
let app, markerCreated = false;
try {
  // Detection fixture only. Empty marker is never executed.
  writeFileSync(marker, '', { flag: 'wx' });
  markerCreated = true;
  const env = { ...process.env, PRMTA_DATA_DIR: join(dir, 'library'), PRMTA_PROFILE_DIR: join(dir, 'profile') };
  delete env.ELECTRON_RUN_AS_NODE; delete env.PORTABLE_EXECUTABLE_DIR; delete env.PORTABLE_EXECUTABLE_FILE;
  app = await electron.launch({ executablePath: executable, env });
  const page = await app.firstWindow();
  await page.getByText('Studio connected', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Try a sample', exact: true }).click();
  await app.evaluate(async ({ app }, { feed, cache }) => {
    const load = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
    const updater = load('electron-updater').autoUpdater;
    Object.defineProperty(updater.app, 'baseCachePath', { value: cache });
    updater.setFeedURL({ provider: 'generic', url: feed });
    updater.disableDifferentialDownload = true;
    // A test must fail loudly instead of ever executing the downloaded installer.
    updater.quitAndInstall = () => { throw new Error('Installation is forbidden in this smoke test.'); };
  }, { feed, cache: join(dir, 'update-cache') });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const updates = page.locator('.settings-card').filter({ has: page.getByRole('heading', { name: 'App updates', exact: true }) });
  await expect(updates.getByText('Version 0.3.0', { exact: true })).toBeVisible();
  await updates.getByRole('button', { name: 'Check for updates', exact: true }).click();
  await expect(updates.getByText('You have the latest version.', { exact: true })).toBeVisible();
  if (process.env.PRMTA_CAPTURE_UPDATE_DOCS) await updates.screenshot({ path: 'docs/images/updates.png' });
  fixtureVersion = '99.0.0';
  await updates.getByRole('button', { name: 'Check for updates', exact: true }).click();
  await expect(updates.getByRole('button', { name: 'Restart and install', exact: true })).toBeVisible({ timeout: 90000 });
  const downloaded = await app.evaluate(async ({ app }) => {
    return process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json')('electron-updater').autoUpdater.installerPath;
  });
  if (!resolve(downloaded).startsWith(dir + sep)) throw new Error('Updater wrote outside the isolated cache.');
  if (createHash('sha512').update(readFileSync(downloaded)).digest('base64') !== sha512) throw new Error('Downloaded installer bytes do not match.');
  if (downloads !== 1) throw new Error(`Expected one installer transfer, got ${downloads}.`);
  await page.evaluate(async () => {
    await fetch('/api/command', { method: 'POST', headers: { Authorization: `Bearer ${sessionStorage.getItem('prmpt-token')}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'play', countdown: 0 }) });
  });
  await updates.getByRole('button', { name: 'Restart and install', exact: true }).click();
  await expect(page.getByText(/Could not restart.*Pause playback/)).toBeVisible();
  await expect(updates.getByRole('button', { name: 'Restart and install', exact: true })).toBeVisible();
  console.log('Packaged updater: current-version check, new-version download, SHA-512, ready UI, active-take install guard and isolated cache passed. Installation deliberately not executed.');
} finally {
  await app?.close();
  await new Promise(resolve => server.close(resolve));
  if (markerCreated) rmSync(marker, { force: true });
  rmSync(dir, { recursive: true, force: true });
}
