FROM node:22-alpine

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

# Copy workspace files
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/protocol ./packages/protocol

# Copy registry app
COPY apps/registry ./apps/registry

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build
RUN pnpm --filter @hivemi/protocol build
RUN pnpm --filter @hivemi/registry build

WORKDIR /app/apps/registry

EXPOSE 4001

CMD ["node", "dist/index.js"]
