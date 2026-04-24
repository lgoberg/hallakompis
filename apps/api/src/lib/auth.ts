import fp from 'fastify-plugin';
import type { FastifyReply, FastifyRequest } from 'fastify';
import crypto from 'node:crypto';
import { db, sessions, users } from '@hallakompis/db';
import { eq, and, gt } from 'drizzle-orm';

declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: string;
      householdId: string;
      name: string;
      displayName: string | null;
      role: 'adult' | 'child' | 'wall_display';
    };
  }
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

const COOKIE_NAME = 'hallakompis_session';
const SESSION_DAYS = 30;

export function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

export async function createSession(userId: string, deviceLabel?: string) {
  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  await db.insert(sessions).values({ userId, tokenHash, deviceLabel, expiresAt });
  return { token, expiresAt };
}

export async function findUserBySession(token: string) {
  const tokenHash = hashToken(token);
  const rows = await db
    .select({
      userId: sessions.userId,
      id: users.id,
      householdId: users.householdId,
      name: users.name,
      displayName: users.displayName,
      role: users.role,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return rows[0] ?? null;
}

export const authPlugin = fp(async (app) => {
  // Dekorerer hver request med user hvis gyldig cookie finnes
  app.addHook('preHandler', async (req) => {
    const token = req.cookies[COOKIE_NAME];
    if (!token) return;
    const row = await findUserBySession(token);
    if (!row) return;
    req.user = {
      id: row.id,
      householdId: row.householdId,
      name: row.name,
      displayName: row.displayName,
      role: row.role,
    };
  });

  // Helper: require auth on routes
  app.decorate('requireAuth', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) {
      reply.code(401).send({ error: 'Ikke innlogget' });
    }
  });
});

export { COOKIE_NAME };
