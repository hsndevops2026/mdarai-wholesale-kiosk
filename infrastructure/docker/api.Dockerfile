# Build context: repository root.
FROM node:22-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter "./packages/**" build && pnpm --filter @mdarai/api build
# Self-contained production bundle of the API and its workspace dependencies.
RUN pnpm --filter @mdarai/api deploy --prod --legacy /out \
 && cp -r apps/api/dist /out/dist \
 && mkdir -p /out/prisma && cp -r packages/database/prisma packages/database/prisma.config.ts /out/prisma/

FROM node:22-slim
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /out /app
USER node
EXPOSE 4000
# Migrations run from the database package (see infrastructure/deployment/railway.md); the API only serves.
CMD ["node", "--enable-source-maps", "dist/main.js"]
