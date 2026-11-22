import { expect, it } from 'vitest';
import { defaultPreferences, preferencesSchema, commandSchema } from '../shared/model';
import { defaultShortcuts } from '../shared/shortcuts';

it('migrates old profiles without turning on command listening or changing language', () => {
  const old: any = { ...defaultPreferences, language: 'de' };
  for (const key of ['shortcuts', 'keyboardKeepVoiceActive', 'keyboardScrollSpeed', 'voiceCommandsEnabled', 'voiceCommandWakeWord']) delete old[key];
  const migrated = preferencesSchema.parse(old);
  expect(migrated).toMatchObject({ language: 'de', shortcuts: defaultShortcuts, keyboardKeepVoiceActive: true, keyboardScrollSpeed: 130, voiceCommandsEnabled: false, voiceCommandWakeWord: 'prompta' });
});
it('validates custom wake words, system recognition and chapter navigation', () => {
  expect(preferencesSchema.safeParse({ ...defaultPreferences, voiceCommandWakeWord: '   ' }).success).toBe(false);
  expect(preferencesSchema.safeParse({ ...defaultPreferences, provider: 'system' }).success).toBe(true);
  expect(commandSchema.parse({ type: 'navigate', unit: 'chapter', direction: 1, keepVoiceActive: true })).toMatchObject({ unit: 'chapter' });
});
