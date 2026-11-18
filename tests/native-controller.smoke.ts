// Run with Electron after bundling this file with esbuild (packages: external).
// Uses an isolated hidden window and a fake device for transport; real hardware
// is enumerated read-only and is never allowed to control a user session.
import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Session } from '../server/session';
import { defaultPreferences } from '../shared/model';
import { NativeControllerService } from '../electron/controller-service';
import { createSdlControllerSampler } from '../electron/controller-sdl';

app.setPath('userData', mkdtempSync(join(tmpdir(), 'prmta-native-controller-smoke-')));
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
void app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await window.loadURL('about:blank'); window.minimize(); await wait(50);
  assert.equal(window.isFocused(), false); assert.equal(window.isMinimized(), true);
  const session = new Session(); session.load({ id: 'native-smoke', title: 'Native smoke', content: 'First page.\n---\n' + 'Second page has plenty of words. '.repeat(30) });
  const buttons = Array.from({ length: 128 }, () => ({ pressed: false }));
  const preferences = { ...defaultPreferences, gamepadEnabled: true, gamepadBackground: true, scrollDownButton: 1 };
  const controller = new NativeControllerService({
    sampler: { sample: () => [{ index: 0, id: 'test-native-device', name: 'Test device', mapping: 'raw', buttons }], close() {} },
    getPreferences: () => preferences, dispatch: command => session.command(command), isFocused: () => window.isFocused(),
  });
  controller.setContext({ blocked: true, assigning: false }); await wait(75);
  buttons[5].pressed = true; await wait(75); assert.equal(session.state.position, 2);
  buttons[5].pressed = false; buttons[1].pressed = true; await wait(1000);
  assert.equal(session.scrolling, true); assert.ok(session.state.position > 3);
  buttons[1].pressed = false; await wait(75); assert.equal(session.scrolling, false);
  controller.close();
  const native = await createSdlControllerSampler();
  const devices = native.sample().map(pad => ({ name: pad.name, mapping: pad.mapping, buttons: pad.buttons.length })); native.close();
  writeFileSync(resolve('artifacts/native-controller-smoke.json'), JSON.stringify({ passed: true, electron: process.versions.electron, focused: window.isFocused(), minimized: window.isMinimized(), navigationPosition: 2, finalPosition: session.state.position, backgroundHint: process.env.SDL_JOYSTICK_ALLOW_BACKGROUND_EVENTS, devices }, null, 2));
  window.destroy(); app.quit();
}).catch(error => { console.error(error); app.exit(1); });
