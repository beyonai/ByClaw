#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_root="$(mktemp -d)"
trap 'rm -rf "${test_root}"' EXIT

managed_home="${test_root}/managed-home"
dsh_home="${test_root}/persistent-home"
workspace="${test_root}/workspace"
capture="${test_root}/dsh-args"

mkdir -p \
  "${managed_home}/plugins/integration" \
  "${managed_home}/profiles/web" \
  "${managed_home}/profiles/web/node_modules/profile-package" \
  "${managed_home}/profiles/web/node_modules/test-plugin" \
  "${managed_home}/profiles/node_modules/fallback-package" \
  "${managed_home}/skills/devflow" \
  "${dsh_home}/plugins/stale" \
  "${dsh_home}/profiles/web" \
  "${managed_home}/profiles/web/.dsh-module-fallback/node_modules/runtime-package" \
  "${managed_home}/profiles/node_modules/peer-package" \
  "${dsh_home}/skills/stale" \
  "${dsh_home}/storages" \
  "${dsh_home}/agent-teams" \
  "${dsh_home}/agent-templates" \
  "${workspace}/node_modules/tsx"

printf '%s\n' 'integration-plugin' >"${managed_home}/plugins/integration/version"
printf '%s\n' 'web-profile' >"${managed_home}/profiles/web/package.json"
printf '%s\n' 'seed-patch' >"${managed_home}/profiles/web/cordis.patch.yml"
printf '%s\n' 'profile-module' >"${managed_home}/profiles/web/node_modules/profile-package/version"
printf '%s\n' 'fallback-module' >"${managed_home}/profiles/node_modules/fallback-package/version"
cat >"${managed_home}/profiles/web/node_modules/test-plugin/package.json" <<'EOF'
{"name":"test-plugin","type":"module","exports":"./index.js"}
EOF
cat >"${managed_home}/profiles/web/node_modules/test-plugin/index.js" <<'EOF'
import value from 'peer-package'
process.stdout.write(value)
EOF
printf '%s\n' 'devflow-skill' >"${managed_home}/skills/devflow/version"
printf '%s\n' 'stale-plugin' >"${dsh_home}/plugins/stale/version"
printf '%s\n' 'stale-profile' >"${dsh_home}/profiles/web/package.json"
printf '%s\n' 'stale-file' >"${dsh_home}/profiles/web/stale-file"
printf '%s\n' 'user-patch' >"${dsh_home}/profiles/web/cordis.patch.yml"
printf '%s\n' 'runtime-fallback' >"${managed_home}/profiles/web/.dsh-module-fallback/node_modules/runtime-package/version"
cat >"${managed_home}/profiles/node_modules/peer-package/package.json" <<'EOF'
{"name":"peer-package","type":"module","exports":"./index.js"}
EOF
printf '%s\n' "export default 'peer-resolution-ok'" >"${managed_home}/profiles/node_modules/peer-package/index.js"
printf '%s\n' 'session-data' >"${dsh_home}/storages/session"
printf '%s\n' 'team-data' >"${dsh_home}/agent-teams/team"
printf '%s\n' 'template-data' >"${dsh_home}/agent-templates/template"
printf '%s\n' 'credential-data' >"${dsh_home}/.credentials.yaml"
printf '%s\n' '999999999' >"${dsh_home}/.credentials.yaml.lock"

cat >"${workspace}/node_modules/tsx/package.json" <<'EOF'
{"name":"tsx","type":"module","exports":{"./esm":"./esm.mjs"}}
EOF
touch "${workspace}/node_modules/tsx/esm.mjs"
cat >"${workspace}/fake-dsh-cli.mjs" <<'EOF'
import { writeFileSync } from 'node:fs'
writeFileSync(process.env.BYCLAW_TEST_CAPTURE, `${process.argv.slice(2).join('\n')}\n`)
EOF

run_entrypoint() {
  env \
    DSH_HOME="${dsh_home}" \
    BYCLAW_DSH_MANAGED_HOME="${managed_home}" \
    BYCLAW_DSH_PREPARE_ONLY=1 \
    DSH_ROOT="${workspace}" \
    BYCLAW_DSH_CLI_ENTRY="${workspace}/fake-dsh-cli.mjs" \
    BYCLAW_TEST_CAPTURE="${capture}" \
    bash "${repo_root}/docker-entrypoint.sh" "$@"
  env \
    DSH_HOME="${dsh_home}" \
    BYCLAW_DSH_MANAGED_HOME="${managed_home}" \
    BYCLAW_DSH_PREPARED=1 \
    DSH_ROOT="${workspace}" \
    BYCLAW_DSH_CLI_ENTRY="${workspace}/fake-dsh-cli.mjs" \
    BYCLAW_TEST_CAPTURE="${capture}" \
    bash "${repo_root}/docker-entrypoint.sh" "$@"
}

run_entrypoint web --port 8080 --no-open

test ! -e "${dsh_home}/.credentials.yaml.lock"

for name in plugins skills; do
  test -L "${dsh_home}/${name}"
  test "$(readlink "${dsh_home}/${name}")" = "${managed_home}/${name}"
done
test "$(cat "${dsh_home}/plugins/integration/version")" = 'integration-plugin'
test ! -L "${dsh_home}/profiles"
test "$(cat "${dsh_home}/profiles/web/package.json")" = 'web-profile'
test "$(cat "${dsh_home}/profiles/web/cordis.patch.yml")" = 'user-patch'
test ! -e "${dsh_home}/profiles/web/stale-file"
test "$(cat "${dsh_home}/profiles/web/.dsh-module-fallback/node_modules/runtime-package/version")" = 'runtime-fallback'
test "$(readlink "${dsh_home}/profiles/web/node_modules")" = "${managed_home}/profiles/web/node_modules"
test ! -L "${managed_home}/profiles/node_modules"
test "$(readlink "${dsh_home}/profiles/node_modules")" = "${managed_home}/profiles/node_modules"
test "$(node "${dsh_home}/profiles/web/node_modules/test-plugin/index.js")" = 'peer-resolution-ok'
test "$(cat "${dsh_home}/skills/devflow/version")" = 'devflow-skill'
test "$(cat "${dsh_home}/storages/session")" = 'session-data'
test "$(cat "${dsh_home}/agent-teams/team")" = 'team-data'
test "$(cat "${dsh_home}/agent-templates/template")" = 'template-data'
test "$(cat "${dsh_home}/.credentials.yaml")" = 'credential-data'
diff -u <(printf '%s\n' web --host 0.0.0.0 --port 8080 --no-open) "${capture}"

# A lock whose recorded process still exists may belong to a live writer and
# must never be removed by startup recovery.
printf '%s\n' "$$" >"${dsh_home}/.credentials.yaml.lock"
env \
  DSH_HOME="${dsh_home}" \
  BYCLAW_DSH_MANAGED_HOME="${managed_home}" \
  BYCLAW_DSH_PREPARE_ONLY=1 \
  bash "${repo_root}/docker-entrypoint.sh"
test "$(cat "${dsh_home}/.credentials.yaml.lock")" = "$$"
rm "${dsh_home}/.credentials.yaml.lock"

# Repeated starts keep the managed links and preserve an explicit host.
run_entrypoint web --host 127.0.0.1 --port 8081
diff -u <(printf '%s\n' web --host 127.0.0.1 --port 8081) "${capture}"

# Other DSH commands pass through unchanged.
run_entrypoint headless --help
diff -u <(printf '%s\n' headless --help) "${capture}"

# The supervisor prepares managed state before creating the secret FD. Its
# prepared child must exec DSH without rerunning any filesystem subprocesses.
prepared_capture="${test_root}/prepared-dsh-args"
env \
  DSH_HOME="${test_root}/prepared-home-does-not-exist" \
  BYCLAW_DSH_MANAGED_HOME="${test_root}/managed-home-does-not-exist" \
  BYCLAW_DSH_PREPARED=1 \
  DSH_ROOT="${workspace}" \
  BYCLAW_DSH_CLI_ENTRY="${workspace}/fake-dsh-cli.mjs" \
  BYCLAW_TEST_CAPTURE="${prepared_capture}" \
  bash "${repo_root}/docker-entrypoint.sh" web --port 8082 --no-open
diff -u <(printf '%s\n' web --host 0.0.0.0 --port 8082 --no-open) "${prepared_capture}"

printf '%s\n' 'docker entrypoint verification passed'
