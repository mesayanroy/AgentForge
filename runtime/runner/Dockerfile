FROM node:18-bullseye-slim

WORKDIR /workspace

# Install pnpm via corepack and prepare environment
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package manifests and lockfile for deterministic install
COPY package.json pnpm-lock.yaml* ./

# Install production dependencies (and dev for ts-node during development)
RUN pnpm install --frozen-lockfile --prefer-offline

# Copy the full workspace (small projects only) so the runner has access to code
COPY . .

ENV NODE_ENV=production

# Default entrypoint runs the TypeScript runner via ts-node (developer image)
ENTRYPOINT ["npx", "ts-node", "--project", "tsconfig.json", "runtime/runner/index.ts"]
