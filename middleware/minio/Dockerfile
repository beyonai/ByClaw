ARG MINIO_IMAGE=quay.io/minio/minio
ARG MINIO_VERSION=RELEASE.2025-09-07T16-13-09Z

FROM ${MINIO_IMAGE}:${MINIO_VERSION} AS minio-bin

FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=minio-bin /usr/bin/minio /usr/local/bin/minio
RUN chmod +x /usr/local/bin/minio && minio --version

RUN mkdir -p /data && chmod 777 /data

ENV MINIO_ROOT_USER=admin \
    MINIO_ROOT_PASSWORD=password

EXPOSE 9000 9001

VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:9000/minio/health/live || exit 1

CMD ["minio", "server", "/data", "--console-address", ":9001"]
