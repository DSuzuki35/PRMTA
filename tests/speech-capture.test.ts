import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultPreferences } from '../shared/model';
import { startSpeech } from '../src/speech';
import { api } from '../src/api';

vi.mock('../src/api', () => ({ api: vi.fn() }));

describe('local speech command audio capture', () => {
  let process: ((event: { inputBuffer: { getChannelData: () => Float32Array } }) => void) | undefined;
  let stop: (() => void) | undefined;
  const requests: Blob[] = [];
  let respond: () => Promise<{ text: string }>;
  let contextKey: string;
  let followKey: string | null;
  const actions: string[] = [];
  const transcripts: string[] = [];
  const node = () => ({ connect() {}, disconnect() {} });

  beforeEach(async () => {
    vi.useFakeTimers(); vi.setSystemTime(10000);
    requests.length = 0; actions.length = 0; transcripts.length = 0; contextKey = 'initial'; followKey = null;
    respond = async () => ({ text: 'prompta next sentence' });
    vi.mocked(api).mockImplementation(async (path, _body, audio) => {
      if (path.startsWith('/speech?')) { requests.push(audio as Blob); return respond(); }
      return path === '/speech/models' ? { managed: false } : { ok: true };
    });
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [], getAudioTracks: () => [] }) } });
    vi.stubGlobal('AudioContext', class {
      sampleRate = 16000; destination = {}; state = 'running'; onstatechange = null;
      async resume() {} async close() {}
      createMediaStreamSource() { return node(); }
      createGain() { return { ...node(), gain: { value: 0 } }; }
      createScriptProcessor() { return { ...node(), set onaudioprocess(callback: typeof process) { process = callback; } }; }
    });
    stop = await startSpeech(defaultPreferences, text => transcripts.push(text), () => {}, () => {}, () => followKey, () => {}, {
      enabled: () => true, wakeWord: () => 'prompta', context: () => contextKey, onCommand: action => actions.push(action),
    });
  });
  afterEach(() => { stop?.(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
  const feed = async (values: number[]) => {
    for (const amplitude of values) {
      process!({ inputBuffer: { getChannelData: () => new Float32Array(1600).fill(amplitude) } });
      await vi.advanceTimersByTimeAsync(100);
    }
  };
  const voice = [.09, .2, .12, .25, .1, .22, .14, .24, .11, .23, .13, .21];

  it('preserves the wake word audio preceding the VAD onset', async () => {
    await feed([0, 0, 0, 0, ...voice, ...Array(10).fill(0)]);
    expect(requests.length).toBeGreaterThan(0);
    const buffers = await Promise.all(requests.map(blob => blob.arrayBuffer()));
    const samples = buffers.flatMap(buffer => Array.from(new Int16Array(buffer.slice(44))));
    // Only the very first voiced frame has this level; dropping it removes the
    // first sound of the wake phrase before the onset is confirmed at 100 ms.
    expect(samples.some(value => Math.abs(value - 2949) <= 1)).toBe(true);
  });

  it('queues one final audio snapshot while a slow interim recognition request is in flight', async () => {
    let release!: (value: { text: string }) => void;
    const slow = new Promise<{ text: string }>(resolve => { release = resolve; });
    respond = () => requests.length === 1 ? slow : Promise.resolve({ text: 'prompta next sentence' });
    await feed([0, 0, 0, 0, ...voice, ...Array(45).fill(0)]);
    expect(requests).toHaveLength(1); expect(actions).toEqual([]);
    release({ text: 'prompta next' });
    await vi.advanceTimersByTimeAsync(600);
    expect(requests).toHaveLength(2);
    expect(actions).toEqual(['nextSentence']);
    const final = new Int16Array((await requests[1].arrayBuffer()).slice(44));
    expect(final.some(sample => sample > 1000)).toBe(true);
    await feed(Array(40).fill(0));
    expect(requests).toHaveLength(2);
  });

  it('drops a queued final snapshot after a manual transport change', async () => {
    let release!: (value: { text: string }) => void;
    respond = () => new Promise(resolve => { release = resolve; });
    await feed([0, 0, 0, 0, ...voice, ...Array(20).fill(0)]);
    expect(requests).toHaveLength(1);
    contextKey = 'manual-navigation'; await feed([0]);
    release({ text: 'prompta reset' }); await vi.advanceTimersByTimeAsync(1000);
    expect(actions).toEqual([]); expect(requests).toHaveLength(1);
  });

  it('keeps only the latest utterance snapshot when new speech supersedes a slow request', async () => {
    let release!: (value: { text: string }) => void;
    const slow = new Promise<{ text: string }>(resolve => { release = resolve; });
    respond = () => requests.length === 1 ? slow : Promise.resolve({ text: 'prompta previous sentence' });
    await feed([0, 0, 0, 0, ...voice, ...Array(10).fill(0), ...voice.map(value => -value), ...Array(10).fill(0)]);
    expect(requests).toHaveLength(1);
    release({ text: 'prompta reset' }); await vi.advanceTimersByTimeAsync(600);
    expect(actions).toEqual(['previousSentence']); expect(requests).toHaveLength(2);
    const final = new Int16Array((await requests[1].arrayBuffer()).slice(44));
    expect(final.some(sample => sample < -1000)).toBe(true);
    expect(final.some(sample => sample > 1000)).toBe(false);
  });

  it('delivers late narration from the preceding utterance when the transport has not changed', async () => {
    followKey = 'following';
    let release!: (value: { text: string }) => void;
    const slow = new Promise<{ text: string }>(resolve => { release = resolve; });
    respond = () => requests.length === 1 ? slow : Promise.resolve({ text: '' });
    await feed([0, 0, 0, 0, ...voice, ...Array(8).fill(0), ...voice.slice(0, 4)]);
    release({ text: 'The first sentence still belongs to this take.' });
    await vi.advanceTimersByTimeAsync(100);
    expect(transcripts).toEqual(['The first sentence still belongs to this take.']);
    expect(actions).toEqual([]);
  });

  it.each(['prompta next sentence', 'The first sentence belongs to the old take'])('drops late text after navigation: %s', async text => {
    followKey = 'following';
    let release!: (value: { text: string }) => void;
    respond = () => new Promise(resolve => { release = resolve; });
    await feed([0, 0, 0, 0, ...voice, ...Array(8).fill(0), ...voice.slice(0, 4)]);
    contextKey = 'after-seek'; followKey = 'after-seek'; await feed([0]);
    release({ text }); await vi.advanceTimersByTimeAsync(100);
    expect(transcripts).toEqual([]); expect(actions).toEqual([]);
  });

  it('does not let a late old command suppress narration in the new utterance', async () => {
    followKey = 'following';
    let release!: (value: { text: string }) => void;
    const slow = new Promise<{ text: string }>(resolve => { release = resolve; });
    respond = () => requests.length === 1 ? slow : Promise.resolve({ text: 'Fresh narration continues here' });
    await feed([0, 0, 0, 0, ...voice, ...Array(8).fill(0), ...voice]);
    release({ text: 'prompta next sentence' }); await vi.advanceTimersByTimeAsync(600);
    expect(transcripts).toContain('Fresh narration continues here');
    expect(transcripts).not.toContain('prompta next sentence'); expect(actions).toEqual([]);
  });

  it('suppresses late wake-less fragments from a previously addressed command utterance', async () => {
    followKey = 'following';
    let release!: (value: { text: string }) => void;
    const slow = new Promise<{ text: string }>(resolve => { release = resolve; });
    respond = () => requests.length === 1 ? Promise.resolve({ text: 'prompta next' }) : requests.length === 2 ? slow : Promise.resolve({ text: 'Fresh narration resumes' });
    await feed([0, 0, 0, 0, ...voice, ...Array(8).fill(0), ...voice]);
    release({ text: 'next sentence' }); await vi.advanceTimersByTimeAsync(600);
    expect(transcripts).not.toContain('next sentence');
    expect(transcripts).toContain('Fresh narration resumes'); expect(actions).toEqual([]);
  });
});
