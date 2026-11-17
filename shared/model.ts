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
export type Script = Revision & { heads: string[]; conflict: boolean };

export const appearanceSchema = z.object({
  fontSize: z.number().min(24).max(160), lineHeight: z.number().min(1.1).max(2.5),
  width: z.number().min(25).max(100), guide: z.number().min(15).max(70),
  mirrorX: z.boolean(), mirrorY: z.boolean(), highlight: z.boolean(),
  dimRead: z.boolean(), transparent: z.boolean(),
  font: z.enum(['sans', 'serif', 'mono']), align: z.enum(['left', 'center']),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/), background: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  flow: z.enum(['scroll', 'page']).default('scroll'),
});
export type Appearance = z.infer<typeof appearanceSchema>;
export const defaultAppearance: Appearance = {
  fontSize: 56, lineHeight: 1.6, width: 78, guide: 35, mirrorX: false, mirrorY: false,
  highlight: true, dimRead: true, transparent: false, font: 'sans', align: 'left',
  color: '#f2f1eb', background: '#101113',
  flow: 'scroll',
};
export const preferencesSchema = z.object({
  profiles: z.object({ studio: appearanceSchema, display: appearanceSchema, vr: appearanceSchema }),
  cloudFolder: z.string().max(2000), whisperUrl: z.string().max(2000),
  whisperModel: z.enum(['tiny', 'base', 'small-q5', 'small', 'turbo-q5']).default('base'),
  language: z.enum(['de', 'en', 'auto']), provider: z.enum(['whisper', 'browser']),
  microphoneId: z.string().max(500), countdown: z.number().int().min(0).max(15),
  loop: z.boolean(), speed: z.number().min(20).max(400),
  gamepadEnabled: z.boolean().default(false), previousButton: z.number().int().min(0).max(31).default(4), nextButton: z.number().int().min(0).max(31).default(5),
});
export type Preferences = z.infer<typeof preferencesSchema>;
export type Profile = keyof Preferences['profiles'];
export const defaultPreferences: Preferences = {
  profiles: { studio: { ...defaultAppearance, fontSize: 42 }, display: { ...defaultAppearance },
    vr: { ...defaultAppearance, fontSize: 48, transparent: true, width: 90 } },
  cloudFolder: '', whisperUrl: 'http://127.0.0.1:8080', language: 'de', provider: 'whisper',
  whisperModel: 'base',
  microphoneId: '', countdown: 3, loop: false, speed: 130,
  gamepadEnabled: false, previousButton: 4, nextButton: 5,
};
export type SessionState = {
  script: { id: string; title: string; content: string } | null;
  position: number; playing: boolean; mode: 'manual' | 'timed' | 'voice'; speed: number;
  blackout: boolean; loop: boolean; countdownUntil: number; elapsed: number;
  updatedAt: number; speech: { transcript: string; confidence: number; status: string };
};
export const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('play'), countdown: z.number().min(0).max(15).optional() }),
  z.object({ type: z.literal('pause') }), z.object({ type: z.literal('toggle') }),
  z.object({ type: z.literal('reset') }), z.object({ type: z.literal('blackout') }),
  z.object({ type: z.literal('seek'), position: z.number().finite() }),
  z.object({ type: z.literal('step'), words: z.number().min(-1000).max(1000) }),
  z.object({ type: z.literal('speed'), speed: z.number().min(20).max(400) }),
  z.object({ type: z.literal('mode'), mode: z.enum(['manual', 'timed', 'voice']) }),
  z.object({ type: z.literal('loop'), loop: z.boolean() }),
  z.object({ type: z.literal('transcript'), text: z.string().max(2000) }),
]);
export type Command = z.infer<typeof commandSchema>;
