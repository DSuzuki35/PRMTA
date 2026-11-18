import type { Sdl } from '@kmamal/sdl';
import type { ControllerPad } from '../shared/controller';
import type { ControllerSampler } from './controller-service';

type Bindings = Pick<typeof import('@kmamal/sdl'), 'joystick' | 'controller' | 'info'>;
type OpenDevice = { joystick: Sdl.Joystick.JoystickInstance; controller?: Sdl.Controller.ControllerInstance };

export function standardButtons(buttons: Readonly<Record<string, boolean>>, axes: { leftTrigger: number; rightTrigger: number }): { pressed: boolean }[] {
  // W3C standard gamepad order preserves the existing shoulder defaults 4 / 5.
  return ['a', 'b', 'x', 'y', 'leftShoulder', 'rightShoulder', 'leftTrigger', 'rightTrigger', 'back', 'start', 'leftStick', 'rightStick', 'dpadUp', 'dpadDown', 'dpadLeft', 'dpadRight', 'guide', 'paddle1', 'paddle2', 'paddle3', 'paddle4']
    .map(key => ({ pressed: key === 'leftTrigger' ? axes.leftTrigger > .5 : key === 'rightTrigger' ? axes.rightTrigger > .5 : !!buttons[key] }));
}

export class SdlControllerSampler implements ControllerSampler {
  private opened = new Map<number, OpenDevice>();
  private retries = new Map<number, { delay: number; after: number }>();
  constructor(private sdl: Bindings) {
    if (!sdl.info.initialized.joystick) throw new Error('Windows joystick support could not be initialized.');
  }
  sample(): ControllerPad[] {
    // Reading these properties pumps SDL events, including hotplug and fresh
    // button values. No SDL window or renderer event loop is required.
    const devices = this.sdl.joystick.devices, controllers = this.sdl.controller.devices;
    const present = new Set(devices.map(device => device.id));
    for (const [id, opened] of this.opened) if (!present.has(id) || opened.joystick.closed) { this.closeDevice(opened); this.opened.delete(id); }
    for (const id of this.retries.keys()) if (!present.has(id)) this.retries.delete(id);
    const pads: ControllerPad[] = [];
    for (const device of devices) {
      const retry = this.retries.get(device.id);
      if (retry && Date.now() < retry.after) continue;
      try {
        let opened = this.opened.get(device.id);
        if (!opened) {
          const joystick = this.sdl.joystick.openDevice(device);
          opened = { joystick }; this.opened.set(device.id, opened);
          const mapped = controllers.find(controller => controller.id === device.id);
          if (mapped) opened.controller = this.sdl.controller.openDevice(mapped);
        }
        const buttons = opened.controller
          ? standardButtons(opened.controller.buttons, opened.controller.axes)
          : opened.joystick.buttons.slice(0, 128).map(pressed => ({ pressed }));
        // A removed instance may close while a property access pumps SDL events.
        if (opened.joystick.closed || opened.controller?.closed) continue;
        const name = device.name?.slice(0, 200) || 'Controller';
        pads.push({ index: device.id, id: `sdl:${device.id}:${name}`, name, mapping: opened.controller ? 'standard' : 'raw', buttons });
        this.retries.delete(device.id);
      } catch {
        const opened = this.opened.get(device.id);
        if (opened) this.closeDevice(opened);
        this.opened.delete(device.id);
        // One busy/broken driver must not suppress healthy controllers or be
        // hammered at the 25 ms polling rate. Reconnection clears this backoff.
        const delay = Math.min(5000, (retry?.delay ?? 125) * 2);
        this.retries.set(device.id, { delay, after: Date.now() + delay });
      }
    }
    return pads;
  }
  private closeDevice(opened: OpenDevice) {
    try { if (opened.controller && !opened.controller.closed) opened.controller.close(); } catch { /* Isolate failed device teardown as well. */ }
    try { if (!opened.joystick.closed) opened.joystick.close(); } catch { /* Other handles still need closing. */ }
  }
  close() { for (const device of this.opened.values()) this.closeDevice(device); this.opened.clear(); this.retries.clear(); }
}

export async function createSdlControllerSampler(): Promise<ControllerSampler> {
  // SDL's documented background-input hint must be set before native init.
  process.env.SDL_JOYSTICK_ALLOW_BACKGROUND_EVENTS = '1';
  const sdl = await import('@kmamal/sdl');
  return new SdlControllerSampler(sdl);
}
