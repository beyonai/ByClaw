FROM node:22.19.0-bookworm-slim AS base

FROM base AS builder

WORKDIR /workspace

ARG NPM_REGISTRY=https://registry.npmmirror.com
ENV NPM_CONFIG_REGISTRY=${NPM_REGISTRY}

RUN corepack enable \
    && corepack prepare pnpm@11.3.0 --activate

COPY . .

RUN pnpm install --frozen-lockfile \
    && pnpm run build \
    && pnpm --filter @byclaw/byclaw-super deploy --prod --legacy /opt/byclaw-super

FROM base AS runtime

WORKDIR /app

ENV NODE_ENV=production

ARG BUILD_VERSION=unknown
ARG BUILD_BRANCH=unknown
ARG BUILD_COMMIT=unknown
ARG BUILD_COMMIT_FULL=unknown
ARG BUILD_TIME=unknown
ARG BUILD_MODULE=byclaw-super
ARG BUILD_COMMIT_MSG=unknown

COPY --from=builder /opt/byclaw-super/ ./

RUN printf '{"version":"%s","branch":"%s","commit":"%s","commitFull":"%s","buildTime":"%s","module":"%s","commitMsg":"%s"}\n' \
    "$BUILD_VERSION" "$BUILD_BRANCH" "$BUILD_COMMIT" "$BUILD_COMMIT_FULL" "$BUILD_TIME" "$BUILD_MODULE" "$BUILD_COMMIT_MSG" \
    > /app/build-info.json \
    && chown -R node:node /app

USER node

EXPOSE 3000

CMD ["node", "dist/index.js"]
