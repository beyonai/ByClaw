ARG BASE_IMAGE=beyonclaw/byclaw-opengauss:6.0.3
FROM ${BASE_IMAGE}

USER root

# Match the OpenSandbox volume owner while retaining the required omm account.
RUN groupmod -g 1001 omm \
    && usermod -u 1001 -g 1001 omm \
    && chown -R 1001:1001 /home/omm /var/lib/opengauss /var/run/opengauss \
        /usr/local/opengauss /docker-entrypoint-initdb.d

COPY --chown=1001:1001 byclaw-be/src/main/resources/tenant/opengauss-entrypoint.py \
    /var/lib/opengauss/byclaw-tenant-entrypoint.py

USER 1001:1001
