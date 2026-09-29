FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
RUN pnpm build && pnpm prune --prod

FROM node:22-bookworm-slim
ENV NODE_ENV=production
ENV NODE_STATE_DIR=/var/lib/byclaw-tenant
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
RUN mkdir -p /var/lib/byclaw-tenant && chown node:node /var/lib/byclaw-tenant
USER node
EXPOSE 3100
CMD ["node", "dist/main.js"]
