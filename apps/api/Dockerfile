# syntax=docker/dockerfile:1

# ─── Build stage ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files and install ALL deps (including devDeps for build)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source files needed for the API server
COPY tsconfig.json tsconfig.poc-api.json ./
COPY apps/api ./apps/api
COPY packages ./packages

# Compile the Express server
RUN npx tsc --project tsconfig.poc-api.json --outDir dist --module commonjs --target es2020

# ─── Runtime stage ───────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app

# Copy compiled output and runtime deps
COPY --from=builder /app/dist ./dist
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Non-root user for security
RUN addgroup -S swrap && adduser -S swrap -G swrap
USER swrap

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-4000}/health | grep -q '"ok":true' || exit 1

EXPOSE 4000

ENV NODE_ENV=production

CMD ["node", "dist/apps/api/server.js"]
