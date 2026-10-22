#!/bin/sh
# Tool environment (B) entry: serve DSH's SSH helper to exactly one A.
#
# A starts B with:
#   BYCLAW_TOOL_ENV_AUTHORIZED_KEY  OpenSSH public key line A logs in with
#   BYCLAW_TOOL_ENV_HOST_KEY        base64 OpenSSH private host key A pins
#   BYCLAW_TOOL_ENV_SEED_DIR        fallback for the two above when B is created
#                                   by ByClaw BE from a spec, which cannot carry
#                                   A's keys: A's tool-env state directory mounted
#                                   read-only, holding `client_ed25519.pub` and
#                                   `host_ed25519` (default /etc/byclaw-tool-env)
#   BYCLAW_TOOL_ENV_PORT            listen port (default 22)
#   BYCLAW_TOOL_ENV_WS_PORT         also serve a WebSocket bridge to sshd on this port
#                                   (scripts/ws-bridge.py), for runtimes behind an HTTP
#                                   ingress; unset = sshd only
#   BYCLAW_TOOL_ENV_USER            login user (default byclaw)
#   BYCLAW_TOOL_ENV_RUN_DIR         config/key directory (default /run/byclaw-tool-env)
# sshd only accepts that key for that user, allows the Unix-socket forwarding
# DSH streams need, and nothing else: no passwords, root, reverse or agent forwarding.
set -eu

seed_dir="${BYCLAW_TOOL_ENV_SEED_DIR:-/etc/byclaw-tool-env}"
if [ -z "${BYCLAW_TOOL_ENV_AUTHORIZED_KEY:-}" ] && [ -r "${seed_dir}/client_ed25519.pub" ]; then
    BYCLAW_TOOL_ENV_AUTHORIZED_KEY="$(cat "${seed_dir}/client_ed25519.pub")"
fi
if [ -z "${BYCLAW_TOOL_ENV_HOST_KEY:-}" ] && [ -r "${seed_dir}/host_ed25519" ]; then
    BYCLAW_TOOL_ENV_HOST_KEY="$(base64 <"${seed_dir}/host_ed25519" | tr -d '\n')"
fi
: "${BYCLAW_TOOL_ENV_AUTHORIZED_KEY:?BYCLAW_TOOL_ENV_AUTHORIZED_KEY is required (or ${seed_dir}/client_ed25519.pub)}"
: "${BYCLAW_TOOL_ENV_HOST_KEY:?BYCLAW_TOOL_ENV_HOST_KEY is required (or ${seed_dir}/host_ed25519)}"
port="${BYCLAW_TOOL_ENV_PORT:-22}"
user="${BYCLAW_TOOL_ENV_USER:-byclaw}"
run_dir="${BYCLAW_TOOL_ENV_RUN_DIR:-/run/byclaw-tool-env}"
sshd="${BYCLAW_TOOL_ENV_SSHD:-/usr/sbin/sshd}"
ws_port="${BYCLAW_TOOL_ENV_WS_PORT:-}"
ws_bridge="${BYCLAW_TOOL_ENV_WS_BRIDGE:-/usr/local/bin/byclaw-tool-env-ws-bridge}"

umask 077
mkdir -p "${run_dir}" /run/sshd
chmod 0755 "${run_dir}" /run/sshd
printf '%s' "${BYCLAW_TOOL_ENV_HOST_KEY}" | base64 -d >"${run_dir}/host_ed25519_key"
chmod 0600 "${run_dir}/host_ed25519_key"
printf '%s\n' "${BYCLAW_TOOL_ENV_AUTHORIZED_KEY}" >"${run_dir}/authorized_keys"
chmod 0644 "${run_dir}/authorized_keys"

# Without PAM, sshd refuses accounts whose password field is locked ("!..."),
# even for key logins. Mark the tool user as "no password" instead.
if [ "$(id -u)" = 0 ] && getent shadow "${user}" | cut -d: -f2 | grep -q '^!'; then
    usermod -p '*' "${user}"
fi

cat >"${run_dir}/sshd_config" <<EOF
Port ${port}
ListenAddress 0.0.0.0
HostKey ${run_dir}/host_ed25519_key
PidFile ${run_dir}/sshd.pid
AuthorizedKeysFile ${run_dir}/authorized_keys
StrictModes no
AllowUsers ${user}
PermitRootLogin no
PubkeyAuthentication yes
PasswordAuthentication no
KbdInteractiveAuthentication no
UsePAM no
AllowAgentForwarding no
# OpenSSH gates Unix-socket forwards on the TCP settings too: "AllowTcpForwarding
# no" and any PermitOpen list (even "none") refuse DSH's stream sockets. Local
# forwarding is therefore open, but only to the single key holder, A, which
# already controls everything B runs. Remote (reverse) forwarding stays off.
AllowTcpForwarding local
PermitListen none
AllowStreamLocalForwarding local
StreamLocalBindUnlink yes
X11Forwarding no
PermitTunnel no
PermitUserEnvironment no
PrintMotd no
MaxSessions 64
MaxStartups 32:50:128
ClientAliveInterval 15
ClientAliveCountMax 4
LogLevel INFO
EOF
# The host key and authorized key never need to stay in the environment of
# anything sshd starts.
unset BYCLAW_TOOL_ENV_HOST_KEY BYCLAW_TOOL_ENV_AUTHORIZED_KEY
if [ -z "${ws_port}" ]; then
    exec "${sshd}" -D -e -f "${run_dir}/sshd_config"
fi
# Bridge mode: sshd in the background, the bridge as the container's main process so
# the sandbox ends when either side is gone.
"${sshd}" -D -e -f "${run_dir}/sshd_config" &
sshd_pid=$!
trap 'kill "${sshd_pid}" 2>/dev/null' EXIT INT TERM
python3 "${ws_bridge}" --listen "${ws_port}" --target "127.0.0.1:${port}" &
bridge_pid=$!
wait "${bridge_pid}"
