import { z } from 'zod';

export const draftSchema = z.object({
  id: z.string().uuid(), title: z.string().trim().min(1).max(200),
  content: z.string().max(500000), folder: z.string().max(100).default(''),
  tags: z.array(z.string().max(40)).max(30).default([]),
  favorite: z.boolean().default(false), deleted: z.boolean().default(false),
  notes: z.string().max(20000).default(''),
});
export const revisionSchema = draftSchema.extend({
  revision: z.string().uuid(), parents: z.array(z.string().uuid()).max(100),
  updatedAt: z.string().datetime(),
});
export type Draft = z.infer<typeof draftSchema>;
export type Revision = z.infer<typeof revisionSchema>;
export type Script = Revision & { heads: string[]; conflict: boolean; workspace?: string; storage?: 'local' | 'cloud' };

export const appearanceSchema = z.object({
  fontSize: z.number().min(24).max(160), lineHeight: z.number().min(1.1).max(2.5),
  width: z.number().min(25).max(100), guide: z.number().min(15).max(70),
  mirrorX: z.boolean(), mirrorY: z.boolean(), highlight: z.boolean(),
  dimRead: z.boolean(), transparent: z.boolean(), backgroundOpacity: z.number().min(0).max(100).default(100),
  smoothScroll: z.boolean().default(true),
  smoothVoice: z.boolean().default(true),
  previewNextLine: z.boolean().default(false),
  font: z.enum(['sans', 'serif', 'mono']), align: z.enum(['left', 'center']),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/), background: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  flow: z.enum(['scroll', 'page']).default('scroll'),
});
export type Appearance = z.infer<typeof appearanceSchema>;
export const defaultAppearance: Appearance = {
  fontSize: 56, lineHeight: 1.6, width: 78, guide: 35, mirrorX: false, mirrorY: false,
  highlight: true, dimRead: true, transparent: false, backgroundOpacity: 100, smoothScroll: true, previewNextLine: false, font: 'sans', align: 'left',
  color: '#f2f1eb', background: '#101113',
  flow: 'scroll', smoothVoice: true,
};
const buttonSchema = z.number().int().min(0).max(127).nullable();
export const gamepadActions = [
  { key: 'previousButton', label: 'Previous page', unit: 'page', direction: -1 },
  { key: 'nextButton', label: 'Next page', unit: 'page', direction: 1 },
  { key: 'previousParagraphButton', label: 'Previous paragraph', unit: 'paragraph', direction: -1 },
  { key: 'nextParagraphButton', label: 'Next paragraph', unit: 'paragraph', direction: 1 },
  { key: 'previousSentenceButton', label: 'Previous sentence', unit: 'sentence', direction: -1 },
  { key: 'nextSentenceButton', label: 'Next sentence', unit: 'sentence', direction: 1 },
  { key: 'scrollUpButton', label: 'Scroll up (hold)', unit: 'scroll', direction: -1 },
  { key: 'scrollDownButton', label: 'Scroll down (hold)', unit: 'scroll', direction: 1 },
] as const;
export type GamepadActionKey = typeof gamepadActions[number]['key'];
export const preferencesSchema = z.object({
  profiles: z.object({ studio: appearanceSchema, display: appearanceSchema, vr: appearanceSchema }),
  cloudFolder: z.string().max(2000), whisperUrl: z.string().max(2000),
  voiceLatency: z.enum(['responsive', 'steady']).default('responsive'),
  whisperModel: z.enum(['tiny', 'base', 'small-q5', 'small', 'turbo-q5']).default('base'),
  language: z.enum(['de', 'en', 'auto']), provider: z.enum(['whisper', 'browser', 'parakeet']),
  parakeetAcceleration: z.enum(['cpu', 'directml']).default('cpu'),
  microphoneId: z.string().max(500), countdown: z.number().int().min(0).max(15),
  loop: z.boolean(), speed: z.number().min(20).max(400),
  gamepadEnabled: z.boolean().default(false), previousButton: buttonSchema.default(4), nextButton: buttonSchema.default(5),
  previousParagraphButton: buttonSchema.default(null), nextParagraphButton: buttonSchema.default(null),
  previousSentenceButton: buttonSchema.default(null), nextSentenceButton: buttonSchema.default(null),
  scrollUpButton: buttonSchema.default(null), scrollDownButton: buttonSchema.default(null),
  gamepadScrollSpeed: z.number().min(20).max(400).default(130),
  gamepadKeepVoiceActive: z.boolean().default(true), gamepadBackground: z.boolean().default(true),
}).superRefine((preferences, context) => {
  const assigned = new Set<number>();
  for (const { key } of gamepadActions) {
    const button = preferences[key]; if (button === null) continue;
    if (assigned.has(button)) context.addIssue({ code: 'custom', path: [key], message: 'Each controller button can have only one action.' });
    assigned.add(button);
  }
});
export type Preferences = z.infer<typeof preferencesSchema>;
export type Profile = keyof Preferences['profiles'];
export const defaultPreferences: Preferences = {
  profiles: { studio: { ...defaultAppearance, fontSize: 42 }, display: { ...defaultAppearance },
    vr: { ...defaultAppearance, fontSize: 48, transparent: true, width: 90 } },
  cloudFolder: '', whisperUrl: 'http://127.0.0.1:8080', language: 'en', provider: 'whisper', parakeetAcceleration: 'cpu',
  whisperModel: 'base', voiceLatency: 'responsive',
  microphoneId: '', countdown: 3, loop: false, speed: 130,
  gamepadEnabled: false, previousButton: 4, nextButton: 5,
  previousParagraphButton: null, nextParagraphButton: null, previousSentenceButton: null, nextSentenceButton: null,
  scrollUpButton: null, scrollDownButton: null, gamepadScrollSpeed: 130,
  gamepadKeepVoiceActive: true, gamepadBackground: true,
};
export type SessionState = {
  script: { id: string; title: string; content: string } | null;
  position: number; playing: boolean; mode: 'manual' | 'timed' | 'voice'; speed: number;
  voiceHighlight?: number;
  manualScroll?: boolean;
  manualScrollActive?: boolean;
  blackout: boolean; loop: boolean; countdownUntil: number; elapsed: number;
  updatedAt: number; transportRevision: number; speech: { transcript: string; confidence: number; status: string };
};
export const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('play'), countdown: z.number().min(0).max(15).optional() }),
  z.object({ type: z.literal('pause') }), z.object({ type: z.literal('toggle') }),
  z.object({ type: z.literal('reset') }), z.object({ type: z.literal('blackout') }),
  z.object({ type: z.literal('seek'), position: z.number().finite() }),
  z.object({ type: z.literal('step'), words: z.number().min(-1000).max(1000) }),
  z.object({ type: z.literal('navigate'), unit: z.enum(['page', 'paragraph', 'sentence']), direction: z.union([z.literal(-1), z.literal(1)]), keepVoiceActive: z.boolean().optional() }),
  z.object({ type: z.literal('scroll'), direction: z.union([z.literal(-1), z.literal(0), z.literal(1)]), speed: z.number().min(20).max(400), source: z.string().uuid(), sequence: z.number().int().nonnegative(), keepVoiceActive: z.boolean().optional() }),
  z.object({ type: z.literal('speed'), speed: z.number().min(20).max(400) }),
  z.object({ type: z.literal('mode'), mode: z.enum(['manual', 'timed', 'voice']) }),
  z.object({ type: z.literal('loop'), loop: z.boolean() }),
  z.object({ type: z.literal('transcript'), text: z.string().max(2000), transportRevision: z.number().int().nonnegative().optional() }),
  z.object({ type: z.literal('voiceActivity'), active: z.boolean(), transportRevision: z.number().int().nonnegative() }),
]);
export type Command = z.infer<typeof commandSchema>;
