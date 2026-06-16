#!/bin/sh
# ByClaw K3s + Longhorn one-click deploy entrypoint.
# Usage:
#   K3S_ENV_FILE=deploy/k3s/env.k3s sh deploy/k3s/deploy.sh init
#   K3S_ENV_FILE=deploy/k3s/env.k3s sh deploy/k3s/deploy.sh update
#   K3S_ENV_FILE=deploy/k3s/env.k3s sh deploy/k3s/deploy.sh storage-init
#   K3S_ENV_FILE=deploy/k3s/env.k3s sh deploy/k3s/deploy.sh monitoring-init
#   K3S_ENV_FILE=deploy/k3s/env.k3s sh deploy/k3s/deploy.sh render
#   K3S_ENV_FILE=deploy/k3s/env.k3s sh deploy/k3s/deploy.sh stop
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ACTION="${1:-}"
ENV_FILE="${K3S_ENV_FILE:-$SCRIPT_DIR/env.k3s}"
GENERATED_DIR="${K3S_GENERATED_DIR:-$SCRIPT_DIR/generated}"

case "$ENV_FILE" in
    /*) ;;
    *) ENV_FILE="$(pwd)/$ENV_FILE" ;;
esac

usage() {
    echo "Usage: sh deploy/k3s/deploy.sh init|cluster-init|storage-init|monitoring-init|render|update|stop"
    echo "  env file: $ENV_FILE (override with K3S_ENV_FILE=...)"
}

if [ -z "$ACTION" ]; then
    usage
    exit 1
fi

load_env() {
    if [ -f "$ENV_FILE" ]; then
        set -a
        . "$ENV_FILE"
        set +a
    else
        echo "Warning: $ENV_FILE not found, using $SCRIPT_DIR/env.k3s.example" >&2
        ENV_FILE="$SCRIPT_DIR/env.k3s.example"
        set -a
        . "$ENV_FILE"
        set +a
    fi
    K3S_DATA_DIR="${K3S_DATA_DIR:-/var/lib/rancher/k3s}"
    export K3S_DATA_DIR
    if [ -f "$K3S_DATA_DIR/server/kubeconfig" ]; then
        export KUBECONFIG="$K3S_DATA_DIR/server/kubeconfig"
    fi
}

require_kubectl() {
    if ! kubectl_cmd get nodes --request-timeout=15s >/dev/null 2>&1; then
        echo "Error: cannot reach k3s API for action '$ACTION'." >&2
        echo "Run this on a k3s server node, or export KUBECONFIG for the target cluster." >&2
        exit 1
    fi
}

kubectl_cmd() {
    if command -v k3s >/dev/null 2>&1; then
        sudo K3S_DATA_DIR="${K3S_DATA_DIR}" k3s kubectl "$@"
        return $?
    fi
    if command -v kubectl >/dev/null 2>&1; then
        kubectl "$@"
        return $?
    fi
    return 127
}

render_manifests() {
    echo "========== Rendering manifests =========="
    bash "$SCRIPT_DIR/render-manifests.sh" "$ENV_FILE" "$GENERATED_DIR"
}

install_cluster() {
    echo "========== Installing k3s cluster =========="
    bash "$SCRIPT_DIR/install-k3s.sh" "$ENV_FILE"
}

install_longhorn() {
    echo "========== Installing Longhorn =========="
    bash "$SCRIPT_DIR/install-longhorn.sh" "$ENV_FILE"
}

apply_longhorn_settings() {
    local storage_class="${STORAGE_CLASS:-longhorn}"
    local ns="${LONGHORN_NAMESPACE:-longhorn-system}"
    if [ "$storage_class" != "longhorn" ]; then
        return 0
    fi
    if ! kubectl_cmd -n "$ns" get settings.longhorn.io default-replica-count >/dev/null 2>&1; then
        return 0
    fi
    echo "========== Applying Longhorn settings =========="
    sed -e "s|\${LONGHORN_DATA_PATH}|${LONGHORN_DATA_PATH:-/data/longhorn}|g" \
        -e "s|\${LONGHORN_NAMESPACE}|${ns}|g" \
        -e "s|\${LONGHORN_REPLICA_COUNT}|${LONGHORN_REPLICA_COUNT:-3}|g" \
        "$SCRIPT_DIR/manifests/storage/longhorn-settings.yaml" | kubectl_cmd apply -f -
}

install_opensandbox_controller() {
    echo "========== Installing OpenSandbox controller =========="
    bash "$SCRIPT_DIR/install-opensandbox-controller.sh" "$ENV_FILE"
}

install_monitoring() {
    if [ "${BYCLAW_K3S_INSTALL_MONITORING:-true}" != "true" ]; then
        echo "========== Skipping monitoring =========="
        echo "    BYCLAW_K3S_INSTALL_MONITORING=${BYCLAW_K3S_INSTALL_MONITORING:-false}"
        return 0
    fi
    if [ "${MONITORING_ENABLED:-true}" != "true" ]; then
        echo "========== Skipping monitoring =========="
        echo "    MONITORING_ENABLED=${MONITORING_ENABLED:-false}"
        return 0
    fi
    echo "========== Installing Prometheus/Grafana monitoring =========="
    bash "$SCRIPT_DIR/install-monitoring.sh" "$ENV_FILE"
}

ensure_servicelb_node_pool() {
    if [ "${K3S_ENABLE_SERVICELB:-true}" != "true" ]; then
        return 0
    fi
    local node="${BYCLAW_K3S_SERVICELB_NODE_NAME:-${BYCLAW_K3S_INGRESS_NODE_NAME:-}}"
    local all_nodes n
    if [ -z "$node" ]; then
        node="$(kubectl_cmd get nodes -l node-role.kubernetes.io/control-plane -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
    fi
    if [ -z "$node" ]; then
        echo "Warning: cannot find control-plane node for ServiceLB exposure." >&2
        return 0
    fi
    echo "========== Ensuring K3s ServiceLB node pool =========="
    echo "    servicelb node: $node"
    kubectl_cmd label node "$node" svccontroller.k3s.cattle.io/enablelb=true --overwrite >/dev/null
    if [ "${BYCLAW_K3S_SERVICELB_EXCLUSIVE:-true}" = "true" ]; then
        all_nodes="$(kubectl_cmd get nodes -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null || true)"
        for n in $all_nodes; do
            [ "$n" = "$node" ] && continue
            kubectl_cmd label node "$n" svccontroller.k3s.cattle.io/enablelb- >/dev/null 2>&1 || true
        done
    fi
}

remove_traefik_hostport_patch() {
    if ! kubectl_cmd -n kube-system get deploy traefik >/dev/null 2>&1; then
        return 0
    fi
    # Older deployments patched Traefik itself with hostPort 80 while ServiceLB was disabled.
    # With ServiceLB enabled, svclb-traefik owns host ports 80/443.
    kubectl_cmd -n kube-system patch deploy traefik --type=json \
        -p='[{"op":"remove","path":"/spec/template/spec/containers/0/ports/2/hostPort"}]' >/dev/null 2>&1 || true
}

sync_registry_config() {
    if [ "${BYCLAW_K3S_SYNC_REGISTRIES_ON_UPDATE:-true}" != "true" ]; then
        return 0
    fi
    echo "========== Syncing k3s registry configuration =========="
    bash "$SCRIPT_DIR/install-k3s.sh" "$ENV_FILE" registry-sync
    refresh_longhorn_csi_after_k3s_restart
}

prune_empty_images() {
    if [ "${BYCLAW_K3S_PRUNE_EMPTY_IMAGES_ON_UPDATE:-true}" != "true" ]; then
        return 0
    fi
    echo "========== Pruning empty image refs after update =========="
    bash "$SCRIPT_DIR/install-k3s.sh" "$ENV_FILE" image-prune
}

refresh_longhorn_csi_after_k3s_restart() {
    local storage_class="${STORAGE_CLASS:-longhorn}"
    local ns="${LONGHORN_NAMESPACE:-longhorn-system}"
    local timeout="${BYCLAW_K3S_NODE_READY_WAIT_TIMEOUT_SECONDS:-300}"
    local deadline=$(( $(date +%s) + timeout ))
    local nodes ready total
    if [ "$storage_class" != "longhorn" ]; then
        return 0
    fi
    if ! kubectl_cmd get namespace "$ns" >/dev/null 2>&1; then
        return 0
    fi
    echo "========== Refreshing Longhorn CSI after k3s restart =========="
    while [ "$(date +%s)" -lt "$deadline" ]; do
        nodes="$(kubectl_cmd get nodes --no-headers 2>/dev/null || true)"
        total="$(printf '%s\n' "$nodes" | awk 'NF {count++} END {print count+0}')"
        ready="$(printf '%s\n' "$nodes" | awk '$2 == "Ready" && $3 !~ /SchedulingDisabled/ {count++} END {print count+0}')"
        echo "    ready nodes: ${ready}/${total}"
        if [ "$total" -gt 0 ] && [ "$ready" -eq "$total" ]; then
            break
        fi
        sleep 5
    done
    echo "    restarting longhorn-csi-plugin pods so kubelet re-registers driver.longhorn.io"
    kubectl_cmd -n "$ns" delete pod -l app=longhorn-csi-plugin --ignore-not-found=true
    kubectl_cmd -n "$ns" rollout status ds/longhorn-csi-plugin --timeout=180s
}

longhorn_csi_ready_once() {
    local storage_class="${STORAGE_CLASS:-longhorn}"
    local nodes node drivers
    if [ "$storage_class" != "longhorn" ]; then
        return 0
    fi
    nodes="$(kubectl_cmd get nodes --no-headers 2>/dev/null | awk '$2 == "Ready" && $3 !~ /SchedulingDisabled/ {print $1}' || true)"
    [ -n "$nodes" ] || return 1
    for node in $nodes; do
        drivers="$(kubectl_cmd get "csinode/$node" -o jsonpath='{range .spec.drivers[*]}{.name}{" "}{end}' 2>/dev/null || true)"
        printf '%s' "$drivers" | grep -qw 'driver.longhorn.io' || return 1
    done
    return 0
}

ensure_longhorn_csi_ready() {
    if longhorn_csi_ready_once; then
        wait_longhorn_csi_ready
        return 0
    fi
    local original_timeout="${BYCLAW_K3S_LONGHORN_CSI_WAIT_TIMEOUT_SECONDS:-}"
    BYCLAW_K3S_LONGHORN_CSI_WAIT_TIMEOUT_SECONDS="${BYCLAW_K3S_LONGHORN_CSI_STABILIZE_TIMEOUT_SECONDS:-90}"
    if wait_longhorn_csi_ready; then
        if [ -n "$original_timeout" ]; then
            BYCLAW_K3S_LONGHORN_CSI_WAIT_TIMEOUT_SECONDS="$original_timeout"
        else
            unset BYCLAW_K3S_LONGHORN_CSI_WAIT_TIMEOUT_SECONDS
        fi
        return 0
    fi
    if [ -n "$original_timeout" ]; then
        BYCLAW_K3S_LONGHORN_CSI_WAIT_TIMEOUT_SECONDS="$original_timeout"
    else
        unset BYCLAW_K3S_LONGHORN_CSI_WAIT_TIMEOUT_SECONDS
    fi
    if [ "${BYCLAW_K3S_REPAIR_LONGHORN_ON_UPDATE:-true}" = "true" ]; then
        echo "========== Longhorn CSI is incomplete; re-applying Longhorn =========="
        install_longhorn
    fi
    wait_longhorn_csi_ready
}

wait_longhorn_csi_ready() {
    local storage_class="${STORAGE_CLASS:-longhorn}"
    local ns="${LONGHORN_NAMESPACE:-longhorn-system}"
    local timeout="${BYCLAW_K3S_LONGHORN_CSI_WAIT_TIMEOUT_SECONDS:-600}"
    local interval="${BYCLAW_K3S_LONGHORN_CSI_WAIT_INTERVAL_SECONDS:-10}"
    local deadline=$(( $(date +%s) + timeout ))
    local attempt=1
    local nodes node missing drivers
    if [ "$storage_class" != "longhorn" ]; then
        return 0
    fi
    echo "========== Waiting for Longhorn CSI registration =========="
    echo "    required driver: driver.longhorn.io"
    echo "    namespace: $ns"
    while [ "$(date +%s)" -lt "$deadline" ]; do
        nodes="$(kubectl_cmd get nodes --no-headers 2>/dev/null | awk '$2 == "Ready" && $3 !~ /SchedulingDisabled/ {print $1}' || true)"
        missing=""
        echo "    attempt ${attempt}: checking CSINode driver registration"
        for node in $nodes; do
            drivers="$(kubectl_cmd get "csinode/$node" -o jsonpath='{range .spec.drivers[*]}{.name}{" "}{end}' 2>/dev/null || true)"
            if printf '%s' "$drivers" | grep -qw 'driver.longhorn.io'; then
                echo "      $node: driver.longhorn.io registered"
            else
                echo "      $node: MISSING driver.longhorn.io (drivers=${drivers:-<none>})"
                missing="${missing} ${node}"
            fi
        done
        if [ -n "$nodes" ] && [ -z "$missing" ]; then
            echo "    Longhorn CSI registered on all schedulable Ready nodes"
            return 0
        fi
        echo "    Longhorn system snapshot:"
        kubectl_cmd -n "$ns" get pods -o wide 2>/dev/null | sed 's/^/      /' || true
        echo "    recent Longhorn events:"
        kubectl_cmd -n "$ns" get events --sort-by=.lastTimestamp 2>/dev/null | tail -10 | sed 's/^/      /' || true
        sleep "$interval"
        attempt=$((attempt + 1))
    done
    echo "Error: Longhorn CSI driver is not registered on all schedulable Ready nodes after ${timeout}s." >&2
    echo "Missing nodes:${missing:- <unknown>}" >&2
    kubectl_cmd get nodes -o wide || true
    kubectl_cmd get csinode -o yaml || true
    kubectl_cmd -n "$ns" get pods -o wide || true
    kubectl_cmd -n "$ns" get daemonset,deploy -o wide || true
    kubectl_cmd -n "$ns" get events --sort-by=.lastTimestamp | tail -100 || true
    return 1
}

print_namespace_progress() {
    local ns="$1"
    echo "    workloads:"
    kubectl_cmd -n "$ns" get deploy,statefulset -o wide 2>/dev/null | sed 's/^/      /' || true
    echo "    pods:"
    kubectl_cmd -n "$ns" get pods -o custom-columns='NAME:.metadata.name,READY:.status.containerStatuses[*].ready,PHASE:.status.phase,WAIT:.status.containerStatuses[*].state.waiting.reason,RESTARTS:.status.containerStatuses[*].restartCount,NODE:.spec.nodeName,AGE:.metadata.creationTimestamp' 2>/dev/null | sed 's/^/      /' || true
    echo "    recent events:"
    kubectl_cmd -n "$ns" get events --sort-by=.lastTimestamp 2>/dev/null | tail -10 | sed 's/^/      /' || true
}

print_namespace_failure_details() {
    local ns="$1"
    local pods
    kubectl_cmd -n "$ns" get pvc,pods,deploy,statefulset -o wide || true
    pods="$(kubectl_cmd -n "$ns" get pods --no-headers 2>/dev/null | awk '{print $1}' || true)"
    for pod in $pods; do
        echo "---- describe pod/$pod -n $ns ----"
        kubectl_cmd -n "$ns" describe "pod/$pod" || true
        echo "---- logs pod/$pod -n $ns --tail=80 ----"
        kubectl_cmd -n "$ns" logs "$pod" --all-containers --tail=80 2>/dev/null || true
        echo "---- previous logs pod/$pod -n $ns --tail=80 ----"
        kubectl_cmd -n "$ns" logs "$pod" --all-containers --previous --tail=80 2>/dev/null || true
    done
    kubectl_cmd -n "$ns" get events --sort-by=.lastTimestamp | tail -100 || true
}

namespace_targets_ready() {
    local ns="$1"
    local deployments="$2"
    local statefulsets="$3"
    local pvcs="$4"
    local name desired available ready phase
    for name in $pvcs; do
        phase="$(kubectl_cmd -n "$ns" get "pvc/$name" -o jsonpath='{.status.phase}' 2>/dev/null || true)"
        [ "$phase" = "Bound" ] || return 1
    done
    for name in $deployments; do
        desired="$(kubectl_cmd -n "$ns" get "deploy/$name" -o jsonpath='{.spec.replicas}' 2>/dev/null || true)"
        available="$(kubectl_cmd -n "$ns" get "deploy/$name" -o jsonpath='{.status.availableReplicas}' 2>/dev/null || true)"
        desired="${desired:-1}"
        available="${available:-0}"
        [ "$available" -ge "$desired" ] 2>/dev/null || return 1
    done
    for name in $statefulsets; do
        desired="$(kubectl_cmd -n "$ns" get "statefulset/$name" -o jsonpath='{.spec.replicas}' 2>/dev/null || true)"
        ready="$(kubectl_cmd -n "$ns" get "statefulset/$name" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || true)"
        desired="${desired:-1}"
        ready="${ready:-0}"
        [ "$ready" -ge "$desired" ] 2>/dev/null || return 1
    done
    return 0
}

wait_namespace_targets_ready() {
    local ns="$1"
    local title="$2"
    local timeout="$3"
    local interval="$4"
    local deployments="$5"
    local statefulsets="$6"
    local pvcs="$7"
    local deadline=$(( $(date +%s) + timeout ))
    local attempt=1
    echo "========== Waiting for $title =========="
    echo "    namespace: $ns"
    echo "    target deployments: ${deployments:-<none>}"
    echo "    target statefulsets: ${statefulsets:-<none>}"
    echo "    target pvcs: ${pvcs:-<none>}"
    while [ "$(date +%s)" -lt "$deadline" ]; do
        echo "    attempt ${attempt}: checking $title readiness"
        print_namespace_progress "$ns"
        if namespace_targets_ready "$ns" "$deployments" "$statefulsets" "$pvcs"; then
            echo "    $title ready"
            return 0
        fi
        sleep "$interval"
        attempt=$((attempt + 1))
    done
    echo "Error: $title not ready after ${timeout}s." >&2
    print_namespace_failure_details "$ns"
    return 1
}

wait_middleware_ready() {
    wait_namespace_targets_ready \
        "${NS_MIDDLEWARE:-by-middleware}" \
        "middleware" \
        "${BYCLAW_K3S_MIDDLEWARE_WAIT_TIMEOUT_SECONDS:-600}" \
        "${BYCLAW_K3S_MIDDLEWARE_WAIT_INTERVAL_SECONDS:-10}" \
        "redis" \
        "opengauss" \
        "opengauss-data"
}

wait_service_ready() {
    wait_namespace_targets_ready \
        "${NS_SERVICE:-by-service}" \
        "service workloads" \
        "${BYCLAW_K3S_SERVICE_WAIT_TIMEOUT_SECONDS:-600}" \
        "${BYCLAW_K3S_SERVICE_WAIT_INTERVAL_SECONDS:-10}" \
        "byclaw-be byclaw-fe ${QA_DOMAINNAME:-byclaw-qa-manager} ${QA_WORKER_NAME:-byclaw-qa-worker} ${DATACLOUD_DOMAINNAME:-byclaw-datacloud}" \
        "" \
        ""
}

ensure_master_http_ingress() {
    if [ "${BYCLAW_K3S_EXPOSE_MASTER_HTTP:-true}" != "true" ]; then
        return 0
    fi
    if ! kubectl_cmd -n kube-system get deploy traefik >/dev/null 2>&1; then
        return 0
    fi
    if [ "${K3S_ENABLE_SERVICELB:-true}" = "true" ]; then
        echo "========== Ensuring master HTTP ingress through ServiceLB =========="
        ensure_servicelb_node_pool
        remove_traefik_hostport_patch
        kubectl_cmd -n kube-system rollout status deploy/traefik --timeout=180s
        return 0
    fi
    local node="${BYCLAW_K3S_INGRESS_NODE_NAME:-}"
    if [ -z "$node" ]; then
        node="$(kubectl_cmd get nodes -l node-role.kubernetes.io/control-plane -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
    fi
    if [ -z "$node" ]; then
        echo "Warning: cannot find control-plane node for Traefik hostPort 80 exposure." >&2
        return 0
    fi
    echo "========== Ensuring master HTTP ingress =========="
    echo "    traefik node: $node"
    echo "    hostPort: 80 -> traefik web entrypoint"
    kubectl_cmd -n kube-system patch deploy traefik --type=merge \
        -p "{\"spec\":{\"template\":{\"spec\":{\"nodeSelector\":{\"kubernetes.io/hostname\":\"$node\"}}}}}" >/dev/null
    kubectl_cmd -n kube-system patch deploy traefik --type=json \
        -p='[{"op":"add","path":"/spec/template/spec/containers/0/ports/2/hostPort","value":80}]' >/dev/null
    kubectl_cmd -n kube-system rollout status deploy/traefik --timeout=180s
}

ensure_opengauss_schema() {
    if [ "${BYCLAW_K3S_INIT_OPENGAUSS_SCHEMA:-true}" != "true" ]; then
        return 0
    fi
    local ns="${NS_MIDDLEWARE:-by-middleware}"
    local pod="${OPENGAUSS_POD_NAME:-opengauss-0}"
    local sql_dir="${BYCLAW_K3S_INITDB_DIR:-$SCRIPT_DIR/../middleware/initdb}"
    local exists
    if [ ! -d "$sql_dir" ]; then
        echo "Error: initdb SQL directory not found: $sql_dir" >&2
        return 1
    fi
    echo "========== Ensuring OpenGauss schema =========="
    exists="$(kubectl_cmd -n "$ns" exec "$pod" -- sh -lc 'su - omm -c "/usr/local/opengauss/bin/gsql -d postgres -Atc \"select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = '\''byai'\'' and c.relname = '\''byai_system_config'\''\""' 2>/dev/null | tr -d '[:space:]' || true)"
    if [ "$exists" = "1" ]; then
        echo "    byai.byai_system_config exists; skip initdb"
        return 0
    fi
    echo "    byai schema is missing; applying initdb SQL from $sql_dir"
    for f in 01_init.sql 02_ddl.sql 03_grant.sql 04_dml.sql; do
        if [ ! -f "$sql_dir/$f" ]; then
            echo "Error: initdb SQL file not found: $sql_dir/$f" >&2
            return 1
        fi
        kubectl_cmd -n "$ns" cp "$sql_dir/$f" "$pod:/tmp/$f"
        echo "    copied $f"
    done
    kubectl_cmd -n "$ns" exec "$pod" -- sh -lc 'set -e; for f in /tmp/01_init.sql /tmp/02_ddl.sql /tmp/03_grant.sql /tmp/04_dml.sql; do echo "    running $f"; su - omm -c "/usr/local/opengauss/bin/gsql -d postgres -f $f"; done'
}

apply_opengauss_migrations() {
    if [ "${BYCLAW_K3S_APPLY_OPENGAUSS_MIGRATIONS:-true}" != "true" ]; then
        return 0
    fi
    local ns="${NS_MIDDLEWARE:-by-middleware}"
    local pod="${OPENGAUSS_POD_NAME:-opengauss-0}"
    local migration_dir="${BYCLAW_K3S_MIGRATIONS_DIR:-$SCRIPT_DIR/migrations}"
    local files f base remote
    if [ ! -d "$migration_dir" ]; then
        echo "    OpenGauss migrations directory not found; skip: $migration_dir"
        return 0
    fi
    files="$(find "$migration_dir" -maxdepth 1 -type f -name '*.auto.sql' | sort || true)"
    if [ -z "$files" ]; then
        echo "    OpenGauss migrations: none"
        echo "    only *.auto.sql files are applied automatically; placeholder SQL files are skipped"
        return 0
    fi
    echo "========== Applying OpenGauss migrations =========="
    while IFS= read -r f; do
        [ -n "$f" ] || continue
        base="$(basename "$f")"
        remote="/tmp/byclaw-k3s-migration-${base}"
        echo "    running migration: $base"
        kubectl_cmd -n "$ns" cp "$f" "$pod:$remote"
        kubectl_cmd -n "$ns" exec "$pod" -- sh -lc "su - omm -c \"/usr/local/opengauss/bin/gsql -d postgres -v ON_ERROR_STOP=1 -f $remote\""
    done <<EOF
$files
EOF
}

apply_runtime_env_config() {
    local ns="${NS_SERVICE:-by-service}"
    local runtime_env="$GENERATED_DIR/40-service/.byclaw-runtime.env"
    local runtime_secret="$GENERATED_DIR/40-service/.byclaw-runtime-secret.env"
    local name file merged_file
    if [ ! -f "$runtime_env" ]; then
        echo "Error: runtime env file not found: $runtime_env" >&2
        return 1
    fi
    if [ ! -f "$runtime_secret" ]; then
        echo "Error: runtime secret env file not found: $runtime_secret" >&2
        return 1
    fi
    echo "========== Applying ByClaw runtime env =========="
    echo "    namespace: $ns"
    echo "    configMap: byclaw-runtime-env"
    echo "    mounted file: /etc/byclaw/.env"
    kubectl_cmd -n "$ns" create configmap byclaw-runtime-env \
        --from-env-file="$runtime_env" \
        --dry-run=client -o yaml | kubectl_cmd apply -f -
    for name in byclaw-be byclaw-qa byclaw-qa-worker byclaw-data; do
        file="$GENERATED_DIR/40-service/.${name}-runtime.env"
        if [ ! -f "$file" ]; then
            echo "Error: workload runtime env file not found: $file" >&2
            return 1
        fi
        echo "    configMap: ${name}-runtime-env"
        kubectl_cmd -n "$ns" create configmap "${name}-runtime-env" \
            --from-env-file="$file" \
            --dry-run=client -o yaml | kubectl_cmd apply -f -
        merged_file="$(mktemp)"
        {
            cat "$runtime_env"
            cat "$file"
        } > "$merged_file"
        kubectl_cmd -n "$ns" create configmap "${name}-runtime-env-file" \
            --from-file=.env="$merged_file" \
            --dry-run=client -o yaml | kubectl_cmd apply -f -
        rm -f "$merged_file"
    done
    kubectl_cmd -n "$ns" create secret generic byclaw-runtime-secret \
        --from-env-file="$runtime_secret" \
        --dry-run=client -o yaml | kubectl_cmd apply -f -
}

apply_generated() {
    require_kubectl
    render_manifests
    echo "========== Applying generated manifests =========="
    kubectl_cmd apply -f "$GENERATED_DIR/00-namespaces/"
    apply_longhorn_settings
    kubectl_cmd apply -f "$GENERATED_DIR/10-storage/"
    ensure_longhorn_csi_ready
    kubectl_cmd apply -f "$GENERATED_DIR/20-middleware/"
    cleanup_bad_pods_in_namespace "${NS_MIDDLEWARE:-by-middleware}"
    wait_middleware_ready
    ensure_opengauss_schema
    apply_opengauss_migrations
    # 仅 apply opensandbox.yaml；.templates/ 下是 BatchSandbox Jinja 模板，不是集群资源
    kubectl_cmd apply -f "$GENERATED_DIR/30-sandbox/opensandbox.yaml"
    apply_runtime_env_config
    kubectl_cmd apply -f "$GENERATED_DIR/40-service/"
    cleanup_bad_pods_in_namespace "${NS_SANDBOX:-by-sandbox}"
    cleanup_bad_pods_in_namespace "${NS_SERVICE:-by-service}"
    wait_service_ready
    kubectl_cmd apply -f "$GENERATED_DIR/50-ingress/" 2>/dev/null || true
    if [ "${MONITORING_ENABLED:-true}" = "true" ] && [ -d "$GENERATED_DIR/60-monitoring" ]; then
        kubectl_cmd apply -f "$GENERATED_DIR/60-monitoring/" 2>/dev/null || true
    fi
    bash "$SCRIPT_DIR/gen-resource-quota.sh" "$ENV_FILE" --apply
}

rollout_wait() {
    echo "========== Final middleware status =========="
    print_namespace_progress "${NS_MIDDLEWARE:-by-middleware}"
    echo "========== Final service status =========="
    if [ "${BYCLAW_K3S_ROLLOUT_RESTART_ON_UPDATE:-false}" = "true" ]; then
        wait_service_ready
    else
        print_namespace_progress "${NS_SERVICE:-by-service}"
    fi
}

rollout_restart_workloads() {
    if [ "${BYCLAW_K3S_ROLLOUT_RESTART_ON_UPDATE:-false}" != "true" ]; then
        return 0
    fi
    if [ "${BYCLAW_K3S_RESTART_OPENSANDBOX_ON_UPDATE:-false}" = "true" ]; then
        kubectl_cmd -n "${NS_SANDBOX:-by-sandbox}" rollout restart deploy/opensandbox-server 2>/dev/null || true
    fi
    kubectl_cmd -n "${NS_SERVICE:-by-service}" rollout restart deploy/byclaw-be 2>/dev/null || true
    kubectl_cmd -n "${NS_SERVICE:-by-service}" rollout restart deploy/byclaw-fe 2>/dev/null || true
    kubectl_cmd -n "${NS_SERVICE:-by-service}" rollout restart "deploy/${QA_DOMAINNAME:-byclaw-qa-manager}" 2>/dev/null || true
    kubectl_cmd -n "${NS_SERVICE:-by-service}" rollout restart "deploy/${QA_WORKER_NAME:-byclaw-qa-worker}" 2>/dev/null || true
    kubectl_cmd -n "${NS_SERVICE:-by-service}" rollout restart "deploy/${DATACLOUD_DOMAINNAME:-byclaw-datacloud}" 2>/dev/null || true
}

cleanup_bad_pods_in_namespace() {
    local ns="$1"
    local pods
    pods="$(kubectl_cmd -n "$ns" get pods --no-headers 2>/dev/null \
        | awk '$3 ~ /^(ErrImagePull|ImagePullBackOff|CrashLoopBackOff|CreateContainerConfigError|CreateContainerError|RunContainerError|InvalidImageName|Error)$/ || $3 ~ /^Init:(ErrImagePull|ImagePullBackOff|CrashLoopBackOff|CreateContainerConfigError|CreateContainerError|RunContainerError|InvalidImageName|Error)$/ {print $1}' \
        || true)"
    if [ -z "$pods" ]; then
        echo "    $ns: no bad pods to delete"
        return 0
    fi
    echo "    $ns: deleting bad pods:"
    printf '%s\n' "$pods" | sed 's/^/      - /'
    # shellcheck disable=SC2086
    kubectl_cmd -n "$ns" delete pod $pods --wait=false 2>/dev/null || true
}

cleanup_bad_pods() {
    if [ "${BYCLAW_K3S_CLEAN_BAD_PODS_ON_UPDATE:-true}" != "true" ]; then
        return 0
    fi
    echo "========== Cleaning bad pods from previous deploys =========="
    cleanup_bad_pods_in_namespace "${NS_MIDDLEWARE:-by-middleware}"
    cleanup_bad_pods_in_namespace "${NS_SANDBOX:-by-sandbox}"
    cleanup_bad_pods_in_namespace "${NS_SERVICE:-by-service}"
}

case "$ACTION" in
    init)
        load_env
        if [ "${BYCLAW_K3S_INSTALL_K3S:-false}" = "true" ]; then
            install_cluster
        fi
        require_kubectl
        if [ "${BYCLAW_K3S_INSTALL_LONGHORN:-true}" = "true" ]; then
            install_longhorn
        fi
        if [ "${BYCLAW_K3S_INSTALL_OPENSANDBOX_CONTROLLER:-true}" = "true" ]; then
            install_opensandbox_controller
        fi
        apply_generated
        ensure_master_http_ingress
        install_monitoring
        rollout_wait
        echo "K3s + Longhorn init completed."
        ;;
    cluster-init)
        load_env
        install_cluster
        ;;
    storage-init)
        load_env
        require_kubectl
        install_longhorn
        render_manifests
        kubectl_cmd apply -f "$GENERATED_DIR/00-namespaces/"
        kubectl_cmd apply -f "$GENERATED_DIR/10-storage/"
        echo "Longhorn storage init completed."
        ;;
    monitoring-init)
        load_env
        require_kubectl
        ensure_master_http_ingress
        install_monitoring
        ;;
    render)
        load_env
        render_manifests
        ;;
    update)
        load_env
        sync_registry_config
        ensure_servicelb_node_pool
        ensure_master_http_ingress
        apply_generated
        install_monitoring
        cleanup_bad_pods
        rollout_restart_workloads
        rollout_wait
        prune_empty_images
        echo "K3s update completed."
        ;;
    stop)
        load_env
        require_kubectl
        echo "========== Scaling down workloads =========="
        kubectl_cmd -n "${NS_SERVICE:-by-service}" scale deploy --all --replicas=0 2>/dev/null || true
        kubectl_cmd -n "${NS_SANDBOX:-by-sandbox}" scale deploy --all --replicas=0 2>/dev/null || true
        kubectl_cmd -n "${NS_MIDDLEWARE:-by-middleware}" scale deploy --all --replicas=0 2>/dev/null || true
        echo "K3s stop completed (namespaces and PVCs retained)."
        ;;
    -h|--help|help)
        usage
        ;;
    *)
        echo "Unknown action: $ACTION" >&2
        usage
        exit 1
        ;;
esac
