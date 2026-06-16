#!/bin/bash
# 在已有 k3s 集群安装 Longhorn，配置 /data 数据路径（RWX 由 PVC accessModes 启用）
# Usage: ./install-longhorn.sh [env.k3s]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ENV_FILE="${1:-./env.k3s.example}"
if [ ! -f "$ENV_FILE" ] && [ -f "$SCRIPT_DIR/$(basename "$ENV_FILE")" ]; then
    ENV_FILE="$SCRIPT_DIR/$(basename "$ENV_FILE")"
fi
if [ -f "$ENV_FILE" ]; then
    set -a
    . "$ENV_FILE"
    set +a
fi

LONGHORN_VERSION="${LONGHORN_VERSION:-v1.6.2}"
LONGHORN_NAMESPACE="${LONGHORN_NAMESPACE:-longhorn-system}"
LONGHORN_DATA_PATH="${LONGHORN_DATA_PATH:-/data/longhorn}"
LONGHORN_REPLICA_COUNT="${LONGHORN_REPLICA_COUNT:-3}"
LONGHORN_MANIFEST_URL="${LONGHORN_MANIFEST_URL:-https://raw.githubusercontent.com/longhorn/longhorn/${LONGHORN_VERSION}/deploy/longhorn.yaml}"
LONGHORN_MANIFEST_FILE="${LONGHORN_MANIFEST_FILE:-}"
LONGHORN_MANIFEST_CACHE="${LONGHORN_MANIFEST_CACHE:-false}"
K3S_DATA_DIR="${K3S_DATA_DIR:-/data/rancher/k3s}"

if [ -z "${KUBECONFIG:-}" ] && [ -f "${K3S_DATA_DIR}/server/kubeconfig" ]; then
    export KUBECONFIG="${K3S_DATA_DIR}/server/kubeconfig"
fi

log_step() {
    printf "\n[%s] %s\n" "$(date '+%H:%M:%S')" "$*"
}

kubectl_cmd() {
    # Match manual ops on k3s server: sudo K3S_DATA_DIR=... k3s kubectl
    if command -v k3s >/dev/null 2>&1; then
        sudo K3S_DATA_DIR="${K3S_DATA_DIR}" k3s kubectl "$@"
        return $?
    fi
    if [ -n "${KUBECONFIG:-}" ] && command -v kubectl >/dev/null 2>&1; then
        kubectl "$@"
        return $?
    fi
    echo "Error: k3s or kubectl is required." >&2
    return 1
}

require_kubectl() {
    if ! kubectl_cmd get nodes --request-timeout=15s >/dev/null 2>&1; then
        echo "Error: cannot reach k3s API. Set KUBECONFIG=${K3S_DATA_DIR}/server/kubeconfig or run on a server node." >&2
        exit 1
    fi
}

resolve_longhorn_manifest() {
    if [ -n "$LONGHORN_MANIFEST_FILE" ] && [ -f "$LONGHORN_MANIFEST_FILE" ]; then
        printf '%s\n' "$LONGHORN_MANIFEST_FILE"
        return 0
    fi
    if [ "$LONGHORN_MANIFEST_CACHE" = "true" ]; then
        local cache_dir="${LONGHORN_MANIFEST_CACHE_DIR:-/tmp/byclaw-longhorn}"
        local cache_file="${cache_dir}/longhorn-${LONGHORN_VERSION}.yaml"
        mkdir -p "$cache_dir"
        if [ ! -s "$cache_file" ]; then
            log_step "Download Longhorn manifest to cache" >&2
            echo "    url: ${LONGHORN_MANIFEST_URL}" >&2
            echo "    cache: ${cache_file}" >&2
            if command -v curl >/dev/null 2>&1; then
                curl -fL --retry 3 --connect-timeout 30 --max-time 300 \
                    -o "$cache_file" "$LONGHORN_MANIFEST_URL"
            elif command -v wget >/dev/null 2>&1; then
                wget -O "$cache_file" "$LONGHORN_MANIFEST_URL"
            else
                echo "Error: curl or wget is required when LONGHORN_MANIFEST_CACHE=true." >&2
                exit 1
            fi
        else
            echo "    reuse cached manifest: $cache_file" >&2
        fi
        printf '%s\n' "$cache_file"
        return 0
    fi
    # Default: kubectl apply -f URL (same as manual install on server)
    printf '%s\n' "$LONGHORN_MANIFEST_URL"
}

prepare_longhorn_manifest() {
    local source="$1"
    local work_dir="${LONGHORN_MANIFEST_CACHE_DIR:-/tmp/byclaw-longhorn}"
    local raw_file="${work_dir}/longhorn-${LONGHORN_VERSION}-raw.yaml"
    local patched_file="${work_dir}/longhorn-${LONGHORN_VERSION}-kubelet-root.yaml"
    local kubelet_root="${K3S_KUBELET_ROOT:-}"

    if [ -z "$kubelet_root" ]; then
        printf '%s\n' "$source"
        return 0
    fi

    mkdir -p "$work_dir"
    case "$source" in
        http://*|https://*)
            log_step "Download Longhorn manifest for kubelet root patch" >&2
            echo "    url: $source" >&2
            echo "    file: $raw_file" >&2
            if command -v curl >/dev/null 2>&1; then
                curl -fL --retry 3 --connect-timeout 30 --max-time 300 -o "$raw_file" "$source"
            elif command -v wget >/dev/null 2>&1; then
                wget -O "$raw_file" "$source"
            else
                echo "Error: curl or wget is required to patch Longhorn manifest from URL." >&2
                exit 1
            fi
            ;;
        *)
            raw_file="$source"
            ;;
    esac

    if grep -q 'name: KUBELET_ROOT_DIR' "$raw_file"; then
        echo "    Longhorn manifest already contains KUBELET_ROOT_DIR; using as-is: $raw_file" >&2
        printf '%s\n' "$raw_file"
        return 0
    fi

    log_step "Patch Longhorn manifest kubelet root" >&2
    echo "    KUBELET_ROOT_DIR=${kubelet_root}" >&2
    echo "    output: ${patched_file}" >&2
    awk -v root="$kubelet_root" '
        /          - name: CSI_ATTACHER_IMAGE/ && inserted == 0 {
            print "          - name: KUBELET_ROOT_DIR"
            print "            value: \"" root "\""
            inserted = 1
        }
        { print }
        END {
            if (inserted == 0) {
                exit 42
            }
        }
    ' "$raw_file" > "$patched_file" || {
        echo "Error: failed to patch Longhorn manifest with KUBELET_ROOT_DIR." >&2
        exit 1
    }
    printf '%s\n' "$patched_file"
}

longhorn_pod_snapshot() {
    kubectl_cmd -n "$LONGHORN_NAMESPACE" get pods -o wide 2>/dev/null || true
    kubectl_cmd get events -n "$LONGHORN_NAMESPACE" --sort-by='.lastTimestamp' 2>/dev/null | tail -8 || true
}

describe_stuck_managers() {
    local pod
    while IFS= read -r pod; do
        [ -n "$pod" ] || continue
        echo "    --- describe ${pod} ---" >&2
        kubectl_cmd -n "$LONGHORN_NAMESPACE" describe pod "$pod" 2>/dev/null | tail -20 || true
    done < <(
        kubectl_cmd -n "$LONGHORN_NAMESPACE" get pods -l app=longhorn-manager \
            -o jsonpath='{range .items[?(@.status.phase!="Running")]}{.metadata.name}{"\n"}{end}' 2>/dev/null || true
    )
}

wait_longhorn_managers() {
    local attempt
    log_step "Wait for Longhorn manager pods (all nodes must be Ready before CSI deploy)"
    for attempt in $(seq 1 120); do
        if kubectl_cmd -n "$LONGHORN_NAMESPACE" wait --for=condition=ready pod -l app=longhorn-manager --timeout=15s >/dev/null 2>&1; then
            echo "    longhorn-manager ready (attempt ${attempt}/120)"
            return 0
        fi
        echo "    waiting for longhorn-manager... attempt ${attempt}/120"
        longhorn_pod_snapshot
        if [ $((attempt % 6)) -eq 0 ]; then
            describe_stuck_managers
        fi
        sleep 5
    done
    echo "Error: longhorn-manager not ready after 600s." >&2
    kubectl_cmd -n "$LONGHORN_NAMESPACE" get pods -o wide || true
    describe_stuck_managers
    kubectl_cmd get events -n "$LONGHORN_NAMESPACE" --sort-by='.lastTimestamp' | tail -30 || true
    return 1
}

wait_longhorn_driver_deployer() {
    local attempt
    log_step "Wait for longhorn-driver-deployer (CSI driver install)"
    for attempt in $(seq 1 12); do
        if kubectl_cmd -n "$LONGHORN_NAMESPACE" rollout status deploy/longhorn-driver-deployer --timeout=120s >/dev/null 2>&1; then
            echo "    longhorn-driver-deployer ready (attempt ${attempt}/12)"
            return 0
        fi
        local failed
        failed="$(kubectl_cmd -n "$LONGHORN_NAMESPACE" get pods -l app=longhorn-driver-deployer \
            -o jsonpath='{range .items[?(@.status.phase=="Failed")]}{.metadata.name}{" "}{end}' 2>/dev/null || true)"
        if [ -n "$failed" ]; then
            echo "    driver-deployer failed; deleting pod(s) to retry after managers are ready: ${failed}" >&2
            kubectl_cmd -n "$LONGHORN_NAMESPACE" delete pod -l app=longhorn-driver-deployer --wait=false 2>/dev/null || true
        fi
        echo "    waiting for longhorn-driver-deployer... attempt ${attempt}/12"
        kubectl_cmd -n "$LONGHORN_NAMESPACE" logs deploy/longhorn-driver-deployer --tail=30 2>/dev/null || true
        sleep 10
    done
    echo "Error: longhorn-driver-deployer not ready." >&2
    kubectl_cmd -n "$LONGHORN_NAMESPACE" get pods -l app=longhorn-driver-deployer -o wide || true
    kubectl_cmd -n "$LONGHORN_NAMESPACE" logs deploy/longhorn-driver-deployer --tail=80 2>/dev/null || true
    return 1
}

patch_longhorn_csi_daemonset_kubelet_root() {
    local kubelet_root="${K3S_KUBELET_ROOT:-}"
    local patch
    local mount3 mount4

    if [ -z "$kubelet_root" ] || [ "$kubelet_root" = "/var/lib/kubelet" ]; then
        return 0
    fi
    if ! kubectl_cmd -n "$LONGHORN_NAMESPACE" get daemonset longhorn-csi-plugin >/dev/null 2>&1; then
        return 0
    fi

    log_step "Patch Longhorn CSI DaemonSet kubelet root"
    echo "    K3S_KUBELET_ROOT=${kubelet_root}"

    patch="$(
        cat <<EOF
[
  {"op":"replace","path":"/spec/template/spec/containers/0/args/2","value":"--kubelet-registration-path=${kubelet_root}/plugins/driver.longhorn.io/csi.sock"},
  {"op":"replace","path":"/spec/template/spec/containers/2/volumeMounts/1/mountPath","value":"${kubelet_root}/plugins/kubernetes.io/csi"},
  {"op":"replace","path":"/spec/template/spec/containers/2/volumeMounts/2/mountPath","value":"${kubelet_root}/pods"},
  {"op":"replace","path":"/spec/template/spec/volumes/0/hostPath/path","value":"${kubelet_root}/plugins/kubernetes.io/csi"},
  {"op":"replace","path":"/spec/template/spec/volumes/1/hostPath/path","value":"${kubelet_root}/plugins_registry"},
  {"op":"replace","path":"/spec/template/spec/volumes/2/hostPath/path","value":"${kubelet_root}/plugins/driver.longhorn.io"},
  {"op":"replace","path":"/spec/template/spec/volumes/3/hostPath/path","value":"${kubelet_root}/pods"}
]
EOF
    )"

    kubectl_cmd -n "$LONGHORN_NAMESPACE" patch daemonset longhorn-csi-plugin --type=json -p "$patch"

    mount3="$(kubectl_cmd -n "$LONGHORN_NAMESPACE" get daemonset longhorn-csi-plugin \
        -o jsonpath='{.spec.template.spec.containers[2].volumeMounts[3].mountPath}' 2>/dev/null || true)"
    mount4="$(kubectl_cmd -n "$LONGHORN_NAMESPACE" get daemonset longhorn-csi-plugin \
        -o jsonpath='{.spec.template.spec.containers[2].volumeMounts[4].mountPath}' 2>/dev/null || true)"
    if [ "$mount3" = "/var/lib/kubelet/plugins/kubernetes.io/csi" ] && [ "$mount4" = "/var/lib/kubelet/pods" ]; then
        echo "    remove stale /var/lib/kubelet CSI plugin mounts left by strategic merge"
        kubectl_cmd -n "$LONGHORN_NAMESPACE" patch daemonset longhorn-csi-plugin --type=json -p \
            '[{"op":"remove","path":"/spec/template/spec/containers/2/volumeMounts/4"},{"op":"remove","path":"/spec/template/spec/containers/2/volumeMounts/3"}]'
    fi

    kubectl_cmd -n "$LONGHORN_NAMESPACE" rollout status daemonset/longhorn-csi-plugin --timeout=180s || true

    echo "    delete old Longhorn CSI plugin pods so kubelet re-registers the driver"
    kubectl_cmd -n "$LONGHORN_NAMESPACE" delete pod -l app=longhorn-csi-plugin --wait=false 2>/dev/null || true
}

patch_longhorn_csi_sidecars_kubelet_root() {
    local kubelet_root="${K3S_KUBELET_ROOT:-}"
    local deployment current_path patch

    if [ -z "$kubelet_root" ] || [ "$kubelet_root" = "/var/lib/kubelet" ]; then
        return 0
    fi

    log_step "Patch Longhorn CSI sidecar socket dirs"
    for deployment in csi-attacher csi-provisioner csi-resizer csi-snapshotter; do
        if ! kubectl_cmd -n "$LONGHORN_NAMESPACE" get "deploy/${deployment}" >/dev/null 2>&1; then
            continue
        fi
        current_path="$(kubectl_cmd -n "$LONGHORN_NAMESPACE" get "deploy/${deployment}" \
            -o jsonpath='{.spec.template.spec.volumes[0].hostPath.path}' 2>/dev/null || true)"
        if [ "$current_path" = "${kubelet_root}/plugins/driver.longhorn.io" ]; then
            echo "    ${deployment}: socket-dir already ${current_path}"
            continue
        fi
        echo "    ${deployment}: socket-dir ${current_path:-<unknown>} -> ${kubelet_root}/plugins/driver.longhorn.io"
        patch="[{\"op\":\"replace\",\"path\":\"/spec/template/spec/volumes/0/hostPath/path\",\"value\":\"${kubelet_root}/plugins/driver.longhorn.io\"}]"
        kubectl_cmd -n "$LONGHORN_NAMESPACE" patch "deploy/${deployment}" --type=json -p "$patch"
        kubectl_cmd -n "$LONGHORN_NAMESPACE" rollout status "deploy/${deployment}" --timeout=180s || true
    done
}

wait_longhorn_csi_nodes() {
    local timeout="${BYCLAW_K3S_LONGHORN_CSI_WAIT_TIMEOUT_SECONDS:-600}"
    local interval="${BYCLAW_K3S_LONGHORN_CSI_WAIT_INTERVAL_SECONDS:-10}"
    local deadline=$(( $(date +%s) + timeout ))
    local attempt=1
    local nodes node missing drivers
    log_step "Wait for Longhorn CSI driver registration on schedulable nodes"
    while [ "$(date +%s)" -lt "$deadline" ]; do
        nodes="$(kubectl_cmd get nodes --no-headers 2>/dev/null | awk '$2 == "Ready" && $3 !~ /SchedulingDisabled/ {print $1}' || true)"
        missing=""
        echo "    attempt ${attempt}: checking CSINode driver.longhorn.io"
        for node in $nodes; do
            drivers="$(kubectl_cmd get "csinode/$node" -o jsonpath='{range .spec.drivers[*]}{.name}{" "}{end}' 2>/dev/null || true)"
            if printf '%s' "$drivers" | grep -qw 'driver.longhorn.io'; then
                echo "      $node: registered"
            else
                echo "      $node: MISSING (drivers=${drivers:-<none>})"
                missing="${missing} ${node}"
            fi
        done
        if [ -n "$nodes" ] && [ -z "$missing" ]; then
            echo "    longhorn CSI registered on all schedulable Ready nodes"
            return 0
        fi
        kubectl_cmd -n "$LONGHORN_NAMESPACE" get pods -o wide 2>/dev/null | sed 's/^/      /' || true
        kubectl_cmd -n "$LONGHORN_NAMESPACE" get events --sort-by=.lastTimestamp 2>/dev/null | tail -10 | sed 's/^/      /' || true
        sleep "$interval"
        attempt=$((attempt + 1))
    done
    echo "Error: Longhorn CSI driver not registered on all schedulable Ready nodes after ${timeout}s." >&2
    echo "Missing nodes:${missing:- <unknown>}" >&2
    kubectl_cmd get nodes -o wide || true
    kubectl_cmd get csinode -o yaml || true
    kubectl_cmd -n "$LONGHORN_NAMESPACE" get pods -o wide || true
    kubectl_cmd -n "$LONGHORN_NAMESPACE" get daemonset,deploy -o wide || true
    kubectl_cmd -n "$LONGHORN_NAMESPACE" get events --sort-by=.lastTimestamp | tail -100 || true
    return 1
}

require_kubectl

MANIFEST_PATH="$(prepare_longhorn_manifest "$(resolve_longhorn_manifest)")"

log_step "Installing Longhorn ${LONGHORN_VERSION}"
echo "    namespace: ${LONGHORN_NAMESPACE}"
echo "    manifest: ${MANIFEST_PATH}"
kubectl_cmd apply -f "$MANIFEST_PATH"

wait_longhorn_managers
wait_longhorn_driver_deployer
patch_longhorn_csi_daemonset_kubelet_root
patch_longhorn_csi_sidecars_kubelet_root
wait_longhorn_csi_nodes

log_step "Apply Longhorn settings (data path, replica count)"
sed -e "s|\${LONGHORN_DATA_PATH}|${LONGHORN_DATA_PATH}|g" \
    -e "s|\${LONGHORN_NAMESPACE}|${LONGHORN_NAMESPACE}|g" \
    -e "s|\${LONGHORN_REPLICA_COUNT}|${LONGHORN_REPLICA_COUNT}|g" \
    "$SCRIPT_DIR/manifests/storage/longhorn-settings.yaml" | kubectl_cmd apply -f -

log_step "Wait for StorageClass longhorn"
for i in $(seq 1 60); do
    if kubectl_cmd get storageclass longhorn >/dev/null 2>&1; then
        echo "    storageclass longhorn ready (attempt ${i}/60)"
        break
    fi
    echo "    waiting for storageclass longhorn... attempt ${i}/60"
    sleep 5
done
kubectl_cmd get storageclass longhorn

log_step "Longhorn install completed"
echo "    data path: ${LONGHORN_DATA_PATH}"
echo "    RWX: use ReadWriteMany on PVC (see manifests/storage/workspace-pvc.yaml)"
