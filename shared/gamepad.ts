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
