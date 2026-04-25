# Multi-stage build for kompis-api
FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /repo

# ─── Install deps ───
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY apps/api/package.json ./apps/api/
COPY packages/db/package.json ./packages/db/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile

# ─── Build ───
FROM base AS build
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /repo/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /repo/packages/shared/node_modules ./packages/shared/node_modules
COPY . .
RUN pnpm --filter @hallakompis/shared build
RUN pnpm --filter @hallakompis/db build
RUN pnpm --filter @hallakompis/api build

# ─── Runtime ───
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /repo/node_modules /app/node_modules
COPY --from=build /repo/package.json /app/package.json
COPY --from=build /repo/pnpm-workspace.yaml /app/pnpm-workspace.yaml
COPY --from=build /repo/apps/api/dist /app/apps/api/dist
COPY --from=build /repo/apps/api/node_modules /app/apps/api/node_modules
COPY --from=build /repo/apps/api/package.json /app/apps/api/package.json
COPY --from=build /repo/packages /app/packages

WORKDIR /app/apps/api
EXPOSE 3001
CMD ["node", "dist/server.js"]