#!/bin/sh
# Tool environment (B) entry: serve DSH's SSH helper to exactly one A.
#
# A starts B with:
#   BYCLAW_TOOL_ENV_AUTHORIZED_KEY  OpenSSH public key line A logs in with
#   BYCLAW_TOOL_ENV_HOST_KEY        base64 OpenSSH private host key A pins
#   BYCLAW_TOOL_ENV_PORT            listen port (default 22)
#   BYCLAW_TOOL_ENV_USER            login user (default byclaw)
#   BYCLAW_TOOL_ENV_RUN_DIR         config/key directory (default /run/byclaw-tool-env)
# sshd only accepts that key for that user, allows the Unix-socket forwarding
# DSH streams need, and nothing else: no passwords, root, reverse or agent forwarding.
set -eu

: "${BYCLAW_TOOL_ENV_AUTHORIZED_KEY:?BYCLAW_TOOL_ENV_AUTHORIZED_KEY is required}"
: "${BYCLAW_TOOL_ENV_HOST_KEY:?BYCLAW_TOOL_ENV_HOST_KEY is required}"
port="${BYCLAW_TOOL_ENV_PORT:-22}"
user="${BYCLAW_TOOL_ENV_USER:-byclaw}"
run_dir="${BYCLAW_TOOL_ENV_RUN_DIR:-/run/byclaw-tool-env}"
sshd="${BYCLAW_TOOL_ENV_SSHD:-/usr/sbin/sshd}"

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
exec "${sshd}" -D -e -f "${run_dir}/sshd_config"
