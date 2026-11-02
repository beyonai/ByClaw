#!/usr/bin/env bash
set -Eeuo pipefail

# Tool environment (B) of a split deployment: serve DSH's SSH helper only. The
# runtime (A) that started this sandbox owns the browser, Web UI and sessions.
if [[ "${1:-}" == tools ]]; then
    # B's home may be a persistent per-user volume (credentials, CLI state and
    # installs survive B being released). Start it from the image's own home and
    # add defaults a newer image brings, without touching what the user changed.
    tool_home="${BYCLAW_TOOL_HOME:-/home/byclaw}"
    tool_home_seed="${BYCLAW_TOOL_HOME_SEED:-/usr/local/share/byclaw-tool-home}"
    if [[ -d "${tool_home_seed}" ]]; then
        mkdir -p "${tool_home}"
        rsync -a --ignore-existing "${tool_home_seed}/" "${tool_home}/"
        if ((EUID == 0)); then
            chown byclaw:byclaw "${tool_home}"
        fi
    fi
    tool_env_server="${BYCLAW_TOOL_ENV_SERVER:-/usr/local/bin/byclaw-tool-env-sshd}"
    # Second stage, run by the browser supervisor below: serve SSH without the
    # broker secret descriptor or variables (sessions read the secret file instead).
    if [[ "${2:-}" == --serve ]]; then
        if [[ "${BYCLAW_BROWSER_SECRET_FD:-}" =~ ^[0-9]+$ ]]; then
            eval "exec ${BYCLAW_BROWSER_SECRET_FD}<&-"
        fi
        unset BYCLAW_BROWSER_SECRET_FD BYCLAW_BROWSER_SECRET BYCLAW_DSH_PREPARED
        exec "${tool_env_server}"
    fi
    # The same browser the user's own sandbox ran: one supervised Chromium with the
    # byCLI extension and daemon, one desktop (shared noVNC on 8081), started on
    # first use. The native browser tool attaches to it over the socket.
    if [[ "${BYCLAW_TOOL_BROWSER:-1}" != 0 ]]; then
        # The flattened image keeps few ENV lines; the harness image's settings the
        # supervisor reads (viewer, startup, byCLI, ports) were recorded for SSH
        # sessions. Values this sandbox was started with win.
        session_env="${BYCLAW_TOOL_ENV_SESSION_ENV:-/etc/byclaw-tool-env.session-env}"
        if [[ -r "${session_env}" ]]; then
            while IFS= read -r assignment; do
                name="${assignment%%=*}"
                [[ "${assignment}" == *=* && "${name}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ && ! -v "${name}" ]] || continue
                export "${assignment}"
            done <"${session_env}"
        fi
        browser_run=/run/byclaw-browser
        export BYCLAW_BROWSER_SOCKET="${browser_run}/browserd.sock"
        # The profile the user's own sandbox kept in its DSH home, on the user's volume.
        export BYCLAW_BROWSER_USER_DATA_DIR="${BYCLAW_TOOL_BROWSER_USER_DATA_DIR:-/by/byclaw/.dsh/browser/user-data}"
        # BE reaches the daemon through the sandbox's `bycli` endpoint.
        export BYCLI_DAEMON_HOST="${BYCLI_DAEMON_HOST:-0.0.0.0}"
        if ((EUID == 0)); then
            install -d -m 0700 -o byclaw -g byclaw \
                "${browser_run}" "${browser_run}/downloads" \
                "${browser_run}/screenshots" "${browser_run}/sessions"
        fi
        exec "${BYCLAW_TOOL_BROWSER_SUPERVISOR:-/usr/local/bin/byclaw-browser-supervisor}" \
            --browser-user byclaw \
            --dsh-user root \
            --socket-path "${BYCLAW_BROWSER_SOCKET}" \
            --secret-file "${browser_run}/broker.secret" \
            --readiness-timeout 60 \
            --activation-port 19825 \
            -- "${BASH}" "$0" tools --serve
    fi
    exec "${tool_env_server}"
fi

# Shared DSH host: one process serving many users (scripts/byclaw-multi-host.mjs).
# It runs as the DSH user; each user context owns its own browser runtime, so
# the root browser supervisor below is not involved.
if [[ "${1:-}" == multi-host ]]; then
    shift
    launcher=/workspace/scripts/byclaw-multi-host.mjs
    if ((EUID == 0)); then
        host_root="${BYCLAW_MULTI_HOST_ROOT-/data/multi-host}"
        python3 - "${host_root}" <<'BYCLAW_SHARED_ROOT'
import os
import pwd
import stat
import sys


def prepare_host_root(path, uid, gid):
    parts = path.split('/')[1:]
    if not path.startswith('/') or not parts or any(p in ('', '.', '..') for p in parts):
        raise RuntimeError('Shared host root must be an absolute directory path')
    user_root = os.environ.get('BYCLAW_MULTI_HOST_USER_ROOT')
    if user_root:
        if not os.path.isabs(user_root) or os.path.commonpath([path, user_root]) in (path, user_root):
            raise RuntimeError('Shared host root must be separate from user storage')
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    parent = os.open('/', flags)
    try:
        for part in parts[:-1]:
            created = False
            try:
                child = os.open(part, flags, dir_fd=parent)
            except FileNotFoundError:
                try:
                    os.mkdir(part, 0o755, dir_fd=parent)
                    created = True
                except FileExistsError:
                    pass
                child = os.open(part, flags, dir_fd=parent)
            info = os.fstat(child)
            if created:
                if info.st_uid != os.geteuid():
                    os.close(child)
                    raise RuntimeError('Shared host parent changed during creation')
                # The bootstrap uses umask 077; parents still need traversal after setpriv.
                os.fchmod(child, 0o755)
            if info.st_uid not in (0, uid) or (info.st_mode & 0o022 and not info.st_mode & stat.S_ISVTX):
                os.close(child)
                raise RuntimeError('Untrusted shared host parent directory')
            os.close(parent)
            parent = child
        try:
            os.mkdir(parts[-1], 0o700, dir_fd=parent)
        except FileExistsError:
            pass
        directory = os.open(parts[-1], flags, dir_fd=parent)
        try:
            info = os.fstat(directory)
            if info.st_uid not in (0, uid) or info.st_mode & 0o022:
                raise RuntimeError('Untrusted shared host root directory')
            if info.st_uid != uid or info.st_gid != gid:
                os.fchown(directory, uid, gid)
            os.fchmod(directory, 0o700)
        finally:
            os.close(directory)
    finally:
        os.close(parent)


if __name__ == '__main__':
    account = pwd.getpwnam('byclaw')
    prepare_host_root(sys.argv[1], account.pw_uid, account.pw_gid)
BYCLAW_SHARED_ROOT
        exec setpriv --reuid=byclaw --regid=byclaw --init-groups \
            env HOME=/home/byclaw node "${launcher}" "$@"
    fi
    exec node "${launcher}" "$@"
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
