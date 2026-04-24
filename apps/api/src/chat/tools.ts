/**
 * Tool-registry: Claude får denne listen og kan kalle dem som funksjoner.
 * Hvert verktøy har et `execute`-felt som gjør det faktiske arbeidet.
 *
 * Legg til et nytt verktøy ved å:
 *  1. Definere input-schema (Zod)
 *  2. Skrive execute-funksjonen
 *  3. Legge det til i toolRegistry nedenfor
 */
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { db, tasks, shoppingItems, ideas, calendarEvents } from '@hallakompis/db';
import { eq, and, gte, lte } from 'drizzle-orm';

export interface ToolContext {
  userId: string;
  householdId: string;
  userName: string;
}

export interface KompisTool {
  definition: Anthropic.Tool;
  execute: (input: unknown, ctx: ToolContext) => Promise<unknown>;
  requiresConfirmation?: boolean;
}

// ─── read_calendar ───
const ReadCalendarInput = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

// ─── add_to_shopping ───
const AddToShoppingInput = z.object({
  items: z.array(z.object({
    content: z.string(),
    category: z.string().optional(),
  })).min(1),
});

// ─── add_task ───
const AddTaskInput = z.object({
  content: z.string(),
  priority: z.enum(['high', 'medium', 'low']).optional(),
  listType: z.enum(['today', 'later', 'someday']).optional(),
});

// ─── add_idea ───
const AddIdeaInput = z.object({
  content: z.string(),
  tag: z.string().optional(),
});

// ─── Tool-registry ───
export const toolRegistry: Record<string, KompisTool> = {
  read_calendar: {
    definition: {
      name: 'read_calendar',
      description: 'Les kalenderhendelser for brukeren. Returnerer alle hendelser innenfor gitt tidsrom (alle kilder, fargekodet).',
      input_schema: {
        type: 'object',
        properties: {
          from: { type: 'string', format: 'date-time', description: 'Start (ISO 8601). Default: i dag 00:00' },
          to: { type: 'string', format: 'date-time', description: 'Slutt (ISO 8601). Default: om 24t' },
        },
      },
    },
    execute: async (input, ctx) => {
      const p = ReadCalendarInput.parse(input);
      const from = p.from ? new Date(p.from) : startOfDay();
      const to = p.to ? new Date(p.to) : new Date(from.getTime() + 24 * 60 * 60 * 1000);
      const rows = await db
        .select()
        .from(calendarEvents)
        .where(and(
          eq(calendarEvents.userId, ctx.userId),
          gte(calendarEvents.startAt, from),
          lte(calendarEvents.startAt, to),
        ))
        .orderBy(calendarEvents.startAt);
      return { events: rows };
    },
  },

  add_to_shopping: {
    definition: {
      name: 'add_to_shopping',
      description: 'Legg til én eller flere varer på husstandens handleliste. Delt med alle i husstanden.',
      input_schema: {
        type: 'object',
        required: ['items'],
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              required: ['content'],
              properties: {
                content: { type: 'string' },
                category: { type: 'string', description: 'F.eks. "meieri", "frukt", "annet"' },
              },
            },
          },
        },
      },
    },
    execute: async (input, ctx) => {
      const p = AddToShoppingInput.parse(input);
      const rows = await db.insert(shoppingItems).values(
        p.items.map((i) => ({
          householdId: ctx.householdId,
          content: i.content,
          category: i.category ?? null,
          addedBy: ctx.userId,
        })),
      ).returning();
      return { added: rows.map((r) => ({ id: r.id, content: r.content })) };
    },
  },

  list_shopping: {
    definition: {
      name: 'list_shopping',
      description: 'Hent hele handlelisten for husstanden (ikke-avkryssede først).',
      input_schema: { type: 'object', properties: {} },
    },
    execute: async (_input, ctx) => {
      const rows = await db.select().from(shoppingItems).where(eq(shoppingItems.householdId, ctx.householdId));
      return { items: rows };
    },
  },

  add_task: {
    definition: {
      name: 'add_task',
      description: 'Lag en ny oppgave for brukeren med prioritet og tidsfrist.',
      input_schema: {
        type: 'object',
        required: ['content'],
        properties: {
          content: { type: 'string' },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
          listType: { type: 'string', enum: ['today', 'later', 'someday'] },
        },
      },
    },
    execute: async (input, ctx) => {
      const p = AddTaskInput.parse(input);
      const [row] = await db.insert(tasks).values({
        userId: ctx.userId,
        content: p.content,
        priority: p.priority ?? 'medium',
        listType: p.listType ?? 'today',
      }).returning();
      return { created: row };
    },
  },

  list_tasks: {
    definition: {
      name: 'list_tasks',
      description: 'List oppgaver for brukeren. Kan filtreres på listType.',
      input_schema: {
        type: 'object',
        properties: {
          listType: { type: 'string', enum: ['today', 'later', 'someday'] },
        },
      },
    },
    execute: async (input, ctx) => {
      const list = (input as { listType?: string }).listType;
      const rows = list
        ? await db.select().from(tasks).where(and(eq(tasks.userId, ctx.userId), eq(tasks.listType, list as 'today' | 'later' | 'someday')))
        : await db.select().from(tasks).where(eq(tasks.userId, ctx.userId));
      return { tasks: rows };
    },
  },

  add_idea: {
    definition: {
      name: 'add_idea',
      description: 'Lagre en idé eller tanke. Kompis kan tagge den selv om ingen tag gis.',
      input_schema: {
        type: 'object',
        required: ['content'],
        properties: {
          content: { type: 'string' },
          tag: { type: 'string', description: 'F.eks. "Lyddesign", "Studio", "Familie"' },
        },
      },
    },
    execute: async (input, ctx) => {
      const p = AddIdeaInput.parse(input);
      const [row] = await db.insert(ideas).values({
        userId: ctx.userId,
        content: p.content,
        tag: p.tag ?? null,
      }).returning();
      return { created: row };
    },
  },
};

export function getToolDefinitions(): Anthropic.Tool[] {
  return Object.values(toolRegistry).map((t) => t.definition);
}

export async function executeTool(name: string, input: unknown, ctx: ToolContext) {
  const tool = toolRegistry[name];
  if (!tool) throw new Error(`Ukjent verktøy: ${name}`);
  return tool.execute(input, ctx);
}

function startOfDay() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
