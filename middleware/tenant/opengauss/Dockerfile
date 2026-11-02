ARG BASE_IMAGE=beyonclaw/byclaw-opengauss:6.0.3
ARG RUNTIME_IMAGE=debian:12-slim
FROM ${BASE_IMAGE} AS engine

FROM ${RUNTIME_IMAGE}

# MicroVM injects system services using apt/dpkg. Keep the target distribution's
# libc, loader and package database; copy only the database and its bundled libs.
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        bash ca-certificates coreutils findutils gosu gzip locales python3 sed xz-utils \
        libaio1 libcrypt1 libkeyutils1 libncurses6 libreadline8 libtinfo6 \
        nfs-common openssh-server sudo systemd systemd-sysv \
    && localedef -i en_US -f UTF-8 en_US.UTF-8 \
    && groupadd --gid 1001 omm \
    && useradd --uid 1001 --gid 1001 --create-home --shell /bin/bash omm \
    && mkdir -p /var/lib/opengauss/data /var/run/opengauss /docker-entrypoint-initdb.d \
    && chown -R 1001:1001 /var/lib/opengauss /var/run/opengauss /docker-entrypoint-initdb.d \
    && chmod 0700 /var/lib/opengauss/data \
    && rm -f /etc/ssh/ssh_host_* \
    && rm -rf /var/lib/apt/lists/*

COPY --from=engine --chown=1001:1001 /usr/local/opengauss/ /usr/local/opengauss/
COPY --from=engine /scws/ /scws/
COPY --from=engine /usr/local/bin/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY --from=engine --chown=1001:1001 /docker-entrypoint-initdb.d/ /docker-entrypoint-initdb.d/

COPY --chown=1001:1001 byclaw-be/src/main/resources/tenant/opengauss-entrypoint.py \
    /var/lib/opengauss/byclaw-tenant-entrypoint.py
COPY middleware/tenant/opengauss/verify-runtime.sh /usr/local/bin/byclaw-opengauss-verify-runtime

ENV GAUSSHOME=/usr/local/opengauss \
    PGDATA=/var/lib/opengauss/data \
    LANG=en_US.utf8 \
    PATH=/usr/local/opengauss/bin:/scws/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# Only database processes and omm login shells need the engine's private libs.
# envd, systemd and Debian utilities must keep the system library search path.
RUN printf '%s\n' 'export GAUSSHOME=/usr/local/opengauss' \
        'export PATH="$GAUSSHOME/bin:/scws/bin:$PATH"' \
        'export LD_LIBRARY_PATH="$GAUSSHOME/lib:/scws/lib:${LD_LIBRARY_PATH:-}"' \
        > /home/omm/.bash_profile \
    && chown 1001:1001 /home/omm/.bash_profile \
    && chmod 0755 /usr/local/bin/entrypoint.sh /usr/local/bin/byclaw-opengauss-verify-runtime
WORKDIR /var/lib/opengauss
USER 1001:1001
RUN /usr/local/bin/byclaw-opengauss-verify-runtime

EXPOSE 5432
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["gaussdb"]
