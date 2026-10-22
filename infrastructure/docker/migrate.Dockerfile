# One-shot job: apply Prisma migrations (and optionally the demo seed). Build context: repository root.
FROM node:22-slim
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter "./packages/**" build
WORKDIR /repo/packages/database
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && if [ \"$RUN_DEMO_SEED\" = \"true\" ]; then pnpm exec tsx src/seed.ts; fi"]
