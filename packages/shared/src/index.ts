import { z } from 'zod';

// ─── Layout ───
export const ModuleStateSchema = z.enum(['normal', 'minimized', 'maximized']);
export type ModuleState = z.infer<typeof ModuleStateSchema>;

export const ModuleConfigSchema = z.object({
  id: z.string(),
  state: ModuleStateSchema,
  order: z.number(),
  hidden: z.boolean().default(false),
});

export const UserLayoutSchema = z.object({
  modules: z.array(ModuleConfigSchema),
});
export type UserLayout = z.infer<typeof UserLayoutSchema>;

// ─── UI Preferences ───
export const UIPreferenceSchema = z.object({
  kaller_meg: z.string().default('Goberg'),
  tone: z.enum(['nøytral', 'varm', 'formell']).default('nøytral'),
  språk: z.string().default('nb-NO'),
  bekreft_før_handling: z.boolean().default(true),
});
export type UIPreference = z.infer<typeof UIPreferenceSchema>;

// ─── Chat ───
export const ChatRequestSchema = z.object({
  message: z.string().min(1),
  conversationId: z.string().uuid().optional(),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

// ─── API Responses ───
export interface ApiError {
  error: string;
  code?: string;
  details?: unknown;
}

// ─── Default layout for new users ───
export const DEFAULT_DESKTOP_LAYOUT: UserLayout = {
  modules: [
    { id: 'today', state: 'normal', order: 0, hidden: false },
    { id: 'barna', state: 'normal', order: 1, hidden: false },
    { id: 'oppgaver', state: 'normal', order: 2, hidden: false },
    { id: 'innboks', state: 'normal', order: 3, hidden: false },
    { id: 'meldinger', state: 'normal', order: 4, hidden: false },
    { id: 'handleliste', state: 'normal', order: 5, hidden: false },
    { id: 'matoppskrifter', state: 'normal', order: 6, hidden: false },
    { id: 'ideer', state: 'normal', order: 7, hidden: false },
  ],
};

export const DEFAULT_WALL_LAYOUT: UserLayout = {
  modules: [
    { id: 'family-calendar', state: 'normal', order: 0, hidden: false },
    { id: 'handleliste', state: 'normal', order: 1, hidden: false },
    { id: 'barna', state: 'normal', order: 2, hidden: false },
  ],
};
