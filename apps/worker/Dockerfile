FROM node:20-alpine
RUN corepack enable && apk add --no-cache git
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @purpio/db generate && pnpm --filter @purpio/worker build
CMD ["node", "apps/worker/dist/index.js"]
