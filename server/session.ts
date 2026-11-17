import type { Command, SessionState } from '../shared/model';
import { tokenize, normalize, type Word } from '../shared/text';
import { alignTranscript } from '../shared/matcher';
import { VoicePacing } from '../shared/voice-pacing';
export class Session {
  state: SessionState = { script: null, position: 0, playing: false, mode: 'timed', speed: 120, blackout: false, loop: false, countdownUntil: 0, elapsed: 0, updatedAt: 0, transportRevision: 0, speech: { transcript: '', confidence: 0, status: 'Ready' } };
  private lastTick = 0;
  private lastTranscript = '';
  private pacing = new VoicePacing();
  private count = 0;
  private tokens: { content: string; words: Word[] } | null = null;
  // Tokens are cached per loaded content; the content comparison guards against state.script being replaced externally.
  private words(content: string): Word[] {
    if (!this.tokens || this.tokens.content !== content) this.tokens = { content, words: tokenize(content) };
    return this.tokens.words;
  }
  load(script: {id: string; title: string; content: string}) {
    this.state.script = { id: script.id, title: script.title, content: script.content };
    this.count = this.words(script.content).length;
    this.command({ type: 'reset' });
  }
  command(command: Command, now = Date.now()) {
    if (command.type !== 'transcript') this.tick(now);
    if (['reset', 'seek', 'mode'].includes(command.type)) this.state.transportRevision++;
    if (['reset', 'seek', 'mode', 'pause'].includes(command.type) || (command.type === 'play' && !this.state.playing)) this.pacing.reset();
    switch (command.type) {
      case 'play':
        if (!this.count || this.state.playing) break;
        if (this.state.position >= this.count) this.state.position = 0;
        this.state.playing = true; this.state.countdownUntil = now + (command.countdown ?? 0) * 1000; this.lastTick = now; break;
      case 'pause': this.state.playing = false; this.state.countdownUntil = 0; break;
      case 'toggle': this.command({ type: this.state.playing ? 'pause' : 'play' }, now); break;
      case 'reset': this.state.position = 0; this.state.elapsed = 0; this.state.playing = false; this.state.countdownUntil = 0; this.lastTranscript = ''; this.state.speech = { transcript: '', confidence: 0, status: 'Ready' }; break;
      case 'seek': this.state.position = Math.max(0, Math.min(Math.max(0, this.count - 1), command.position)); this.lastTranscript = ''; break;
      case 'step': this.command({ type: 'seek', position: this.state.position + command.words }, now); break;
      case 'blackout': this.state.blackout = !this.state.blackout; break;
      case 'speed': this.state.speed = command.speed; break;
      case 'mode': this.state.mode = command.mode; this.lastTranscript = ''; break;
      case 'loop': this.state.loop = command.loop; break;
      case 'voiceActivity':
        if (command.transportRevision === this.state.transportRevision && this.state.playing && this.state.mode === 'voice' && now >= this.state.countdownUntil) this.pacing.audio(command.active, now);
        break;
      case 'transcript': {
        if ((command.transportRevision !== undefined && command.transportRevision !== this.state.transportRevision) || !this.state.playing || this.state.mode !== 'voice' || now < this.state.countdownUntil || !this.state.script) break;
        const normalized = normalize(command.text);
        if (normalized === this.lastTranscript) break;
        this.lastTranscript = normalized;
        const match = alignTranscript(this.words(this.state.script.content), command.text, this.state.position);
        this.state.speech = { transcript: command.text, confidence: match.confidence, status: match.matched ? 'Following your voice' : 'Waiting for script match' };
        if (match.matched) this.state.position = match.position;
        this.pacing.confirm(this.state.position, match.matched, now);
        this.finish(); break;
      }
    }
    this.updateHighlight(); this.state.updatedAt = now;
  }
  private updateHighlight() {
    this.state.voiceHighlight = this.state.playing && this.state.mode === 'voice'
      ? Math.min(Math.max(0, this.count - 1), this.pacing.preview(this.state.position)) : this.state.position;
  }
  private finish() {
    if (this.state.position < this.count) return;
    if (this.state.loop && this.count) { this.state.position %= this.count; this.lastTranscript = ''; this.pacing.reset(); }
    else { this.state.position = this.count; this.state.playing = false; }
  }
  tick(now = Date.now()) {
    this.pacing.tick(now);
    if (this.state.playing) {
      const from = Math.max(this.lastTick, this.state.countdownUntil);
      const seconds = Math.max(0, now - from) / 1000;
      this.state.elapsed += seconds;
      if (this.state.mode === 'timed') this.state.position += seconds * this.state.speed / 60;
      this.finish();
    }
    this.updateHighlight(); this.lastTick = now; this.state.updatedAt = now;
  }
  snapshot() { return structuredClone(this.state); }
}
