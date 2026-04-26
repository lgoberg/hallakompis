import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, shoppingItems } from '@hallakompis/db';
import { eq, and, isNull, sql } from 'drizzle-orm';

const CreateItem = z.object({
  content: z.string().min(1).max(200),
  category: z.string().max(50).optional(),
});

const UpdateItem = z.object({
  content: z.string().min(1).max(200).optional(),
  category: z.string().max(50).nullable().optional(),
  checked: z.boolean().optional(),
  archivedAt: z.string().datetime().nullable().optional(),
});

export async function shoppingRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.requireAuth);

  app.get('/', async (req) => {
    const u = req.user!;
    return db
      .select()
      .from(shoppingItems)
      .where(and(eq(shoppingItems.householdId, u.householdId), isNull(shoppingItems.archivedAt)));
  });

  // Bulk-arkiver alle avhukede (checked = true) for husstanden
  app.post('/archive-completed', async (req) => {
    const u = req.user!;
    const rows = await db
      .update(shoppingItems)
      .set({ archivedAt: sql`now()` })
      .where(and(
        eq(shoppingItems.householdId, u.householdId),
        eq(shoppingItems.checked, true),
        isNull(shoppingItems.archivedAt),
      ))
      .returning({ id: shoppingItems.id });
    return { archived: rows.length };
  });

  app.post('/', async (req) => {
    const u = req.user!;
    const body = CreateItem.parse(req.body);
    const [row] = await db.insert(shoppingItems).values({
      householdId: u.householdId,
      content: body.content,
      category: body.category ?? null,
      addedBy: u.id,
    }).returning();
    return row;
  });

  app.patch('/:id', async (req, reply) => {
    const u = req.user!;
    const { id } = req.params as { id: string };
    const body = UpdateItem.parse(req.body);
    const [row] = await db
      .update(shoppingItems)
      .set({
        ...body,
        archivedAt: body.archivedAt === null ? null : body.archivedAt ? new Date(body.archivedAt) : undefined,
      })
      .where(and(eq(shoppingItems.id, id), eq(shoppingItems.householdId, u.householdId)))
      .returning();
    if (!row) return reply.code(404).send({ error: 'Fant ikke vare' });
    return row;
  });

  app.delete('/:id', async (req, reply) => {
    const u = req.user!;
    const { id } = req.params as { id: string };
    const res = await db
      .delete(shoppingItems)
      .where(and(eq(shoppingItems.id, id), eq(shoppingItems.householdId, u.householdId)))
      .returning();
    if (!res.length) return reply.code(404).send({ error: 'Fant ikke vare' });
    return { ok: true };
  });
}
