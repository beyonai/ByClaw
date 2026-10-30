FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
RUN pnpm build && pnpm prune --prod

FROM node:22-slim
ARG BUILD_VERSION=unknown
ARG BUILD_BRANCH=unknown
ARG BUILD_COMMIT=unknown
ARG BUILD_COMMIT_FULL=unknown
ARG BUILD_TIME=unknown
ARG BUILD_MODULE=byclaw-tenant-node
ARG BUILD_COMMIT_MSG=unknown
LABEL org.opencontainers.image.version=$BUILD_VERSION \
      org.opencontainers.image.revision=$BUILD_COMMIT_FULL \
      org.opencontainers.image.created=$BUILD_TIME \
      byclaw.build.branch=$BUILD_BRANCH \
      byclaw.build.commit=$BUILD_COMMIT \
      byclaw.build.module=$BUILD_MODULE \
      byclaw.build.commit.message=$BUILD_COMMIT_MSG
ENV NODE_ENV=production
ENV NODE_STATE_DIR=/var/lib/byclaw-tenant
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
# ACS runs the NAS directory initializer from the workload image.
RUN sed -i 's|http://deb.debian.org|http://mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update && apt-get install -y --no-install-recommends python3 \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/lib/byclaw-tenant && chown node:node /var/lib/byclaw-tenant
USER node
EXPOSE 3100
CMD ["node", "dist/main.js"]
