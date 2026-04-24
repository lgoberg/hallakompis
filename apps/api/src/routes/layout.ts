import type { FastifyInstance } from 'fastify';
import { db, userLayouts } from '@hallakompis/db';
import { eq, and } from 'drizzle-orm';
import { UserLayoutSchema, DEFAULT_DESKTOP_LAYOUT, DEFAULT_WALL_LAYOUT } from '@hallakompis/shared';
import { z } from 'zod';

const ViewportQuery = z.object({
  viewport: z.enum(['desktop', 'mobile', 'wall']).default('desktop'),
});

const PutBody = z.object({
  viewport: z.enum(['desktop', 'mobile', 'wall']),
  layout: UserLayoutSchema,
});

export async function layoutRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.requireAuth);

  app.get('/', async (req) => {
    const u = req.user!;
    const q = ViewportQuery.parse(req.query);
    const [row] = await db
      .select()
      .from(userLayouts)
      .where(and(eq(userLayouts.userId, u.id), eq(userLayouts.viewport, q.viewport)))
      .limit(1);
    if (row) return { viewport: q.viewport, layout: row.layout, updatedAt: row.updatedAt };
    const fallback = q.viewport === 'wall' ? DEFAULT_WALL_LAYOUT : DEFAULT_DESKTOP_LAYOUT;
    return { viewport: q.viewport, layout: fallback, updatedAt: null };
  });

  app.put('/', async (req) => {
    const u = req.user!;
    const body = PutBody.parse(req.body);
    // Upsert via onConflict
    const [row] = await db
      .insert(userLayouts)
      .values({ userId: u.id, viewport: body.viewport, layout: body.layout })
      .onConflictDoUpdate({
        target: [userLayouts.userId, userLayouts.viewport],
        set: { layout: body.layout, updatedAt: new Date() },
      })
      .returning();
    return { viewport: row?.viewport, layout: row?.layout, updatedAt: row?.updatedAt };
  });
}
