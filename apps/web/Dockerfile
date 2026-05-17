# syntax=docker/dockerfile:1

# ─── Build stage ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files and install ALL deps (including devDeps for build)
COPY package.json package-lock.json ./
RUN npm ci

# Copy all source needed for the Next.js build
COPY tsconfig.json ./
COPY next.config.ts postcss.config.mjs tailwind.config.ts ./
COPY apps/web ./apps/web
COPY packages ./packages
COPY src ./src

# Build the Next.js application
# NEXT_PUBLIC_* vars must be provided at build time
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

RUN npm run build

# ─── Runtime stage ───────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app

# Copy the standalone Next.js output (requires output: 'standalone' in next.config.ts)
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Non-root user for security
RUN addgroup -S swrap && adduser -S swrap -G swrap
USER swrap

# Health check — Next.js serves / by default
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-3000}/ > /dev/null || exit 1

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
