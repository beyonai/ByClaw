#!/usr/bin/env bash
set -euo pipefail

# Run inside the tenant image, including at build time, before creating any data.
. /etc/os-release
case "$ID" in
  debian|ubuntu) ;;
  *) echo "MicroVM requires a Debian/Ubuntu rootfs; found $ID" >&2; exit 1 ;;
esac
for command in apt-get dpkg-query systemctl sshd sudo python3 gosu; do
  command -v "$command" >/dev/null
done
[[ "$(id -u):$(id -g)" == '1001:1001' ]]
[[ "$(id -un)" == omm ]]
[[ -d /var/lib/opengauss/data && -w /var/lib/opengauss/data ]]

export GAUSSHOME=/usr/local/opengauss
export PATH="$GAUSSHOME/bin:/scws/bin:$PATH"
export LD_LIBRARY_PATH="$GAUSSHOME/lib:/scws/lib:${LD_LIBRARY_PATH:-}"
for command in gaussdb gs_initdb gsql gs_ctl; do
  executable="$GAUSSHOME/bin/$command"
  dependencies="$(ldd "$executable")"
  if [[ "$dependencies" == *'not found'* ]]; then
    printf '%s\n' "$dependencies" >&2
    exit 1
  fi
  "$executable" --version
done
env -u LD_LIBRARY_PATH python3 /var/lib/opengauss/byclaw-tenant-entrypoint.py gaussdb --version
env -u LD_LIBRARY_PATH bash -lc 'command -v gsql >/dev/null && gsql --version'
echo 'PASS: Debian/Ubuntu system tools, tenant identity and OpenGauss runtime dependencies'
