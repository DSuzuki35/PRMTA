import { gamepadActions, type GamepadActionKey, type Preferences } from './model';
type Pad = { index: number; id: string; buttons: readonly { pressed: boolean }[] };
export type CapturedButton = { button: number; controller: string };
/** A binding is accepted only after this capture observes 0 -> 1 -> 0. */
export class ButtonCapture {
  private previous = new Map<string, boolean>();
  private candidate: { key: string; binding: CapturedButton } | null = null;
  get awaitingRelease() { return this.candidate !== null; }
  sample(pads: readonly (Pad | null)[]): CapturedButton | null {
    const current = new Map<string, boolean>();
    const bindings = new Map<string, CapturedButton>();
    for (const pad of pads) if (pad) pad.buttons.slice(0, 32).forEach((button, index) => {
      const key = `${pad.index}:${pad.id}:${index}`; current.set(key, button.pressed); bindings.set(key, { button: index, controller: pad.id });
    });
    let result: CapturedButton | null = null;
    if (this.candidate) {
      if (!current.has(this.candidate.key)) this.candidate = null;
      else if (!current.get(this.candidate.key)) { result = this.candidate.binding; this.candidate = null; }
    } else {
      for (const [key, down] of current) if (down && this.previous.get(key) === false) { this.candidate = { key, binding: bindings.get(key)! }; break; }
    }
    this.previous = current;
    return result;
  }
}

/** Freshly connected, resumed, or already-held controls must release before use. */
export class GamepadInput {
  private previous = new Map<string, boolean>();
  private held = new Set<string>();
  sample(pads: readonly (Pad | null)[], preferences: Preferences): { actions: GamepadActionKey[]; scroll: -1 | 0 | 1 } {
    const current = new Map<string, boolean>(), held = new Set<string>();
    const actions = new Set<GamepadActionKey>(); let up = false, down = false;
    for (const pad of pads) if (pad) for (const action of gamepadActions) {
      const button = preferences[action.key]; if (button === null) continue;
      const key = `${pad.index}:${pad.id}:${button}`, pressed = pad.buttons[button]?.pressed ?? false;
      current.set(key, pressed);
      const edge = pressed && this.previous.get(key) === false;
      if (pressed && (edge || this.held.has(key))) {
        held.add(key);
        if (action.unit === 'scroll') { if (action.direction < 0) up = true; else down = true; }
        else if (edge) actions.add(action.key);
      }
    }
    this.previous = current; this.held = held;
    const navigation = gamepadActions.filter(action => actions.has(action.key));
    const opposing = navigation.some(action => action.direction < 0) && navigation.some(action => action.direction > 0);
    return { actions: opposing ? [] : navigation.slice(0, 1).map(action => action.key), scroll: navigation.length || up === down ? 0 : up ? -1 : 1 };
  }
}
