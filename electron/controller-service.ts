import { randomUUID } from 'node:crypto';
import { GamepadInput } from '../shared/gamepad';
import { gamepadActions, type Command, type Preferences } from '../shared/model';
import type { ControllerContext, ControllerPad, ControllerState } from '../shared/controller';

export interface ControllerSampler { sample(): ControllerPad[]; close(): void }
type Options = {
  sampler: ControllerSampler | null;
  getPreferences(): Preferences;
  dispatch(command: Command): void;
  isFocused(): boolean;
  canControl?(): boolean;
  unavailable?: Pick<ControllerState, 'status' | 'message'>;
};

/** Runs in Electron's main process; the renderer never supplies held-scroll heartbeats. */
export class NativeControllerService {
  private snapshot: ControllerState;
  private context: ControllerContext | null = null;
  private input = new GamepadInput();
  private timer: ReturnType<typeof setInterval> | undefined;
  private source = randomUUID();
  private sequence = 0;
  private direction: -1 | 0 | 1 = 0;
  private lastHeartbeat = 0;
  private signature = '';
  private active = false;
  private closed = false;
  constructor(private options: Options) {
    this.snapshot = { status: options.sampler ? 'ready' : options.unavailable?.status ?? 'unsupported', backend: 'sdl', message: options.unavailable?.message ?? 'Native controller input ready.', pads: [], fallback: options.sampler === null };
    if (options.sampler) { this.poll(); this.timer = setInterval(() => this.poll(), 25); this.timer.unref(); }
  }
  get state(): ControllerState { return structuredClone(this.snapshot); }
  setContext(context: ControllerContext) {
    this.context = { ...context };
    // Stop before resolving IPC, so assignment cannot race a live controller action.
    if (context.assigning || (context.blocked && this.options.isFocused())) this.disarm();
  }
  invalidateContext() { this.context = null; this.disarm(); }
  private emitScroll(direction: -1 | 0 | 1, preferences: Preferences, now: number) {
    this.options.dispatch({ type: 'scroll', direction, speed: preferences.gamepadScrollSpeed, keepVoiceActive: preferences.gamepadKeepVoiceActive, source: this.source, sequence: ++this.sequence });
    this.direction = direction; this.lastHeartbeat = now;
  }
  private disarm() {
    if (this.direction) {
      // Shutdown/update gates may already reject transport commands. The server
      // heartbeat lease remains the fallback if its stop cannot be delivered.
      try { this.emitScroll(0, this.options.getPreferences(), Date.now()); } catch { /* Lease expires after 600 ms. */ }
    }
    this.direction = 0; this.active = false; this.input = new GamepadInput();
  }
  private poll() {
    if (this.closed || !this.options.sampler) return;
    try {
      const pads = this.options.sampler.sample();
      this.snapshot = { status: 'ready', backend: 'sdl', message: 'Native controller input ready.', pads, fallback: false };
      const preferences = this.options.getPreferences(), focused = this.options.isFocused();
      const enabled = preferences.gamepadEnabled && this.context !== null && !this.context.assigning && !(focused && this.context.blocked)
        && (preferences.gamepadBackground || focused) && (this.options.canControl?.() ?? true);
      const signature = JSON.stringify([preferences.gamepadScrollSpeed, preferences.gamepadKeepVoiceActive, ...gamepadActions.map(action => preferences[action.key])]);
      if (!enabled) { this.disarm(); return; }
      if (!this.active || signature !== this.signature) { this.disarm(); this.active = true; this.signature = signature; }
      const sampled = this.input.sample(pads, preferences), now = Date.now();
      const action = gamepadActions.find(action => action.key === sampled.actions[0]);
      if (action && action.unit !== 'scroll') {
        if (this.direction) this.emitScroll(0, preferences, now);
        this.options.dispatch({ type: 'navigate', unit: action.unit, direction: action.direction, keepVoiceActive: preferences.gamepadKeepVoiceActive });
        this.input = new GamepadInput();
      }
      const next = action ? 0 : sampled.scroll;
      if (next !== this.direction || (next && now - this.lastHeartbeat >= 200)) this.emitScroll(next, preferences, now);
    } catch (error) {
      this.disarm(); this.snapshot = { status: 'error', backend: 'sdl', message: `Native controller input is unavailable: ${String(error).replace(/^Error: /, '')}`, pads: [], fallback: false };
    }
  }
  close() {
    if (this.closed) return;
    this.closed = true; clearInterval(this.timer); this.disarm(); this.options.sampler?.close();
  }
}
