FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    wget curl ca-certificates \
    && ARCH=$(uname -m) \
    && if [ "$ARCH" = "aarch64" ]; then MINIO_ARCH="linux-arm64"; else MINIO_ARCH="linux-amd64"; fi \
    && wget -O /usr/local/bin/minio "https://dl.min.io/server/minio/release/${MINIO_ARCH}/minio" \
    && chmod +x /usr/local/bin/minio \
    && apt-get purge -y wget \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /data && chmod 777 /data

ENV MINIO_ROOT_USER=admin \
    MINIO_ROOT_PASSWORD=password

EXPOSE 9000 9001

VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:9000/minio/health/live || exit 1

CMD ["minio", "server", "/data", "--console-address", ":9001"]
