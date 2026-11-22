import { afterEach, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { SystemSpeechProcess, SystemSpeechService, validateSystemSpeechWav, selectSystemSpeechLanguage } from '../electron/system-speech';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
function wav() {
  const data = Buffer.alloc(44 + 3200); data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(16000, 24); data.writeUInt32LE(32000, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(3200, 40); return data;
}
function worker(code: string, timeoutMs = 2000) {
  const child = spawn(process.execPath, ['-e', code], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const result = new SystemSpeechProcess(child, () => {}, { startupMs: timeoutMs, requestMs: timeoutMs });
  cleanup.push(() => result.close()); return result;
}
it('selects English predictably and never silently substitutes another requested language', () => {
  expect(selectSystemSpeechLanguage(['de-DE', 'en-GB', 'en-US'], 'auto')).toBe('en-US');
  expect(selectSystemSpeechLanguage(['en-GB'], 'en')).toBe('en-GB');
  expect(selectSystemSpeechLanguage(['en-US', 'de-DE'], 'de')).toBe('de-DE');
  expect(() => selectSystemSpeechLanguage(['de-DE'], 'auto')).toThrow(/English|en/i);
  expect(() => selectSystemSpeechLanguage(['en-US'], 'de')).toThrow(/German|de/i);
});
it('rejects malformed, mismatched and excessive PCM before sending it to the native worker', () => {
  expect(() => validateSystemSpeechWav(wav())).not.toThrow();
  for (const data of [Buffer.from('RIFF'), Buffer.alloc(900_000)]) expect(() => validateSystemSpeechWav(data)).toThrow();
  const stereo = wav(); stereo.writeUInt16LE(2, 22); expect(() => validateSystemSpeechWav(stereo)).toThrow(/mono/i);
  const rate = wav(); rate.writeUInt32LE(48000, 24); expect(() => validateSystemSpeechWav(rate)).toThrow(/16000/);
  const align = wav(); align.writeUInt16LE(4, 32); expect(() => validateSystemSpeechWav(align)).toThrow();
  const truncated = wav(); truncated.writeUInt32LE(9000, 40); expect(() => validateSystemSpeechWav(truncated)).toThrow();
});
it('reuses private pipes, correlates responses and rejects overlapping audio', async () => {
  const instance = worker(`console.log(JSON.stringify({type:'ready',languages:['en-US'],language:'en-US'})); require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);console.log(JSON.stringify({id:r.id+100,text:'wrong',ms:0}));setTimeout(()=>console.log(JSON.stringify({id:r.id,text:r.wav.startsWith('UklGR')?'local result':'bad wav',ms:12})),60);});`);
  expect((await instance.ready).languages).toEqual(['en-US']);
  const first = instance.transcribe(wav()); await expect(instance.transcribe(wav())).rejects.toThrow(/busy/i);
  expect(await first).toEqual({ text: 'local result', ms: 12 });
  expect(await instance.transcribe(wav())).toEqual({ text: 'local result', ms: 12 });
  const pending = instance.transcribe(wav()); const rejected = expect(pending).rejects.toThrow(/closed|stopped/i); await instance.close(); await rejected;
});
it('reports native initialization failures and malformed protocol immediately', async () => {
  await expect(worker(`console.log(JSON.stringify({type:'fatal',error:'No installed English recognizer'}));`).ready).rejects.toThrow(/English/);
  await expect(worker(`console.log('invalid json');`).ready).rejects.toThrow(/response|protocol/i);
});
it('times out stalled workers and settles requests when the process exits', async () => {
  await expect(worker(`setInterval(()=>{},1000);`, 100).ready).rejects.toThrow(/timed out/i);
  const instance = worker(`console.log(JSON.stringify({type:'ready',languages:['en-US'],language:'en-US'}));process.stdin.once('data',()=>process.exit(3));`);
  await instance.ready; await expect(instance.transcribe(wav())).rejects.toThrow(/stopped|exited/i);
});
it('expires stalled transcription requests and prevents reuse of the stalled process', async () => {
  const instance = worker(`console.log(JSON.stringify({type:'ready',languages:['en-US'],language:'en-US'}));process.stdin.resume();`, 150);
  await instance.ready; await expect(instance.transcribe(wav())).rejects.toThrow(/timed out/i);
  await expect(instance.transcribe(wav())).rejects.toThrow(/closed/i);
});
it('rejects invalid transcription responses instead of exposing them as recognized commands', async () => {
  const instance = worker(`console.log(JSON.stringify({type:'ready',languages:['en-US'],language:'en-US'}));process.stdin.once('data',data=>console.log(JSON.stringify({id:JSON.parse(data).id,text:'start',ms:-1})));`);
  await instance.ready; await expect(instance.transcribe(wav())).rejects.toThrow(/response/i);
});
it('reports missing native helpers without starting recognition or requesting permission', async () => {
  const service = new SystemSpeechService('missing-system-speech-resources'); cleanup.push(() => service.close());
  expect((await service.status()).phase).toBe('unavailable');
  await expect(service.ensure('en')).rejects.toThrow(/helper|unavailable|supported/i);
  await service.close(); await expect(service.ensure('en')).rejects.toThrow(/closed/i);
});
it.skipIf(process.platform !== 'win32')('inventories the real Windows recognizers without starting recognition', async () => {
  const service = new SystemSpeechService('scripts'); cleanup.push(() => service.close());
  const status = await service.status();
  expect(status.phase).toBe(status.languages.length ? 'available' : 'unavailable');
  expect(status.languages.every(language => /^[a-z]{2,3}-/i.test(language))).toBe(true);
  expect(status.error).toBeNull();
  await service.close(); expect((await service.status()).message).toMatch(/closed/i);
});
