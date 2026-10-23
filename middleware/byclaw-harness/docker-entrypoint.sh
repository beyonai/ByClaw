#!/usr/bin/env bash
set -Eeuo pipefail

# Tool environment (B) of a split deployment: serve DSH's SSH helper only. The
# runtime (A) that started this sandbox owns the browser, Web UI and sessions.
if [[ "${1:-}" == tools ]]; then
    exec /usr/local/bin/byclaw-tool-env-sshd
fi

# Shared DSH host: one process serving many users (scripts/byclaw-multi-host.mjs).
# It runs as the DSH user; each user context owns its own browser runtime, so
# the root browser supervisor below is not involved.
if [[ "${1:-}" == multi-host ]]; then
    shift
    launcher=/workspace/scripts/byclaw-multi-host.mjs
    if ((EUID == 0)); then
        exec setpriv --reuid=byclaw --regid=byclaw --init-groups \
            env HOME=/home/byclaw node --import tsx/esm "${launcher}" "$@"
    fi
    exec node --import tsx/esm "${launcher}" "$@"
fi

if [[ "${BYCLAW_DSH_PREPARED:-0}" != 1 && "${BYCLAW_DSH_PREPARE_ONLY:-0}" != 1 ]]; then
    if ((EUID != 0)); then
        printf 'byclaw-dsh: root entrypoint required for private browser runtime\n' >&2
        exit 1
    fi
    install -d -m 0700 -o byclaw -g byclaw \
        /run/byclaw-browser /run/byclaw-browser/downloads \
        /run/byclaw-browser/screenshots /run/byclaw-browser/sessions
    exec /usr/local/bin/byclaw-browser-supervisor \
        --browser-user byclaw \
        --dsh-user byclaw \
        --socket-path /run/byclaw-browser/browserd.sock \
        --readiness-timeout 60 \
        --prepare-command /usr/local/bin/byclaw-dsh-entrypoint \
        -- /usr/local/bin/byclaw-dsh-entrypoint "$@"
fi

if [[ "${BYCLAW_DSH_PREPARED:-0}" != 1 ]]; then
    managed_home="${BYCLAW_DSH_MANAGED_HOME:-/opt/byclaw/dsh-managed}"
    dsh_home="${DSH_HOME:-/home/byclaw/.dsh}"
    managed_links_changed=false

recover_stale_credentials_lock() {
    local lock_path="${dsh_home}/.credentials.yaml.lock"
    local owner_pid=''

    [[ -e "${lock_path}" ]] || return 0
    IFS= read -r owner_pid <"${lock_path}" || true
    if [[ "${owner_pid}" =~ ^[0-9]+$ ]] && kill -0 "${owner_pid}" 2>/dev/null; then
        printf 'byclaw-dsh: preserving live credentials writer lock owned by pid %s\n' "${owner_pid}" >&2
        return
    fi
    rm -- "${lock_path}"
    printf 'byclaw-dsh: removed stale credentials writer lock %s (owner pid %s is not running)\n' \
        "${lock_path}" "${owner_pid:-unknown}" >&2
}

link_managed_directory() {
    local source="$1"
    local target="$2"

    test -d "${source}"
    if [[ -L "${target}" && "$(readlink "${target}")" == "${source}" ]]; then
        return
    fi
    rm -rf -- "${target}"
    ln -s "${source}" "${target}"
    managed_links_changed=true
}

# Plugin code and builtin skills are image-owned. The web profile keeps its
# user patch in the persistent volume while image-managed manifests and module
# links are refreshed on every start.
mkdir -p "${dsh_home}"
recover_stale_credentials_lock
link_managed_directory "${managed_home}/plugins" "${dsh_home}/plugins"
link_managed_directory "${managed_home}/skills" "${dsh_home}/skills"

managed_profile="${managed_home}/profiles/web"
persistent_profile="${dsh_home}/profiles/web"
test -d "${managed_profile}"
mkdir -p "${persistent_profile}"
rsync -a --delete \
    --exclude cordis.patch.yml \
    --exclude .dsh-module-fallback \
    --exclude node_modules \
    "${managed_profile}/" "${persistent_profile}/"
if [[ ! -e "${persistent_profile}/cordis.patch.yml" ]]; then
    cp "${managed_profile}/cordis.patch.yml" "${persistent_profile}/cordis.patch.yml"
fi

# Generated dependency links belong to this image generation, not the user's
# NAS. Preserve the build-time installation fallback and heal profile-only links
# locally. User patches and all business data still live in DSH_HOME.
mkdir -p "${managed_home}/profiles/node_modules" "${managed_profile}/.dsh-module-fallback/node_modules"
link_managed_directory \
    "${managed_home}/profiles/node_modules" \
    "${dsh_home}/profiles/node_modules"
link_managed_directory \
    "${managed_profile}/.dsh-module-fallback" \
    "${persistent_profile}/.dsh-module-fallback"

if [[ -d "${managed_profile}/node_modules" ]]; then
    link_managed_directory \
        "${managed_profile}/node_modules" \
        "${persistent_profile}/node_modules"
fi

if [[ "${managed_links_changed}" == true ]]; then
    printf 'byclaw-dsh: linked image-managed plugins, profile modules and skills into %s\n' "${dsh_home}"
fi

    if [[ "${BYCLAW_DSH_PREPARE_ONLY:-0}" == 1 ]]; then
        exit 0
    fi
fi

cd "${DSH_ROOT:-/workspace}"

# Split tool environment (plugins/dsh-tool-env): commands run in the separate
# tool sandbox B, which holds only the user's workspace. B is the isolation
# boundary; per-command bwrap/Landlock confinement inside it is unavailable on
# container hosts that block user namespaces, where workspace-write would refuse
# every command. An explicit DSH_PERMISSION_MODE still wins.
case "${BYCLAW_DSH_TOOL_ENV:-}" in
    static|opensandbox|byclaw-be)
        export DSH_PERMISSION_MODE="${DSH_PERMISSION_MODE:-${BYCLAW_TOOL_ENV_PERMISSION_MODE:-danger-full-access}}"
        ;;
esac

# 默认启动 web profile；传入参数时允许覆盖为 headless 或其他 dsh 命令参数。
if (($# == 0)); then
    set -- web
fi

# The sandbox launcher may omit --host. Bind web to the container interface by
# default while preserving any explicit host supplied by the caller.
# Extra Node preloads for the CLI; the TypeScript loader is added only for a .ts entry.
node_imports=()
if [[ "$1" == web ]]; then
    web_host=''
    web_port=3080
    previous=''
    for argument in "${@:2}"; do
        case "${previous}" in
            --host) web_host="${argument}" ;;
            --port) web_port="${argument}" ;;
        esac
        case "${argument}" in
            --host=*) web_host="${argument#--host=}" ;;
            --port=*) web_port="${argument#--port=}" ;;
        esac
        previous="${argument}"
    done
    if [[ "${previous}" == --host ]]; then
        web_host='--host'
    fi
    if [[ -z "${web_host}" ]]; then
        web_host=0.0.0.0
        set -- web --host 0.0.0.0 "${@:2}"
    fi
    # DSH 0.2 rejects wildcard listeners, so @byclaw/dsh-lan-web binds 0.0.0.0
    # to the container's own IPv4 address and loopback goes unserved. Mirror the
    # Web port on 127.0.0.1 for in-container clients such as the sandbox execd
    # /proxy/<port> route; the forwarder dials the bound address, so DSH sees
    # the same Host header and authentication as a direct LAN request.
    loopback_forwarder="${BYCLAW_DSH_LOOPBACK_FORWARDER:-/usr/local/lib/byclaw/dsh-loopback-forward.mjs}"
    if [[ "${web_host}" == 0.0.0.0 && "${web_port}" =~ ^[1-9][0-9]*$ && -f "${loopback_forwarder}" ]]; then
        export BYCLAW_DSH_LOOPBACK_PORT="${web_port}"
        node_imports+=(--import "${loopback_forwarder}")
    fi
fi

# Keep the supervisor-provided secret descriptor alive until the browser plugin
# consumes it. pnpm/bash wrappers may close inherited descriptors before Node.
cli_entry="${BYCLAW_DSH_CLI_ENTRY:-apps/cli/lib/bin.js}"
printf 'byclaw-dsh: starting CLI at %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >&2
case "${cli_entry}" in
    *.ts) exec node --import tsx/esm "${node_imports[@]}" "${cli_entry}" "$@" ;;
    apps/cli/lib/bin.js|*/apps/cli/lib/bin.js)
        exec node --require /usr/local/lib/byclaw/startup-module-resolver.cjs "${node_imports[@]}" "${cli_entry}" "$@" ;;
    *) exec node "${node_imports[@]}" "${cli_entry}" "$@" ;;
esac
