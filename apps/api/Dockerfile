FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @purpio/db generate && pnpm --filter @purpio/api build
EXPOSE 4000
CMD ["node", "apps/api/dist/index.js"]
