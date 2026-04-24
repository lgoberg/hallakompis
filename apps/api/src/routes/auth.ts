import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import crypto from 'node:crypto';
import { db, users, households, sessions } from '@hallakompis/db';
import { eq } from 'drizzle-orm';
import { createSession, hashToken, COOKIE_NAME } from '../lib/auth.js';

const SelectUserBody = z.object({
  userId: z.string().uuid(),
  pin: z.string().optional(),
  deviceLabel: z.string().optional(),
});

function verifyPin(pin: string, hash: string): boolean {
  const candidate = crypto.createHash('sha256').update(pin).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(hash));
}

export async function authRoutes(app: FastifyInstance) {
  // GET /auth/household — vis hvilke brukere som finnes
  // I en ekte app: bundet til husstand via subdomain eller første setup
  app.get('/household', async () => {
    // For nå: returnerer første husstand (MVP)
    const hh = await db.select().from(households).limit(1);
    if (!hh[0]) return { error: 'Ingen husstand funnet. Kjør pnpm db:seed først.' };

    const members = await db
      .select({
        id: users.id,
        name: users.name,
        displayName: users.displayName,
        role: users.role,
        avatarColor: users.avatarColor,
        hasPin: users.pinHash,
      })
      .from(users)
      .where(eq(users.householdId, hh[0].id));

    return {
      household: { id: hh[0].id, name: hh[0].name },
      members: members.map((m) => ({ ...m, hasPin: !!m.hasPin })),
    };
  });

  // POST /auth/select-user — velg bruker (med evt. PIN)
  app.post('/select-user', async (req, reply) => {
    const body = SelectUserBody.parse(req.body);
    const [user] = await db.select().from(users).where(eq(users.id, body.userId)).limit(1);

    if (!user) return reply.code(404).send({ error: 'Bruker finnes ikke' });
    if (user.pinHash) {
      if (!body.pin || !verifyPin(body.pin, user.pinHash)) {
        return reply.code(401).send({ error: 'Feil PIN' });
      }
    }

    const { token, expiresAt } = await createSession(user.id, body.deviceLabel);

    reply.setCookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
    });

    return {
      user: {
        id: user.id,
        name: user.name,
        displayName: user.displayName,
        role: user.role,
      },
    };
  });

  // POST /auth/logout
  app.post('/logout', async (req, reply) => {
    const token = req.cookies[COOKIE_NAME];
    if (token) {
      const th = hashToken(token);
      await db.delete(sessions).where(eq(sessions.tokenHash, th));
    }
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    return { ok: true };
  });
}
