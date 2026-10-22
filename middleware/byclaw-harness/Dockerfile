# syntax=docker/dockerfile:1

# Build the reusable image first:
#   docker build -f middleware/byclaw-harness/Dockerfile.base -t byclaw/dsh-base:latest .
# Then build this business-extension image:
#   docker build -f middleware/byclaw-harness/Dockerfile.extensions -t byclaw/dsh:latest .
ARG BASE_IMAGE=10.10.168.203:9080/byclaw/dsh-base:2026.9.8
ARG NPM_REGISTRY=https://registry.npmmirror.com


# --- Disposable workspace: build and pack every repository-carried DSH bundle ---
FROM ${BASE_IMAGE} AS plugin-builder

# Apply the registry to npm/pnpm and child processes in this stage.
ARG NPM_REGISTRY
ENV NPM_CONFIG_REGISTRY=${NPM_REGISTRY} \
    npm_config_registry=${NPM_REGISTRY} \
    pnpm_config_registry=${NPM_REGISTRY}

ARG DSH_PLUGIN_VERSION=1.4.1

# The builder stage itself is disposable, so plugins can compile against its
# inherited DSH workspace without copying the multi-gigabyte tree first.
ENV DSH_ROOT=/workspace

USER root

COPY middleware/byclaw-harness/plugins/ /workspace/plugins/
COPY middleware/byclaw-harness/scripts/docker-plugin-layout.mjs /workspace/scripts/docker-plugin-layout.mjs
COPY middleware/byclaw-harness/scripts/docker-workspace-prepare.mjs /workspace/scripts/docker-workspace-prepare.mjs
COPY middleware/byclaw-harness/scripts/prepare-dsh-model-routing-runtime.mjs /workspace/scripts/prepare-dsh-model-routing-runtime.mjs

WORKDIR /workspace

# Mount the plugins into the base image's workspace and carry every plugin's
# own build-script decisions up to this root, approvals and denials alike —
# see the script for why an unstated denial is what fails the install.
RUN node scripts/docker-workspace-prepare.mjs plugins \
    && pnpm install --no-frozen-lockfile

# The pinned DSH release needs explicit request reassembly for model failover.
# Patch only this disposable build workspace, then rebuild the two affected core
# packages with upstream's compiler and host bundler before building consumers.
RUN node scripts/prepare-dsh-model-routing-runtime.mjs --workspace /workspace \
    && pnpm exec tsc -b packages/core/agent-loop/tsconfig.json \
    && pnpm exec tsdown --env.DSH_BUILD_FACE host --filter packages/core/agent --filter packages/core/agent-loop \
    && node --input-type=module -e "const runtime=await import('./packages/core/agent-loop/lib/index.js');if(runtime.byclawRequestReassembly!==true)throw new Error('DSH model-routing compatibility build is missing')"

# Build bundle roots in topological order, then validate CodeGraph's contract
# and live MCP surface against the already-built output without compiling twice.
RUN set -eux; \
    node scripts/docker-plugin-layout.mjs bundles plugins >/tmp/byclaw-bundle-manifests; \
    filter_args=''; \
    bundle_count=0; \
    while IFS= read -r manifest; do \
        package_name="$(jq -er '.name | select(type == "string" and length > 0)' "${manifest}")"; \
        filter_args="${filter_args} --filter=${package_name}"; \
        bundle_count=$((bundle_count + 1)); \
    done </tmp/byclaw-bundle-manifests; \
    test "${bundle_count}" -gt 0; \
    pnpm -r ${filter_args} --if-present run build; \
    pnpm --filter @byclaw/dsh-codegraph run verify:contract; \
    pnpm --filter @byclaw/dsh-codegraph run verify:runtime

RUN set -eux; \
    mkdir -p /tmp/byclaw-plugin-packs; \
    node scripts/docker-plugin-layout.mjs packages plugins >/tmp/byclaw-package-manifests; \
    node scripts/prepare-dsh-model-routing-runtime.mjs --workspace /workspace --manifests >>/tmp/byclaw-package-manifests; \
    # DSH's SSH provider family is outside the CLI installation table; pack it
    # from this workspace so @byclaw/dsh-tool-env installs the same build.
    for ssh_package in ssh fs-ssh subprocess-ssh sandbox-ssh; do \
        printf '%s\n' "/workspace/packages/ssh/${ssh_package}/package.json" >>/tmp/byclaw-package-manifests; \
    done; \
    package_count=0; \
    while IFS= read -r manifest; do \
        package_name="$(jq -er '.name | select(type == "string" and length > 0)' "${manifest}")"; \
        pnpm --filter "${package_name}" pack --pack-destination /tmp/byclaw-plugin-packs; \
        package_count=$((package_count + 1)); \
    done </tmp/byclaw-package-manifests; \
    test "${package_count}" -gt 0; \
    npm pack "dsh-plugin@${DSH_PLUGIN_VERSION}" --pack-destination /tmp/byclaw-plugin-packs; \
    test "$(find /tmp/byclaw-plugin-packs -maxdepth 1 -type f -name '*.tgz' | wc -l)" -eq $((package_count + 1)); \
    mkdir -p /opt/byclaw/plugins; \
    : >/opt/byclaw/plugins/.bundle-names; \
    while IFS= read -r manifest; do \
        jq -er '.name | select(type == "string" and length > 0)' "${manifest}" >>/opt/byclaw/plugins/.bundle-names; \
    done </tmp/byclaw-bundle-manifests; \
    test -s /opt/byclaw/plugins/.bundle-names; \
    archive_count=0; \
    for archive in /tmp/byclaw-plugin-packs/*.tgz; do \
        manifest="$(tar -xOf "${archive}" package/package.json)"; \
        package_name="$(printf '%s\n' "${manifest}" | jq -er '.name | select(type == "string" and length > 0)')"; \
        printf '%s\n' "${manifest}" | jq -er '.version | select(type == "string" and length > 0)' >/dev/null; \
        plugin_dir="$(printf '%s' "${package_name}" | sed -E 's/^@//; s|/|--|g; s|[^A-Za-z0-9._-]|-|g')"; \
        test -n "${plugin_dir}"; \
        test ! -e "/opt/byclaw/plugins/${plugin_dir}"; \
        mkdir "/opt/byclaw/plugins/${plugin_dir}"; \
        tar -xzf "${archive}" -C "/opt/byclaw/plugins/${plugin_dir}" --strip-components=1; \
        archive_count=$((archive_count + 1)); \
    done; \
    test "${archive_count}" -gt 0; \
    rm -rf /tmp/byclaw-plugin-packs


# Keep generated module reconciliation on canonical local paths. The original
# dependency closure, stale-link repair and packaged-executable semantics remain.
COPY middleware/byclaw-harness/scripts/prepare-dsh-local-modules.mjs /tmp/prepare-dsh-local-modules.mjs
RUN node /tmp/prepare-dsh-local-modules.mjs /workspace \
    && pnpm exec tsc -b packages/boot/app-boot/tsconfig.json \
    && pnpm exec tsdown --env.DSH_BUILD_FACE host --filter packages/boot/app-boot


# Fixed connector tools have an independent cache, unaffected by plugin edits.
FROM ${BASE_IMAGE} AS connector-tools
USER root
ARG NPM_REGISTRY
ENV npm_config_registry=${NPM_REGISTRY}
ARG WECOM_CLI_VERSION=0.1.9
ARG LARKSUITE_CLI_VERSION=1.0.85
COPY middleware/byclaw-harness/scripts/lark-mirror-first.mjs /tmp/lark-mirror-first.mjs
# Shared connector Skills need these executables in the final image. Keep their
# versions aligned with OpenClaw and check access as the DSH runtime user.
RUN set -eu; \
    npm install --global --ignore-scripts --no-audit --no-fund --update-notifier=false "@wecom/cli@${WECOM_CLI_VERSION}" "@larksuite/cli@${LARKSUITE_CLI_VERSION}"; \
    node /tmp/lark-mirror-first.mjs "$(npm root -g)/@larksuite/cli/scripts/install.js"; \
    node "$(npm root -g)/@larksuite/cli/scripts/install.js"; \
    wecom_version="$(wecom-cli --version)"; \
    test "${wecom_version}" = "wecom-cli ${WECOM_CLI_VERSION}"; \
    lark_version="$(lark-cli --version)"; \
    test "${lark_version}" = "lark-cli version ${LARKSUITE_CLI_VERSION}"; \
    su -s /bin/sh byclaw -c 'wecom-cli --help >/dev/null && lark-cli --help >/dev/null'; \
    npm cache clean --force


# --- Final runtime: pristine DSH base + packaged plugins + builtin payload ---
FROM ${BASE_IMAGE} AS runtime

ENV BYCLAW_DATA_ROOT=/by

# Apply the registry to npm/pnpm and child processes in this stage.
ARG NPM_REGISTRY
ENV NPM_CONFIG_REGISTRY=${NPM_REGISTRY} \
    npm_config_registry=${NPM_REGISTRY} \
    pnpm_config_registry=${NPM_REGISTRY}

USER root
# Keep bubblewrap available for optional DSH sandbox backends; group members do not require it.
RUN apt-get update && apt-get install -y --no-install-recommends bubblewrap && rm -rf /var/lib/apt/lists/*

ARG BYCLI_VERSION=2.1.72
ARG BYCLI_EXTENSION_VERSION=2.1.27

ENV DSH_HOME=/home/byclaw/.dsh \
    BYCLAW_DSH_CLI_ENTRY=apps/cli/lib/bin.js \
    BYCLAW_DSH_MANAGED_HOME=/opt/byclaw/dsh-managed \
    BYCLAW_BROWSER_SOCKET=/run/byclaw-browser/browserd.sock \
    BYCLAW_BROWSER_DOWNLOAD_ROOT=/run/byclaw-browser/downloads \
    BYCLAW_BROWSER_SCREENSHOT_ROOT=/run/byclaw-browser/screenshots \
    BYCLAW_BROWSER_IDLE_MS=30000 \
    BYCLI_BROWSER_IDLE_TIMEOUT=900 \
    BYCLI_BRIDGE_BOOTSTRAP_SCRIPT=/opt/byclaw/builtin/skills/bycli/scripts/bridge-bootstrap.mjs \
    BYCLAW_BROWSER_STARTUP=on-demand \
    BYCLAW_BROWSER_VIEWER=shared-novnc \
    BYCLAW_BROWSER_USER_DATA_DIR=/home/byclaw/.dsh/browser/user-data \
    BYCLAW_BROWSER_EXTENSIONS=/opt/nvm/current/lib/node_modules/@sovovs/bycli/extension \
    BYCLAW_BYCLI_ENABLED=true \
    BYCLAW_BROWSER_XVFB_SCREEN=1365x768x24 \
    BYCLAW_BROWSER_SESSION_RUNTIME_ROOT=/run/byclaw-browser/sessions \
    BYCLAW_BROWSER_DISPLAY_RANGE=100-199 \
    BYCLAW_BROWSER_RFB_PORT_RANGE=5901-6000 \
    BYCLAW_BROWSER_WEBSOCKIFY_PORT_RANGE=6101-6200 \
    BYCLAW_BROWSER_VNC_WEB_PORT=8081 \
    BYCLAW_BROWSER_VNC_WEB_LISTEN_ADDRESS=0.0.0.0 \
    PATH=/opt/nvm/current/bin:/opt/byclaw/builtin/cli:/usr/local/bin:$PATH \
    BYCLAW_RUNTIME_HOME=/opt/byclaw/builtin \
    BYCLAW_SKILLS_DIR=/opt/byclaw/builtin/skills

USER byclaw
WORKDIR /workspace

COPY --from=plugin-builder --chown=byclaw:byclaw /opt/byclaw/plugins/ /opt/byclaw/dsh-managed/plugins/
# The compiled CLI and explicit source rollback use the same module resolver.
COPY --from=plugin-builder --chown=byclaw:byclaw /workspace/packages/boot/app-boot/src/ /workspace/packages/boot/app-boot/src/
COPY --from=plugin-builder --chown=byclaw:byclaw /workspace/packages/boot/app-boot/lib/ /workspace/packages/boot/app-boot/lib/
# Keep source aliases (tsx) and ordinary package imports on the same core build.
# The two packed core packages also enter the profile's existing local overrides.
COPY --from=plugin-builder --chown=byclaw:byclaw /workspace/packages/core/agent/src/ /workspace/packages/core/agent/src/
COPY --from=plugin-builder --chown=byclaw:byclaw /workspace/packages/core/agent/lib/ /workspace/packages/core/agent/lib/
COPY --from=plugin-builder --chown=byclaw:byclaw /workspace/packages/core/agent-loop/src/ /workspace/packages/core/agent-loop/src/
COPY --from=plugin-builder --chown=byclaw:byclaw /workspace/packages/core/agent-loop/lib/ /workspace/packages/core/agent-loop/lib/
COPY --chown=byclaw:byclaw middleware/byclaw-harness/scripts/prune-dsh-profile.mjs /tmp/prune-dsh-profile.mjs
COPY --chown=byclaw:byclaw middleware/byclaw-harness/scripts/link-dsh-installation-peers.mjs /tmp/link-dsh-installation-peers.mjs
# The build decisions the plugin-builder folded together. This stage starts from
# the pristine base again, whose own workspace never saw the plugins, and the
# packed plugins carry no pnpm-workspace.yaml of their own — so the merged file
# has to travel rather than be recomputed here.
COPY --from=plugin-builder --chown=byclaw:byclaw /workspace/pnpm-workspace.yaml /tmp/byclaw-prepared-workspace.yaml

# Initialize the official profile, make every local package available to
# bundle-to-bundle dependency resolution, then register top-level plugin bundles.
# The profile installs the same packages the builder did, so it needs the same
# allowBuilds: a denial missing here fails `dsh plugin add` with
# ERR_PNPM_IGNORED_BUILDS exactly as it would fail an install.
# DSH 0.2 supplies installation peers in memory, only to modules under
# $DSH_HOME/profiles; at runtime these packages load from /opt instead, so link
# DSH's own installation table into the managed profiles/node_modules before
# importing packed core packages with plain Node. autoInstallPeers stays
# disabled so Cordis/services share the host generation.
RUN set -eux; \
    DSH_HOME="${BYCLAW_DSH_MANAGED_HOME}" pnpm dsh plugin --profile web list >/dev/null; \
    profile_workspace="${BYCLAW_DSH_MANAGED_HOME}/profiles/web/pnpm-workspace.yaml"; \
    printf 'registry=%s\n' "${NPM_REGISTRY}" >"${BYCLAW_DSH_MANAGED_HOME}/profiles/web/.npmrc"; \
    node -e "const fs=require('node:fs');const yaml=require('js-yaml');const source=yaml.load(fs.readFileSync('/tmp/byclaw-prepared-workspace.yaml','utf8'));const profile=yaml.load(fs.readFileSync(process.argv[1],'utf8'));profile.registry=process.env.pnpm_config_registry;profile.allowBuilds={...profile.allowBuilds,...source.allowBuilds};fs.writeFileSync(process.argv[1],yaml.dump(profile,{lineWidth:-1,noRefs:true}))" "${profile_workspace}"; \
    printf '\noverrides:\n' >> "${profile_workspace}"; \
    package_count=0; \
    for manifest in "${BYCLAW_DSH_MANAGED_HOME}"/plugins/*/package.json; do \
        package_name="$(jq -er '.name | select(type == "string" and length > 0)' "${manifest}")"; \
        plugin_dir="${manifest%/package.json}"; \
        printf "  '%s': 'file:%s'\n" "${package_name}" "${plugin_dir}" >> "${profile_workspace}"; \
        package_count=$((package_count + 1)); \
    done; \
    test "${package_count}" -gt 0; \
    set --; \
    while IFS= read -r package_name; do \
        plugin_dir="$(printf '%s' "${package_name}" | sed -E 's/^@//; s|/|--|g; s|[^A-Za-z0-9._-]|-|g')"; \
        manifest="${BYCLAW_DSH_MANAGED_HOME}/plugins/${plugin_dir}/package.json"; \
        jq -e '.dsh.bundle.patch | type == "string" and length > 0' "${manifest}" >/dev/null; \
        set -- "$@" "file:${manifest%/package.json}"; \
    done <"${BYCLAW_DSH_MANAGED_HOME}/plugins/.bundle-names"; \
    test "$#" -gt 0; \
    DSH_HOME="${BYCLAW_DSH_MANAGED_HOME}" pnpm dsh plugin --profile web add "$@"; \
    DSH_HOME="${BYCLAW_DSH_MANAGED_HOME}" node --import tsx/esm /tmp/link-dsh-installation-peers.mjs /workspace web; \
    node /tmp/prune-dsh-profile.mjs "${BYCLAW_DSH_MANAGED_HOME}/profiles/web/node_modules"; \
    test -z "$(find "${BYCLAW_DSH_MANAGED_HOME}/profiles/web/node_modules" -type f -name '*.map' -print -quit)"; \
    cd "${BYCLAW_DSH_MANAGED_HOME}/profiles/web"; \
    node --input-type=module -e "const {createRequire}=await import('node:module');const require=createRequire(import.meta.resolve('@byclaw/byclaw-model-router/dsh'));const runtime=await import(require.resolve('@deepseek-ai/dsh-agent-loop'));if(runtime.byclawRequestReassembly!==true)throw new Error('Profile resolved an unpatched DSH agent loop')"; \
    node -e "const pty=require('node-pty');if(typeof pty.spawn!=='function')process.exit(1)"; \
    cd /workspace; \
    rm -f /tmp/prune-dsh-profile.mjs /tmp/link-dsh-installation-peers.mjs /tmp/byclaw-prepared-workspace.yaml

RUN set -eux; \
    profile_manifest="${BYCLAW_DSH_MANAGED_HOME}/profiles/web/package.json"; \
    bundle_count=0; \
    while IFS= read -r package_name; do \
        jq -e --arg package_name "${package_name}" \
            '.dsh.profile.bundles | index($package_name) != null' \
            "${profile_manifest}" >/dev/null; \
        bundle_count=$((bundle_count + 1)); \
    done <"${BYCLAW_DSH_MANAGED_HOME}/plugins/.bundle-names"; \
    test "${bundle_count}" -gt 0; \
    DSH_HOME="${BYCLAW_DSH_MANAGED_HOME}" node apps/cli/lib/bin.js --profile web --dump-config >/tmp/dsh-web-config.yml; \
    grep -Eq -- '^[[:space:]]*(-[[:space:]]+)?id:[[:space:]]+logger-console[[:space:]]*$' /tmp/dsh-web-config.yml; \
    grep -Eq -- '^[[:space:]]*(-[[:space:]]+)?id:[[:space:]]+byclaw-dsh[[:space:]]*$' /tmp/dsh-web-config.yml; \
    grep -Eq -- '^[[:space:]]*(-[[:space:]]+)?id:[[:space:]]+devflow-artifact-gate[[:space:]]*$' /tmp/dsh-web-config.yml; \
    grep -Eq -- '^[[:space:]]*(-[[:space:]]+)?id:[[:space:]]+devflow-agent-gate[[:space:]]*$' /tmp/dsh-web-config.yml; \
    grep -Eq -- '^[[:space:]]*(-[[:space:]]+)?id:[[:space:]]+byclaw-browser-use[[:space:]]*$' /tmp/dsh-web-config.yml; \
    grep -Eq -- '^[[:space:]]*(-[[:space:]]+)?id:[[:space:]]+byclaw-idle-reporter[[:space:]]*$' /tmp/dsh-web-config.yml; \
    ! grep -q -- "baseUrl:" /tmp/dsh-web-config.yml; \
    rm -f /tmp/dsh-web-config.yml

COPY --chown=byclaw:byclaw middleware/builtin/ /opt/byclaw/builtin/
COPY --chown=byclaw:byclaw middleware/builtin/skills/ /opt/byclaw/dsh-managed/skills/
COPY --chown=byclaw:byclaw --chmod=0755 middleware/byclaw-harness/docker-entrypoint.sh /usr/local/bin/byclaw-dsh-entrypoint
COPY --chmod=0755 middleware/byclaw-harness/scripts/dsh-loopback-forward.mjs /usr/local/lib/byclaw/dsh-loopback-forward.mjs
COPY --chmod=0755 middleware/byclaw-harness/scripts/byclaw-bycli-managed.py /usr/local/bin/byclaw-bycli-managed
COPY --chmod=0755 middleware/byclaw-harness/scripts/byclaw-browser-supervisor.py /usr/local/bin/byclaw-browser-supervisor
COPY --chmod=0755 middleware/byclaw-harness/scripts/browser-supervisor-verify.py /tmp/browser-supervisor-verify.py
COPY --chmod=0755 middleware/byclaw-harness/scripts/browser-download-permissions-verify.py /tmp/browser-download-permissions-verify.py
COPY --chmod=0755 middleware/byclaw-harness/scripts/docker-entrypoint-fd-verify.py /tmp/docker-entrypoint-fd-verify.py
COPY middleware/byclaw-harness/browser/novnc-index.html /usr/local/share/byclaw-browser/novnc-index.html

USER root

RUN python -m pip install --no-cache-dir \
        "by-framework==0.2.2.dev10" \
        /opt/byclaw/builtin/python-clis/kbcli \
        /opt/byclaw/builtin/python-clis/groksearchcli \
        /opt/byclaw/builtin/python-clis/callcli \
        "/opt/byclaw/builtin/python-clis/dbcli[all]" \
    && python -m pip check \
    && kbcli --help >/dev/null \
    && groksearchcli --help >/dev/null \
    && callcli --help >/dev/null \
    && dbcli --help >/dev/null

# knowledge-collection's no-key search provider is a runtime dependency,
# not part of the copied skill payload or the generic DSH base.
COPY middleware/byclaw-harness/scripts/install-search-runtime.sh middleware/byclaw-harness/scripts/searxng-cli-constraints.txt /tmp/byclaw-search-runtime/
COPY middleware/byclaw-harness/scripts/searxng-cli/ /tmp/byclaw-search-runtime/searxng-cli/
# Optional mounted wheelhouse; versions remain constrained by the lock-derived file.
ARG SEARXNG_WHEELHOUSE
RUN sh /tmp/byclaw-search-runtime/install-search-runtime.sh \
        /tmp/byclaw-search-runtime/searxng-cli/searxng_pack_settings.yml \
        /tmp/byclaw-search-runtime/searxng-cli-constraints.txt \
    && /opt/searxng-cli-venv/bin/python -m pip check \
    && su -s /bin/sh byclaw -c 'searxng-cli --list-engines >/dev/null' \
    && rm -rf /tmp/byclaw-search-runtime

COPY --from=connector-tools /opt/nvm/current/lib/node_modules/@wecom/ /opt/nvm/current/lib/node_modules/@wecom/
COPY --from=connector-tools /opt/nvm/current/lib/node_modules/@larksuite/ /opt/nvm/current/lib/node_modules/@larksuite/
RUN ln -sf ../lib/node_modules/@wecom/cli/bin/wecom.js /opt/nvm/current/bin/wecom-cli \
    && ln -sf ../lib/node_modules/@larksuite/cli/scripts/run.js /opt/nvm/current/bin/lark-cli

RUN npm install --global --ignore-scripts "@sovovs/bycli@${BYCLI_VERSION}" \
    && test "$(bycli --version)" = "${BYCLI_VERSION}" \
    && test -f /opt/nvm/current/lib/node_modules/@sovovs/bycli/extension/manifest.json \
    && node -e 'const manifest = require("/opt/nvm/current/lib/node_modules/@sovovs/bycli/extension/manifest.json"); if (manifest.version !== process.argv[1] || !manifest.permissions?.includes("system.display")) process.exit(1)' "${BYCLI_EXTENSION_VERSION}" \
    && npm cache clean --force
RUN ln -sf /usr/local/bin/byclaw-bycli-managed /opt/nvm/current/bin/bycli

RUN set -eux; \
    novnc_source=''; \
    for candidate in /usr/share/novnc /usr/share/noVNC; do \
        if [ -d "${candidate}" ]; then novnc_source="${candidate}"; break; fi; \
    done; \
    test -n "${novnc_source}"; \
    mkdir -p /opt/byclaw/novnc; \
    cp -a "${novnc_source}/." /opt/byclaw/novnc/; \
    cp /usr/local/share/byclaw-browser/novnc-index.html /opt/byclaw/novnc/index.html; \
    test -f /opt/byclaw/novnc/core/rfb.js; \
    browser_path="$(node -e "const { chromium } = require('/opt/nvm/current/lib/node_modules/playwright'); process.stdout.write(chromium.executablePath())")"; \
    test -x "${browser_path}"; \
    ln -s "${browser_path}" /usr/local/bin/byclaw-playwright-chromium; \
    ln -s "${browser_path}" /usr/local/bin/chromium; \
    /usr/local/bin/chromium --version; \
    test -f /opt/byclaw/dsh-managed/profiles/web/node_modules/@byclaw/dsh-browser-use/lib/browserd.js; \
    test -f /opt/byclaw/dsh-managed/profiles/web/node_modules/@byclaw/dsh-browser-use/scripts/vnc-isolation-integration.mjs; \
    chown -R root:root /opt/byclaw/novnc /usr/local/share/byclaw-browser; \
    chmod -R a=rX /opt/byclaw/novnc /usr/local/share/byclaw-browser; \
    python3 /tmp/browser-download-permissions-verify.py; \
    BYCLAW_TEST_SUPERVISOR=/usr/local/bin/byclaw-browser-supervisor \
        python3 /tmp/browser-supervisor-verify.py; \
    BYCLAW_TEST_ENTRYPOINT=/usr/local/bin/byclaw-dsh-entrypoint \
        BYCLAW_TEST_SECRET_HELPER=/opt/byclaw/dsh-managed/profiles/web/node_modules/@byclaw/dsh-browser-use/lib/secret-fd.js \
        python3 /tmp/docker-entrypoint-fd-verify.py; \
    rm -f /tmp/browser-download-permissions-verify.py \
        /tmp/browser-supervisor-verify.py /tmp/docker-entrypoint-fd-verify.py; \
    chown -R byclaw:byclaw /home/byclaw/.dsh

# Tool environment (B) of the opt-in split deployment (plugins/dsh-tool-env):
# `byclaw-dsh-entrypoint tools` runs this sshd for DSH's SSH helper. The
# package's generated host keys are removed; B serves the key its runtime (A)
# hands it at creation.
RUN apt-get update && apt-get install -y --no-install-recommends openssh-server python3 python3-websockets \
    && rm -rf /var/lib/apt/lists/* /etc/ssh/ssh_host_* \
    && test -x /usr/sbin/sshd
COPY --chmod=0755 middleware/byclaw-harness/plugins/dsh-tool-env/scripts/tool-env-sshd.sh /usr/local/bin/byclaw-tool-env-sshd
# WebSocket bridge to sshd for runtimes behind an HTTP ingress (BYCLAW_TOOL_ENV_WS_PORT).
COPY --chmod=0755 middleware/byclaw-harness/plugins/dsh-tool-env/scripts/ws-bridge.py /usr/local/bin/byclaw-tool-env-ws-bridge

ENV BYCLAW_BROWSER_EXECUTABLE_PATH=/usr/local/bin/byclaw-playwright-chromium \
    BYCLAW_BROWSER_NOVNC_DIR=/opt/byclaw/novnc

EXPOSE 8081

ENTRYPOINT ["/usr/local/bin/byclaw-dsh-entrypoint"]
CMD ["web"]
