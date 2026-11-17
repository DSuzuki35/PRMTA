// Only a visual estimate: never used as the speech matcher's search position.
export class VoicePacing {
  private lastTick: number | undefined;
  private audioUntil = -Infinity;
  private matchedAt = -Infinity;
  private lead = 0;
  private confirmed: number | undefined;
  private voicedSeconds = 0;
  private anchor: { position: number; voiced: number; at: number } | undefined;
  private samples: { words: number; seconds: number; at: number }[] = [];
  get wordsPerSecond() {
    const seconds = this.samples.reduce((sum, s) => sum + s.seconds, 0);
    // A small prior prevents the first delayed recognition burst from setting the pace.
    return (4.4 + this.samples.reduce((sum, s) => sum + s.words, 0)) / (2 + seconds);
  }
  reset() {
    this.lastTick = undefined; this.audioUntil = this.matchedAt = -Infinity;
    this.lead = this.voicedSeconds = 0; this.confirmed = undefined; this.anchor = undefined; this.samples = [];
  }
  audio(active: boolean, now: number) {
    this.tick(now);
    this.audioUntil = active ? now + 350 : now;
  }
  tick(now: number) {
    const previous = this.lastTick ?? now;
    // Drop long discontinuities (suspended renderer, lost mic, delayed network).
    const seconds = now - previous <= 350 ? Math.max(0, Math.min(now, this.audioUntil) - previous) / 1000 : 0;
    this.lastTick = now; this.voicedSeconds += seconds;
    this.samples = this.samples.filter(s => now - s.at <= 120000);
    if (now - this.matchedAt > 2500) this.lead = 0;
    else this.lead = Math.min(2, this.lead + seconds * this.wordsPerSecond);
  }
  confirm(position: number, matched: boolean, now: number) {
    this.tick(now);
    // Consume predictions as recognition catches up. An unchanged result or a
    // mismatch is evidence against the guess and must be allowed to correct it.
    const progress = position - (this.confirmed ?? position);
    this.lead = matched && progress > 0 ? Math.max(0, this.lead - progress) : 0;
    this.confirmed = position;
    this.matchedAt = matched ? now : -Infinity;
    if (!matched) { this.anchor = undefined; return; }
    const anchor = this.anchor;
    if (anchor) {
      const seconds = this.voicedSeconds - anchor.voiced, words = position - anchor.position;
      if (now - anchor.at <= 10000 && seconds >= 1.5 && words >= 2) {
        const rate = words / seconds;
        if (rate >= .7 && rate <= 6) this.samples.push({ words, seconds, at: now });
      } else if (now - anchor.at <= 10000 && seconds < 1.5 && words >= 0) return;
    }
    this.anchor = { position, voiced: this.voicedSeconds, at: now };
  }
  preview(confirmed: number) { return Math.floor(confirmed) + Math.floor(this.lead); }
}

// RMS envelope gate, not word recognition: rejects single-frame clicks, learns a
// quiet noise floor and bridges tiny gaps between syllables. No extra audio copy.
export class VoiceActivityGate {
  private noise = .002;
  private onset: number | undefined;
  private lastLoud = -Infinity;
  private active = false;
  private floorWindow: { since: number; min: number; max: number } | undefined;
  sample(rms: number, now: number) {
    this.floorWindow ??= { since: now, min: rms, max: rms };
    const window = this.floorWindow;
    window.min = Math.min(window.min, rms); window.max = Math.max(window.max, rms);
    // A stable fan/room tone must not remain permanently above the gate. Only
    // raise the floor for low-variation windows; ordinary speech varies more.
    if (now - window.since >= 1000) {
      if (window.min > .008 && window.max < window.min * 1.6) this.noise = Math.max(this.noise, window.min * .8);
      this.floorWindow = { since: now, min: rms, max: rms };
    }
    const loud = rms > Math.max(.008, this.noise * 3);
    if (loud) {
      this.onset ??= now; this.lastLoud = now;
      if (now - this.onset >= 70) this.active = true;
    } else {
      this.onset = undefined;
      this.noise += (Math.min(rms, .25) - this.noise) * .04;
      if (now - this.lastLoud >= 140) this.active = false;
    }
    return this.active;
  }
}
