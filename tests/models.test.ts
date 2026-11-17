import { expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { downloadVerified } from '../electron/models';
import { modelById } from '../shared/whisper-models';

it('publishes a model only after checking its exact size and SHA-256', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'prmta-model-test-'));
  const data = Buffer.from('verified fixture');
  const hash = createHash('sha256').update(data).digest('hex');
  try {
    const target = join(dir, 'model.bin');
    const fetcher = async () => new Response(data);
    await expect(downloadVerified('https://example.test/model', target, data.length, '0'.repeat(64), () => {}, fetcher)).rejects.toThrow('checksum');
    expect(await readdir(dir)).toEqual([]);
    await expect(downloadVerified('https://example.test/model', target, data.length - 1, hash, () => {}, fetcher)).rejects.toThrow('size');
    expect(await readdir(dir)).toEqual([]);
    await downloadVerified('https://example.test/model', target, data.length, hash, () => {}, fetcher);
    expect(await readFile(target)).toEqual(data);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
it('rejects unlisted model identifiers and paths', () => {
  expect(() => modelById('../base')).toThrow('Unknown model');
  expect(() => modelById('C:\\secret.bin')).toThrow('Unknown model');
  expect(modelById('base').file).toBe('ggml-base.bin');
});
