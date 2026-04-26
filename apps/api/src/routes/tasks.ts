import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, tasks } from '@hallakompis/db';
import { eq, and, isNull, isNotNull, sql } from 'drizzle-orm';

const CreateTask = z.object({
  content: z.string().min(1).max(500),
  priority: z.enum(['high', 'medium', 'low']).optional(),
  listType: z.enum(['today', 'later', 'someday']).optional(),
  dueAt: z.string().datetime().optional(),
});

const UpdateTask = CreateTask.partial().extend({
  doneAt: z.string().datetime().nullable().optional(),
  archivedAt: z.string().datetime().nullable().optional(),
});

export async function tasksRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.requireAuth);

  app.get('/', async (req) => {
    const u = req.user!;
    const rows = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.userId, u.id), isNull(tasks.archivedAt)));
    return rows;
  });

  // Bulk-arkiver alle fullførte (doneAt IS NOT NULL) for innlogget bruker.
  // Valgfritt listType-query for å begrense til én seksjon (i dag, senere, someday).
  app.post('/archive-completed', async (req) => {
    const u = req.user!;
    const ListTypeQuery = z.object({
      listType: z.enum(['today', 'later', 'someday']).optional(),
    });
    const query = ListTypeQuery.parse(req.query);
    const conditions = [
      eq(tasks.userId, u.id),
      isNotNull(tasks.doneAt),
      isNull(tasks.archivedAt),
    ];
    if (query.listType) conditions.push(eq(tasks.listType, query.listType));
    const rows = await db
      .update(tasks)
      .set({ archivedAt: sql`now()` })
      .where(and(...conditions))
      .returning({ id: tasks.id });
    return { archived: rows.length };
  });

  app.post('/', async (req) => {
    const u = req.user!;
    const body = CreateTask.parse(req.body);
    const [row] = await db
      .insert(tasks)
      .values({
        userId: u.id,
        content: body.content,
        priority: body.priority ?? 'medium',
        listType: body.listType ?? 'today',
        dueAt: body.dueAt ? new Date(body.dueAt) : null,
      })
      .returning();
    return row;
  });

  app.patch('/:id', async (req, reply) => {
    const u = req.user!;
    const { id } = req.params as { id: string };
    const body = UpdateTask.parse(req.body);
    const [row] = await db
      .update(tasks)
      .set({
        ...body,
        dueAt: body.dueAt ? new Date(body.dueAt) : undefined,
        doneAt: body.doneAt === null ? null : body.doneAt ? new Date(body.doneAt) : undefined,
        archivedAt: body.archivedAt === null ? null : body.archivedAt ? new Date(body.archivedAt) : undefined,
      })
      .where(and(eq(tasks.id, id), eq(tasks.userId, u.id)))
      .returning();
    if (!row) return reply.code(404).send({ error: 'Fant ikke oppgaven' });
    return row;
  });

  app.delete('/:id', async (req, reply) => {
    const u = req.user!;
    const { id } = req.params as { id: string };
    const res = await db.delete(tasks).where(and(eq(tasks.id, id), eq(tasks.userId, u.id))).returning();
    if (!res.length) return reply.code(404).send({ error: 'Fant ikke oppgaven' });
    return { ok: true };
  });
}
