import { expect, it } from 'vitest';
import { assertSpeechFixture } from './helpers/speech-fixture';

it('rejects successful responses that contain no recognized speech or unrelated speech', () => {
  for (const text of ['', '  ', 'hello world this is unrelated', 'country']) {
    expect(() => assertSpeechFixture({ ok: true, text, ms: 10 })).toThrow();
  }
});
it('accepts useful JFK fixture recognition with punctuation and minor word errors', () => {
  expect(assertSpeechFixture({ ok: true, text: 'Ask what you can do for your country.', ms: 12 })).toEqual({ ms: 12, words: 8, characters: 37 });
  for (const result of [{ ok: false, text: 'ask your country', ms: 1 }, { ok: true, text: 'ask your country', ms: -1 }]) expect(() => assertSpeechFixture(result)).toThrow();
});
