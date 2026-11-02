#!/usr/bin/env bash
set -euo pipefail

# Run against a built image on a Linux Docker host. Only disposable data is used.
image=${1:?Usage: bash middleware/tenant/opengauss/test-persistence.sh IMAGE}
container="byclaw-opengauss-persistence-test-$$"
workdir=$(mktemp -d)
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  docker run --rm --user 0:0 --entrypoint bash \
    --mount "type=bind,src=$workdir,dst=/smoke" "$image" \
    -c 'rm -rf /smoke/data' >/dev/null 2>&1 || true
  rmdir "$workdir" 2>/dev/null || true
}
trap cleanup EXIT

docker run --rm --entrypoint bash "$image" /usr/local/bin/byclaw-opengauss-verify-runtime

identity=$(docker run --rm --entrypoint bash "$image" -c 'printf "%s:%s" "$(id -u)" "$(id -g)"')
if [[ "$identity" != '1001:1001' ]]; then
  echo "Expected default UID:GID 1001:1001, got $identity" >&2
  exit 1
fi
mkdir "$workdir/data"
docker run --rm --user 0:0 --entrypoint bash \
  --mount "type=bind,src=$workdir/data,dst=/smoke" "$image" \
  -c 'chown 1001:1001 /smoke && chmod 700 /smoke'

password="Aa1@$(od -An -N12 -tx1 /dev/urandom | tr -d ' \n')"
start_database() {
  docker run -d --name "$container" --cap-add SYS_NICE \
    --mount "type=bind,src=$workdir/data,dst=/var/lib/opengauss/data" \
    -e GS_PASSWORD="$password" -e GS_USERNAME=persistence_admin \
    -e GS_DB=persistence_smoke --entrypoint python3 "$image" \
    /var/lib/opengauss/byclaw-tenant-entrypoint.py gaussdb >/dev/null
  for ((attempt = 0; attempt < 90; attempt++)); do
    if docker exec "$container" bash -lc \
      'gsql -U omm -d persistence_smoke -At -c "SELECT 1;"' >/dev/null 2>&1; then
      return
    fi
    if [[ $(docker inspect -f '{{.State.Running}}' "$container") != true ]]; then
      echo 'Database exited before becoming ready' >&2
      return 1
    fi
    sleep 1
  done
  echo 'Database did not become ready within 90 seconds' >&2
  return 1
}

start_database
docker exec "$container" bash -lc \
  'gsql -U omm -d persistence_smoke -v ON_ERROR_STOP=1 -c "CREATE TABLE persistence_probe (value integer); INSERT INTO persistence_probe VALUES (42);"' >/dev/null
docker stop -t 60 "$container" >/dev/null
docker rm "$container" >/dev/null
start_database
value=$(docker exec "$container" bash -lc \
  'gsql -U omm -d persistence_smoke -At -c "SELECT value FROM persistence_probe;"')
[[ "$value" == 42 ]]
owner=$(docker exec "$container" stat -c '%u:%g %a' /var/lib/opengauss/data)
[[ "$owner" == '1001:1001 700' ]]
echo 'PASS: default 1001:1001 can initialize a bind mount and retain data after container recreation'
