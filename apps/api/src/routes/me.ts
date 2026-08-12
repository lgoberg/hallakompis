import type { FastifyInstance } from 'fastify';
import { db, users, households } from '@hallakompis/db';
import { eq } from 'drizzle-orm';
import { lagKapsel, kapselDomene, offentligVert, HUSSTAND_KAPSEL } from '../lib/husstandskapsel.js';

export async function meRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: app.requireAuth }, async (req, reply) => {
    const u = req.user!;
    const [full] = await db.select().from(users).where(eq(users.id, u.id)).limit(1);

    /* Husstandskapselen fornyes ved hvert besøk, ikke bare ved innlogging.
       To grunner, og den første er en ekte felle: en økt opprettet FØR
       kapselen fantes ville aldri fått en, og da er du permanent utestengt fra
       tiern og fortelling uten å skjønne hvorfor, for du ER jo innlogget.
       Den andre er at 30 dager da måles fra siste besøk i stedet for fra
       innloggingen. */
    const hemmelighet = process.env.HALLAKOMPIS_SECRET;
    const domene = kapselDomene(offentligVert(req.headers));
    if (hemmelighet && domene && full) {
      const kapsel = lagKapsel(
        {
          husstand: full.householdId,
          person: full.id,
          navn: full.displayName ?? full.name,
          rolle: full.role as 'adult' | 'child',
        },
        hemmelighet
      );
      reply.setCookie(HUSSTAND_KAPSEL, kapsel.verdi, {
        httpOnly: false,
        secure: true,
        sameSite: 'lax',
        path: '/',
        domain: domene,
        expires: kapsel.utloper,
      });
    }

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
