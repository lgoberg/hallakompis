import type { FastifyInstance } from 'fastify';
import { ChatRequestSchema } from '@hallakompis/shared';
import { db, users } from '@hallakompis/db';
import { eq } from 'drizzle-orm';
import { runChat } from '../chat/orchestrator.js';

export async function chatRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.requireAuth);

  // POST /chat — én runde med Kompis
  app.post('/', async (req, reply) => {
    const u = req.user!;
    const parsed = ChatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Ugyldig forespørsel', details: parsed.error.issues });
    }

    const [userRow] = await db.select().from(users).where(eq(users.id, u.id)).limit(1);
    const uiPref = (userRow?.uiPreference as Record<string, string>) ?? {};

    try {
      const result = await runChat({
        userMessage: parsed.data.message,
        context: {
          userId: u.id,
          householdId: u.householdId,
          userName: u.displayName ?? u.name,
        },
        uiPreference: uiPref,
      });
      return {
        reply: result.reply,
        toolCalls: result.toolCalls,
      };
    } catch (err) {
      app.log.error(err);
      return reply.code(500).send({ error: 'Kompis fikk et problem. Prøv igjen om litt.' });
    }
  });
}
