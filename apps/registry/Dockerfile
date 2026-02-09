FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9 --activate

# Install dependencies
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/registry/package.json ./apps/registry/
COPY packages/protocol/package.json ./packages/protocol/
RUN pnpm install --frozen-lockfile

# Build
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/registry/node_modules ./apps/registry/node_modules
COPY --from=deps /app/packages/protocol/node_modules ./packages/protocol/node_modules
COPY . .

# Build protocol first
WORKDIR /app/packages/protocol
RUN pnpm build

# Build registry
WORKDIR /app/apps/registry
RUN pnpm build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

# Copy built files and dependencies
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/registry/dist ./apps/registry/dist
COPY --from=builder /app/apps/registry/node_modules ./apps/registry/node_modules
COPY --from=builder /app/apps/registry/package.json ./apps/registry/package.json
COPY --from=builder /app/packages/protocol/dist ./packages/protocol/dist
COPY --from=builder /app/packages/protocol/node_modules ./packages/protocol/node_modules
COPY --from=builder /app/packages/protocol/package.json ./packages/protocol/package.json

WORKDIR /app/apps/registry

EXPOSE 4001

CMD ["node", "dist/index.js"]
