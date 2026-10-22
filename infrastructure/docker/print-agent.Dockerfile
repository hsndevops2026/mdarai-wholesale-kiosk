# Build context: repository root.
FROM node:22-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @mdarai/print-agent build \
 && pnpm --filter @mdarai/print-agent deploy --prod --legacy /out \
 && cp -r services/print-agent/dist services/print-agent/fonts /out/

FROM node:22-slim
WORKDIR /app
COPY --from=build /out /app
USER node
CMD ["node", "dist/main.js"]
