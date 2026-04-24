import type { FastifyInstance } from 'fastify';
import { db, users, households } from '@hallakompis/db';
import { eq } from 'drizzle-orm';

export async function meRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: app.requireAuth }, async (req) => {
    const u = req.user!;
    const [full] = await db.select().from(users).where(eq(users.id, u.id)).limit(1);
    return {
      id: full?.id,
      name: full?.name,
      displayName: full?.displayName,
      role: full?.role,
      avatarColor: full?.avatarColor,
      uiPreference: full?.uiPreference,
    };
  });

  app.get('/household', { preHandler: app.requireAuth }, async (req) => {
    const u = req.user!;
    const [hh] = await db.select().from(households).where(eq(households.id, u.householdId)).limit(1);
    const members = await db
      .select({
        id: users.id,
        name: users.name,
        displayName: users.displayName,
        role: users.role,
        avatarColor: users.avatarColor,
      })
      .from(users)
      .where(eq(users.householdId, u.householdId));
    return { household: hh, members };
  });
}
