import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';

import { authRoutes } from './routes/auth.js';
import { meRoutes } from './routes/me.js';
import { tasksRoutes } from './routes/tasks.js';
import { shoppingRoutes } from './routes/shopping.js';
import { chatRoutes } from './routes/chat.js';
import { layoutRoutes } from './routes/layout.js';
import { authPlugin } from './lib/auth.js';

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    transport: process.env.NODE_ENV === 'production' ? undefined : {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss.l' },
    },
  },
});

await app.register(helmet, { contentSecurityPolicy: false });
await app.register(cors, {
  origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
  credentials: true,
});
await app.register(cookie, { secret: process.env.SESSION_SECRET ?? 'dev-secret-change-me' });
await app.register(authPlugin);

// Health check
app.get('/health', async () => ({ status: 'ok', service: 'hallakompis-api', time: new Date().toISOString() }));

// Routes
await app.register(authRoutes, { prefix: '/auth' });
await app.register(meRoutes, { prefix: '/me' });
await app.register(tasksRoutes, { prefix: '/tasks' });
await app.register(shoppingRoutes, { prefix: '/family/shopping' });
await app.register(chatRoutes, { prefix: '/chat' });
await app.register(layoutRoutes, { prefix: '/me/layout' });

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '0.0.0.0';

try {
  await app.listen({ port, host });
  app.log.info(`Kompis API er klar på http://${host}:${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
