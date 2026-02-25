FROM node:20-alpine AS base
RUN npm install -g pnpm

# ─── Dependencies ─────────────────────────────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
COPY packages/api/package.json ./packages/api/
RUN pnpm install --frozen-lockfile

# ─── Build ────────────────────────────────────────────────────────────────────
FROM deps AS build
COPY . .
RUN pnpm build

# ─── Runtime ──────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

RUN addgroup -S aegis && adduser -S aegis -G aegis
USER aegis

COPY --from=build --chown=aegis:aegis /app/packages/core/dist ./packages/core/dist
COPY --from=build --chown=aegis:aegis /app/packages/api/dist  ./packages/api/dist
COPY --from=build --chown=aegis:aegis /app/node_modules        ./node_modules

RUN mkdir -p /app/data

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "packages/api/dist/index.js"]
