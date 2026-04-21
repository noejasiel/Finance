# ── Stage 1: Build ──────────────────────────────────────────────
FROM node:20-slim AS builder

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /app

# Copy workspace config + lockfile first (better layer caching)
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/backend/package.json apps/backend/
COPY apps/web/package.json apps/web/

RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/shared/ packages/shared/
COPY apps/backend/ apps/backend/
COPY apps/web/ apps/web/

# Build shared → backend + web
RUN pnpm --filter @finance/shared build && \
    pnpm --filter @finance/backend db:generate && \
    pnpm --filter @finance/backend build && \
    pnpm --filter @finance/web build

# ── Stage 2: Backend runtime ───────────────────────────────────
FROM node:20-slim AS backend

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/backend/package.json apps/backend/

RUN pnpm install --frozen-lockfile --prod

# Copy built artifacts
COPY --from=builder /app/packages/shared/dist/ packages/shared/dist/
COPY --from=builder /app/apps/backend/dist/ apps/backend/dist/
COPY --from=builder /app/apps/backend/prisma/ apps/backend/prisma/

# Re-generate Prisma client in prod image
RUN cd apps/backend && npx prisma generate

ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "apps/backend/dist/index.js"]

# ── Stage 3: Web (Next.js standalone) ───────────────────────────
FROM node:20-slim AS web

WORKDIR /app

# Copy the standalone output
COPY --from=builder /app/apps/web/.next/standalone/ ./
COPY --from=builder /app/apps/web/.next/static/ apps/web/.next/static/

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "apps/web/server.js"]
