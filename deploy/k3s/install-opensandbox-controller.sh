#!/bin/bash
# Install OpenSandbox Kubernetes Controller (CRDs + operator) before opensandbox-server.
# Usage: ./install-opensandbox-controller.sh [env.k3s]
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

# 与 opensandbox-group/OpenSandbox main 分支 charts/opensandbox-controller Chart.yaml 对齐
OPENSANDBOX_CONTROLLER_CHART_VERSION="${OPENSANDBOX_CONTROLLER_CHART_VERSION:-0.2.0}"
OPENSANDBOX_CONTROLLER_NAMESPACE="${OPENSANDBOX_CONTROLLER_NAMESPACE:-opensandbox-system}"
OPENSANDBOX_CONTROLLER_HELM_RELEASE="${OPENSANDBOX_CONTROLLER_HELM_RELEASE:-opensandbox-controller}"
OPENSANDBOX_CONTROLLER_CHART_URL="${OPENSANDBOX_CONTROLLER_CHART_URL:-https://github.com/alibaba/OpenSandbox/releases/download/helm/opensandbox-controller/${OPENSANDBOX_CONTROLLER_CHART_VERSION}/opensandbox-controller-${OPENSANDBOX_CONTROLLER_CHART_VERSION}.tgz}"
IMAGE_SANDBOX_CONTROLLER_CONFIGURED="${IMAGE_SANDBOX_CONTROLLER+x}"
# controller 与 server 版本号独立：chart/app v0.2.0 → controller:v0.2.0；server chart 默认 v0.1.14
IMAGE_SANDBOX_CONTROLLER="${IMAGE_SANDBOX_CONTROLLER:-sandbox-registry.cn-zhangjiakou.cr.aliyuncs.com/opensandbox/controller:v0.2.0}"
HELM_VERSION="${HELM_VERSION:-3.14.4}"
HELM_DOWNLOAD_BASE="${HELM_DOWNLOAD_BASE:-https://get.helm.sh}"
BYCLAW_K3S_AUTO_INSTALL_HELM="${BYCLAW_K3S_AUTO_INSTALL_HELM:-true}"
K3S_DATA_DIR="${K3S_DATA_DIR:-/data/rancher/k3s}"
HELM_BIN=""
HELM_KUBECONFIG=""

log_step() {
    printf "\n[%s] %s\n" "$(date '+%H:%M:%S')" "$*"
}

kubectl_cmd() {
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
        echo "Error: cannot reach k3s API." >&2
        exit 1
    fi
}

kubeconfig_usable() {
    local cfg="$1"
    [ -n "$cfg" ] && [ -r "$cfg" ] || return 1
    if command -v kubectl >/dev/null 2>&1 \
        && kubectl --kubeconfig "$cfg" get nodes --request-timeout=10s >/dev/null 2>&1; then
        return 0
    fi
    if command -v k3s >/dev/null 2>&1; then
        KUBECONFIG="$cfg" sudo K3S_DATA_DIR="${K3S_DATA_DIR}" k3s kubectl get nodes --request-timeout=10s >/dev/null 2>&1
        return $?
    fi
    return 1
}

# k3s kubeconfig 常为 root:600；kubectl 走 sudo k3s kubectl，但 helm 必须能读取 kubeconfig
prepare_helm_kubeconfig() {
    local src="${K3S_DATA_DIR}/server/kubeconfig"
    local cache_dir

    if [ -n "$HELM_KUBECONFIG" ] && kubeconfig_usable "$HELM_KUBECONFIG"; then
        export KUBECONFIG="$HELM_KUBECONFIG"
        return 0
    fi
    if kubeconfig_usable "${KUBECONFIG:-}"; then
        HELM_KUBECONFIG="${KUBECONFIG}"
        export KUBECONFIG="$HELM_KUBECONFIG"
        return 0
    fi
    if kubeconfig_usable "$src"; then
        HELM_KUBECONFIG="$src"
        export KUBECONFIG="$HELM_KUBECONFIG"
        return 0
    fi

    cache_dir="${OPENSANDBOX_CONTROLLER_CHART_CACHE_DIR:-/tmp/byclaw-opensandbox-controller}"
    mkdir -p "$cache_dir"
    HELM_KUBECONFIG="${cache_dir}/kubeconfig"

    if sudo test -r "$src" 2>/dev/null; then
        sudo cat "$src" > "$HELM_KUBECONFIG"
        chmod 600 "$HELM_KUBECONFIG"
    elif command -v k3s >/dev/null 2>&1; then
        sudo K3S_DATA_DIR="${K3S_DATA_DIR}" k3s kubectl config view --raw > "$HELM_KUBECONFIG"
        chmod 600 "$HELM_KUBECONFIG"
    else
        echo "Error: cannot read k3s kubeconfig at ${src}. Run on a k3s server node or export KUBECONFIG." >&2
        exit 1
    fi

    if ! kubeconfig_usable "$HELM_KUBECONFIG"; then
        echo "Error: helm kubeconfig is not usable: ${HELM_KUBECONFIG}" >&2
        exit 1
    fi
    export KUBECONFIG="$HELM_KUBECONFIG"
}

helm_cmd() {
    prepare_helm_kubeconfig
    "$HELM_BIN" --kubeconfig "$HELM_KUBECONFIG" "$@"
}

controller_crds_ready() {
    kubectl_cmd get crd batchsandboxes.sandbox.opensandbox.io >/dev/null 2>&1 \
        && kubectl_cmd get crd pools.sandbox.opensandbox.io >/dev/null 2>&1
}

detect_helm_arch() {
    local machine
    machine="$(uname -m)"
    case "$machine" in
        aarch64|arm64) printf '%s' "arm64" ;;
        x86_64|amd64) printf '%s' "amd64" ;;
        *)
            echo "Error: unsupported architecture for Helm: $machine" >&2
            exit 1
            ;;
    esac
}

download_file() {
    local url="$1"
    local dest="$2"
    if command -v curl >/dev/null 2>&1; then
        curl -fL --retry 3 --connect-timeout 30 --max-time 600 -o "$dest" "$url"
    elif command -v wget >/dev/null 2>&1; then
        wget -O "$dest" "$url"
    else
        echo "Error: curl or wget is required." >&2
        exit 1
    fi
}

chart_archive_valid() {
    local file="$1"
    [ -s "$file" ] && tar -tzf "$file" opensandbox-controller/Chart.yaml >/dev/null 2>&1
}

resolve_controller_chart_file() {
    local explicit="${OPENSANDBOX_CONTROLLER_CHART_FILE:-}"
    local cache_dir="${OPENSANDBOX_CONTROLLER_CHART_CACHE_DIR:-/tmp/byclaw-opensandbox-controller}"
    local cached_chart="${cache_dir}/opensandbox-controller-${OPENSANDBOX_CONTROLLER_CHART_VERSION}.tgz"
    local candidate

    if [ -n "$explicit" ]; then
        case "$explicit" in
            /*) candidate="$explicit" ;;
            *) candidate="${SCRIPT_DIR}/${explicit}" ;;
        esac
        if chart_archive_valid "$candidate"; then
            printf '%s\n' "$candidate"
            return 0
        fi
        echo "Error: OPENSANDBOX_CONTROLLER_CHART_FILE is not a valid opensandbox-controller chart: ${candidate}" >&2
        exit 1
    fi

    if chart_archive_valid "$cached_chart"; then
        printf '%s\n' "$cached_chart"
        return 0
    fi

    mkdir -p "$cache_dir"
    log_step "Download OpenSandbox controller Helm chart"
    echo "    url: ${OPENSANDBOX_CONTROLLER_CHART_URL}"
    echo "    cache: ${cached_chart}"
    candidate="${cached_chart}.partial"
    rm -f "$candidate"
    download_file "$OPENSANDBOX_CONTROLLER_CHART_URL" "$candidate"
    if ! chart_archive_valid "$candidate"; then
        rm -f "$candidate"
        echo "Error: downloaded opensandbox-controller chart is invalid: ${OPENSANDBOX_CONTROLLER_CHART_URL}" >&2
        exit 1
    fi
    mv "$candidate" "$cached_chart"
    printf '%s\n' "$cached_chart"
}

ensure_helm() {
    if [ -n "$HELM_BIN" ] && [ -x "$HELM_BIN" ]; then
        return 0
    fi
    if command -v helm >/dev/null 2>&1; then
        HELM_BIN="$(command -v helm)"
        return 0
    fi
    if [ "${BYCLAW_K3S_AUTO_INSTALL_HELM}" != "true" ]; then
        echo "Error: helm not found. Install Helm 3 or set BYCLAW_K3S_AUTO_INSTALL_HELM=true." >&2
        exit 1
    fi

    local cache_dir arch os tarball url extract_dir
    cache_dir="${OPENSANDBOX_CONTROLLER_CHART_CACHE_DIR:-/tmp/byclaw-opensandbox-controller}"
    mkdir -p "$cache_dir"
    arch="$(detect_helm_arch)"
    os="linux"
    HELM_BIN="${cache_dir}/helm-v${HELM_VERSION}"
    if [ -x "$HELM_BIN" ]; then
        return 0
    fi

    tarball="${cache_dir}/helm-v${HELM_VERSION}-${os}-${arch}.tar.gz"
    url="${HELM_DOWNLOAD_BASE}/helm-v${HELM_VERSION}-${os}-${arch}.tar.gz"
    log_step "Download Helm ${HELM_VERSION} (auto-install for opensandbox-controller)"
    echo "    url: ${url}"
    echo "    bin: ${HELM_BIN}"
    if [ ! -s "$tarball" ]; then
        download_file "$url" "$tarball"
    fi
    extract_dir="$(mktemp -d)"
    tar -xzf "$tarball" -C "$extract_dir"
    install -m 0755 "${extract_dir}/${os}-${arch}/helm" "$HELM_BIN"
    rm -rf "$extract_dir"
    echo "    helm version: $("$HELM_BIN" version --short 2>/dev/null || "$HELM_BIN" version)"
}

show_image_pull_hints() {
  local pull_err
  pull_err="$(kubectl_cmd -n "$OPENSANDBOX_CONTROLLER_NAMESPACE" get pods -o jsonpath='{range .items[*]}{.status.containerStatuses[0].state.waiting.reason}{"\n"}{end}' 2>/dev/null | grep -E 'ImagePull|ErrImage' | head -1 || true)"
  if [ -n "$pull_err" ]; then
    echo "    image pull issue detected (${pull_err}) for: ${IMAGE_SANDBOX_CONTROLLER}" >&2
    echo "    hint: mirror image to private Harbor and set IMAGE_SANDBOX_CONTROLLER in env.k3s" >&2
    echo "    hint: ensure K3S_PRIVATE_REGISTRIES includes the registry host with auth" >&2
    kubectl_cmd get events -n "$OPENSANDBOX_CONTROLLER_NAMESPACE" --sort-by='.lastTimestamp' 2>/dev/null | tail -6 || true
  fi
}

wait_controller_ready() {
    local attempt
    log_step "Wait for OpenSandbox controller"
    for attempt in $(seq 1 60); do
        if kubectl_cmd -n "$OPENSANDBOX_CONTROLLER_NAMESPACE" rollout status deploy/opensandbox-controller-manager --timeout=30s >/dev/null 2>&1; then
            echo "    opensandbox-controller-manager ready (attempt ${attempt}/60)"
            return 0
        fi
        if kubectl_cmd -n "$OPENSANDBOX_CONTROLLER_NAMESPACE" rollout status deploy/opensandbox-controller --timeout=30s >/dev/null 2>&1; then
            echo "    opensandbox-controller ready (attempt ${attempt}/60)"
            return 0
        fi
        echo "    waiting for controller deployment... attempt ${attempt}/60"
        kubectl_cmd -n "$OPENSANDBOX_CONTROLLER_NAMESPACE" get pods -o wide 2>/dev/null || true
        if [ "$attempt" -eq 3 ] || [ $((attempt % 6)) -eq 0 ]; then
            show_image_pull_hints
        fi
        sleep 5
    done
    echo "Error: OpenSandbox controller not ready after 300s." >&2
    kubectl_cmd -n "$OPENSANDBOX_CONTROLLER_NAMESPACE" get pods -o wide || true
    show_image_pull_hints
    return 1
}

require_kubectl

# 默认镜像走阿里云；仅当未显式设置 IMAGE_SANDBOX_CONTROLLER 时，才根据 BYCLAW_IMAGE_REGISTRY 改用私有仓库。
if [ -z "$IMAGE_SANDBOX_CONTROLLER_CONFIGURED" ] && [ -n "${BYCLAW_IMAGE_REGISTRY:-}" ]; then
    IMAGE_SANDBOX_CONTROLLER="${BYCLAW_IMAGE_REGISTRY}/opensandbox/controller:v0.2.0"
fi

ensure_helm
prepare_helm_kubeconfig
echo "    kubeconfig: ${HELM_KUBECONFIG}"

chart_tgz="$(resolve_controller_chart_file)"

# Chart 0.1.0 的 CRD 在 templates/crds/ 且含 Helm 模板，须由 helm install 渲染安装，不能 kubectl apply 裸 YAML
log_step "Install OpenSandbox controller via Helm (CRDs + operator)"
echo "    release: ${OPENSANDBOX_CONTROLLER_HELM_RELEASE}"
echo "    namespace: ${OPENSANDBOX_CONTROLLER_NAMESPACE}"
echo "    chart: ${chart_tgz}"
echo "    image: ${IMAGE_SANDBOX_CONTROLLER}"

helm_cmd upgrade --install "$OPENSANDBOX_CONTROLLER_HELM_RELEASE" "$chart_tgz" \
    --namespace "$OPENSANDBOX_CONTROLLER_NAMESPACE" \
    --create-namespace \
    --set "crds.install=true" \
    --set "controller.image.repository=${IMAGE_SANDBOX_CONTROLLER%:*}" \
    --set "controller.image.tag=${IMAGE_SANDBOX_CONTROLLER##*:}"

wait_controller_ready

log_step "OpenSandbox controller install completed"
kubectl_cmd get crd | grep opensandbox || true
