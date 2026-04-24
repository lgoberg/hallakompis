import { pgTable, uuid, text, timestamp, boolean, integer, real, jsonb, pgEnum, unique, index } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

// ═════════════════════════════════════════════════════════════
//  HUSSTAND OG BRUKERE
// ═════════════════════════════════════════════════════════════

export const userRoleEnum = pgEnum('user_role', ['adult', 'child', 'wall_display']);

export const households = pgTable('households', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  displayName: text('display_name'),                 // "Goberg"
  role: userRoleEnum('role').notNull().default('adult'),
  pinHash: text('pin_hash'),
  avatarColor: text('avatar_color'),
  uiPreference: jsonb('ui_preference').default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  deviceLabel: text('device_label'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const userLayouts = pgTable('user_layouts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  viewport: text('viewport').notNull(),              // 'desktop' | 'mobile' | 'wall'
  layout: jsonb('layout').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [unique().on(t.userId, t.viewport)]);

// ═════════════════════════════════════════════════════════════
//  INTEGRASJONER
// ═════════════════════════════════════════════════════════════

export const integrationStatusEnum = pgEnum('integration_status', ['ok', 'warn', 'error', 'off']);

export const integrations = pgTable('integrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  householdId: uuid('household_id').references(() => households.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),                      // 'google_cal', 'gmail', 'slack', ...
  displayName: text('display_name'),
  config: jsonb('config').default({}).notNull(),
  encryptedTokens: text('encrypted_tokens'),         // AES-256-GCM base64
  status: integrationStatusEnum('status').default('off').notNull(),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  lastErrorMessage: text('last_error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// ═════════════════════════════════════════════════════════════
//  KALENDER (unified cache)
// ═════════════════════════════════════════════════════════════

export const calendarEvents = pgTable('calendar_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  integrationId: uuid('integration_id').references(() => integrations.id, { onDelete: 'cascade' }),
  sourceType: text('source_type').notNull(),         // 'google_cal_work', 'farmers_wife', etc
  sourceId: text('source_id').notNull(),
  title: text('title').notNull(),
  startAt: timestamp('start_at', { withTimezone: true }).notNull(),
  endAt: timestamp('end_at', { withTimezone: true }),
  location: text('location'),
  metadata: jsonb('metadata').default({}).notNull(),
}, (t) => [
  unique().on(t.integrationId, t.sourceId),
  index('idx_cal_user_time').on(t.userId, t.startAt),
]);

export const familyCalendar = pgTable('family_calendar', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  startAt: timestamp('start_at', { withTimezone: true }).notNull(),
  endAt: timestamp('end_at', { withTimezone: true }),
  involves: uuid('involves').array(),                // user ids
  sourceType: text('source_type'),                   // 'spond', 'school', 'manual'
  sourceId: text('source_id'),
});

// ═════════════════════════════════════════════════════════════
//  PERSONLIG
// ═════════════════════════════════════════════════════════════

export const taskPriorityEnum = pgEnum('task_priority', ['high', 'medium', 'low']);
export const taskListEnum = pgEnum('task_list', ['today', 'later', 'someday']);

export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  priority: taskPriorityEnum('priority').default('medium').notNull(),
  listType: taskListEnum('list_type').default('today').notNull(),
  dueAt: timestamp('due_at', { withTimezone: true }),
  doneAt: timestamp('done_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const ideas = pgTable('ideas', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  tag: text('tag'),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// ═════════════════════════════════════════════════════════════
//  DELT HUSSTAND-DATA
// ═════════════════════════════════════════════════════════════

export const shoppingItems = pgTable('shopping_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  category: text('category'),
  checked: boolean('checked').default(false).notNull(),
  addedBy: uuid('added_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// ═════════════════════════════════════════════════════════════
//  MELDINGER (unified)
// ═════════════════════════════════════════════════════════════

export const messageChannels = pgTable('message_channels', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  integrationId: uuid('integration_id').notNull().references(() => integrations.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),                      // 'slack', 'messenger', 'sms'
  externalId: text('external_id'),
  displayName: text('display_name').notNull(),
});

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  channelId: uuid('channel_id').notNull().references(() => messageChannels.id, { onDelete: 'cascade' }),
  externalId: text('external_id').notNull(),
  sender: text('sender').notNull(),
  content: text('content').notNull(),
  summary: text('summary'),                          // AI-generert
  priority: text('priority'),                        // AI-vurdert
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
  readAt: timestamp('read_at', { withTimezone: true }),
}, (t) => [unique().on(t.channelId, t.externalId)]);

// ═════════════════════════════════════════════════════════════
//  OPPSKRIFTER
// ═════════════════════════════════════════════════════════════

export const recipes = pgTable('recipes', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  sourceUrl: text('source_url').unique(),
  sourceName: text('source_name'),
  ingredients: jsonb('ingredients').notNull(),       // [{name, amount, unit}]
  instructions: text('instructions').array(),
  timeMinutes: integer('time_minutes'),
  tags: text('tags').array(),
  // pgvector column defined in migration — Drizzle types it as unknown
  embedding: text('embedding'),                      // vector(1536) cast
  scrapedAt: timestamp('scraped_at', { withTimezone: true }).defaultNow(),
});

export const recipeActionEnum = pgEnum('recipe_action', ['liked', 'disliked', 'cooked', 'skipped', 'saved']);

export const recipeInteractions = pgTable('recipe_interactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  recipeId: uuid('recipe_id').notNull().references(() => recipes.id, { onDelete: 'cascade' }),
  action: recipeActionEnum('action').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// ═════════════════════════════════════════════════════════════
//  LÆRING OG MINNE
// ═════════════════════════════════════════════════════════════

export const memorySourceEnum = pgEnum('memory_source', ['explicit', 'implicit']);

export const memoryFacts = pgTable('memory_facts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  fact: text('fact').notNull(),
  category: text('category'),
  confidence: real('confidence').default(0.5).notNull(),
  sourceType: memorySourceEnum('source_type').notNull(),
  sourceRef: text('source_ref'),
  embedding: text('embedding'),                      // vector(1536)
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  lastAccessedAt: timestamp('last_accessed_at', { withTimezone: true }),
});

// ═════════════════════════════════════════════════════════════
//  SAMTALER
// ═════════════════════════════════════════════════════════════

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
});

export const chatMessages = pgTable('chat_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),                      // 'user' | 'assistant' | 'tool'
  content: jsonb('content').notNull(),
  toolCalls: jsonb('tool_calls'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// ═════════════════════════════════════════════════════════════
//  AUDIT LOG
// ═════════════════════════════════════════════════════════════

export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').notNull(),                  // 'read_email', 'book_studio'...
  target: jsonb('target'),
  result: text('result'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// ═════════════════════════════════════════════════════════════
//  RELATIONS
// ═════════════════════════════════════════════════════════════

export const householdsRelations = relations(households, ({ many }) => ({
  users: many(users),
  integrations: many(integrations),
  shoppingItems: many(shoppingItems),
  familyCalendar: many(familyCalendar),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  household: one(households, { fields: [users.householdId], references: [households.id] }),
  sessions: many(sessions),
  tasks: many(tasks),
  ideas: many(ideas),
  integrations: many(integrations),
  calendarEvents: many(calendarEvents),
  layouts: many(userLayouts),
  memoryFacts: many(memoryFacts),
  conversations: many(conversations),
}));
