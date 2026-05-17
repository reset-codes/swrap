# syntax=docker/dockerfile:1

# ─── Build stage ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Install all deps (including devDeps — tsx is a devDependency)
COPY package.json package-lock.json ./
RUN npm ci

# Copy Prisma schema and generate client
COPY prisma ./prisma
RUN npx prisma generate

# Copy source
COPY tsconfig.json ./
COPY apps/api ./apps/api
COPY packages ./packages
COPY db ./db

# ─── Runtime stage ───────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app

# Git commit SHA passed in at build time so the /health endpoint can report it.
# Usage: docker build --build-arg COMMIT_SHA=$(git rev-parse HEAD) ...
ARG COMMIT_SHA=unknown
ENV COMMIT_SHA=${COMMIT_SHA}

# Copy everything needed to run tsx at runtime
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/apps/api ./apps/api
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/db ./db

# Non-root user for security
RUN addgroup -S swrap && adduser -S swrap -G swrap
USER swrap

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-4000}/health | grep -q '"status":"ok"' || exit 1

EXPOSE 4000

ENV NODE_ENV=production

CMD ["node_modules/.bin/tsx", "apps/api/server.ts"]
