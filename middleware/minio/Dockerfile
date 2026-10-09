FROM debian:bookworm-slim

ARG TARGETARCH
ARG MINIO_VERSION=RELEASE.2025-09-07T16-13-09Z

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates \
    && case "${TARGETARCH}" in amd64|arm64) ;; *) echo "Unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; esac \
    && MINIO_ASSET="minio.linux-${TARGETARCH}.${MINIO_VERSION}" \
    && MINIO_RELEASE_URL="https://github.com/minio/minio/releases/download/${MINIO_VERSION}" \
    && curl --fail --location --retry 5 --output "/tmp/${MINIO_ASSET}" "${MINIO_RELEASE_URL}/${MINIO_ASSET}" \
    && curl --fail --location --retry 5 --output "/tmp/${MINIO_ASSET}.sha256sum" \
        "${MINIO_RELEASE_URL}/${MINIO_ASSET}.sha256sum" \
    && MINIO_SHA256="$(cut -d ' ' -f 1 "/tmp/${MINIO_ASSET}.sha256sum")" \
    && echo "${MINIO_SHA256}  /tmp/${MINIO_ASSET}" | sha256sum --check - \
    && mv "${MINIO_ASSET}" /usr/local/bin/minio \
    && chmod +x /usr/local/bin/minio \
    && minio --version \
    && rm -f "/tmp/${MINIO_ASSET}.sha256sum" \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /data && chmod 777 /data

ENV MINIO_ROOT_USER=admin \
    MINIO_ROOT_PASSWORD=password

EXPOSE 9000 9001

VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:9000/minio/health/live || exit 1

CMD ["minio", "server", "/data", "--console-address", ":9001"]
