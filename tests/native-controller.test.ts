import { afterEach, expect, it, vi } from 'vitest';
import { NativeControllerService } from '../electron/controller-service';
import { defaultPreferences, type Preferences } from '../shared/model';
import { Session } from '../server/session';
import type { ControllerPad } from '../shared/controller';
import { SdlControllerSampler, standardButtons } from '../electron/controller-sdl';

let service: NativeControllerService | undefined;
afterEach(() => { service?.close(); service = undefined; vi.useRealTimers(); });
function setup() {
  vi.useFakeTimers(); vi.setSystemTime(1000);
  const session = new Session(); session.load({ id: 'fixture', title: 'Fixture', content: 'First page.\n---\nSecond page.\n---\nThird page.\n---\n' + 'More script words. '.repeat(40) });
  let preferences: Preferences = { ...defaultPreferences, gamepadEnabled: true, scrollDownButton: 1, gamepadBackground: true, gamepadKeepVoiceActive: true };
  let focused = true, failed = false;
  let pads: ControllerPad[] = [{ index: 9, id: 'native-device', name: 'HOTAS', mapping: 'raw', buttons: Array.from({ length: 128 }, () => ({ pressed: false })) }];
  const sampler = { sample: () => { if (failed) throw new Error('Device read failed'); return structuredClone(pads); }, close: () => {} };
  service = new NativeControllerService({ sampler, getPreferences: () => preferences, dispatch: command => session.command(command), isFocused: () => focused });
  const tick = (ms = 25) => vi.advanceTimersByTime(ms);
  const press = (index: number, pressed: boolean) => { if (pads[0]) pads[0].buttons[index].pressed = pressed; tick(); };
  service.setContext({ blocked: false, assigning: false }); tick();
  return { session, tick, press, focus: (value: boolean) => { focused = value; }, preferences: (patch: Partial<Preferences>) => { preferences = { ...preferences, ...patch }; tick(); }, disconnect: () => { pads = []; tick(); }, fail: () => { failed = true; tick(); } };
}

it('executes fresh button presses while unfocused without renderer polling or heartbeat', () => {
  const env = setup(); env.focus(false);
  env.press(5, true); expect(env.session.state.position).toBe(2);
  env.press(5, false); env.press(5, true); expect(env.session.state.position).toBe(4);
  expect(service!.state.status).toBe('ready'); expect(service!.state.pads[0].buttons).toHaveLength(128);
  env.preferences({ nextButton: 100 }); env.press(100, true); expect(env.session.state.position).toBe(6);
});

it('keeps standard shoulder and trigger numbering compatible with browser gamepads', () => {
  const buttons = standardButtons({ a: true, leftShoulder: true, rightShoulder: true, dpadUp: true }, { leftTrigger: .75, rightTrigger: .1 });
  expect(buttons.map((button, index) => button.pressed ? index : -1).filter(index => index >= 0)).toEqual([0, 4, 5, 6, 12]);
});

it('uses fresh native device snapshots, supports raw HOTAS buttons, and releases removed device handles', () => {
  const device = { id: 17, name: 'Flight stick', path: null, type: 'flightstick', guid: 'fixture', vendor: 1, product: 2, version: null, player: null };
  let devices = [device]; let pressed = false; let closed = false;
  const instance = { device, get buttons() { return Array.from({ length: 150 }, (_, index) => index === 100 && pressed); }, get closed() { return closed; }, close() { closed = true; } };
  const bindings = { info: { initialized: { joystick: true } }, joystick: { get devices() { return devices; }, openDevice: () => instance }, controller: { devices: [], openDevice: () => { throw new Error('No mapped gamepad'); } } };
  const sampler = new SdlControllerSampler(bindings as unknown as ConstructorParameters<typeof SdlControllerSampler>[0]);
  expect(sampler.sample()[0].buttons).toHaveLength(128);
  pressed = true; expect(sampler.sample()[0].buttons[100].pressed).toBe(true);
  devices = []; expect(sampler.sample()).toEqual([]); expect(closed).toBe(true);
  sampler.close();
});

it('keeps native held scrolling alive while minimized and stops on release or disconnect', () => {
  const env = setup(); env.focus(false);
  env.press(1, true); env.tick(1500); env.session.tick(); expect(env.session.state.position).toBeGreaterThan(2);
  expect(env.session.scrolling).toBe(true);
  env.press(1, false); const release = env.session.state.position; env.tick(1000); env.session.tick(); expect(env.session.state.position).toBe(release);
  env.press(1, true); env.disconnect(); expect(env.session.scrolling).toBe(false); expect(service!.state.pads).toEqual([]);
});

it('suspends assignment regardless of focus, honors background preference, and requires a fresh press on resume', () => {
  const env = setup(); service!.setContext({ blocked: true, assigning: false }); env.tick();
  env.press(5, true); expect(env.session.state.position).toBe(0);
  env.focus(false); env.tick(); expect(env.session.state.position).toBe(0);
  env.press(5, false); env.press(5, true); expect(env.session.state.position).toBe(2);
  service!.setContext({ blocked: false, assigning: true }); env.press(5, false); env.press(5, true); expect(env.session.state.position).toBe(2);
  service!.setContext({ blocked: false, assigning: false }); env.tick(); expect(env.session.state.position).toBe(2);
  env.preferences({ gamepadBackground: false }); env.press(5, false); env.press(5, true); expect(env.session.state.position).toBe(2);
});

it('stops and disarms native controls when the renderer reloads or the sampler fails', () => {
  const env = setup(); env.press(1, true); expect(env.session.scrolling).toBe(true);
  service!.invalidateContext(); expect(env.session.scrolling).toBe(false);
  env.tick(1000); expect(env.session.scrolling).toBe(false);
  service!.setContext({ blocked: false, assigning: false }); env.tick(); expect(env.session.scrolling).toBe(false);
  env.press(1, false); env.press(1, true); expect(env.session.scrolling).toBe(true);
  env.fail(); expect(env.session.scrolling).toBe(false); expect(service!.state.status).toBe('error'); expect(service!.state.fallback).toBe(false);
});

it('permits browser fallback only when native initialization was permanently unavailable', () => {
  service = new NativeControllerService({ sampler: null, unavailable: { status: 'error', message: 'Native DLL missing' }, getPreferences: () => defaultPreferences, dispatch: () => {}, isFocused: () => true });
  expect(service.state.fallback).toBe(true);
});

it('isolates open/read failures and retries the bad device with bounded backoff while healthy input stays fresh', () => {
  vi.useFakeTimers(); vi.setSystemTime(1000);
  const bad = { id: 17, name: 'Unavailable joystick' }, good = { id: 18, name: 'Healthy joystick' };
  let failedOpen = true, failedRead = false, pressed = false, attempts = 0, closedBad = 0;
  const bindings = {
    info: { initialized: { joystick: true } },
    joystick: { devices: [bad, good], openDevice: (device: typeof bad) => {
      if (device.id === bad.id) { attempts++; if (failedOpen) throw new Error('Device busy'); }
      let closed = false;
      return { get closed() { return closed; }, close() { closed = true; if (device.id === bad.id) closedBad++; }, get buttons() { if (device.id === bad.id && failedRead) throw new Error('Device removed during read'); return [pressed]; } };
    } },
    controller: { devices: [], openDevice: () => { throw new Error('Not mapped'); } },
  };
  const sampler = new SdlControllerSampler(bindings as unknown as ConstructorParameters<typeof SdlControllerSampler>[0]);
  expect(sampler.sample().map(pad => pad.index)).toEqual([18]); expect(attempts).toBe(1);
  pressed = true;
  for (let i = 0; i < 9; i++) { vi.advanceTimersByTime(25); expect(sampler.sample()[0].buttons[0].pressed).toBe(true); }
  expect(attempts).toBe(1);
  vi.advanceTimersByTime(25); sampler.sample(); expect(attempts).toBe(2);
  failedOpen = false; vi.advanceTimersByTime(500); expect(sampler.sample().map(pad => pad.index)).toEqual([17, 18]);
  failedRead = true; expect(sampler.sample().map(pad => pad.index)).toEqual([18]); expect(closedBad).toBe(1);
  failedRead = false; vi.advanceTimersByTime(250); expect(sampler.sample().map(pad => pad.index)).toEqual([17, 18]);
  // Persistent failures eventually retry every five seconds, never each poll.
  failedRead = true; sampler.sample();
  for (const delay of [250, 500, 1000, 2000, 4000]) { vi.advanceTimersByTime(delay); sampler.sample(); }
  const before = attempts; vi.advanceTimersByTime(4999); sampler.sample(); expect(attempts).toBe(before);
  vi.advanceTimersByTime(1); sampler.sample(); expect(attempts).toBe(before + 1);
  sampler.close();
});
