#!/bin/bash
# 根据集群节点 allocatable 动态生成三个 namespace 的 ResourceQuota / LimitRange
# Usage: ./gen-resource-quota.sh [env.k3s] [--dry-run] [--apply]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ENV_FILE="./env.k3s.example"
DRY_RUN=false
APPLY=false

for arg in "$@"; do
    case "$arg" in
        --dry-run) DRY_RUN=true ;;
        --apply) APPLY=true ;;
        *) ENV_FILE="$arg" ;;
    esac
done

if [ ! -f "$ENV_FILE" ] && [ -f "$SCRIPT_DIR/$(basename "$ENV_FILE")" ]; then
    ENV_FILE="$SCRIPT_DIR/$(basename "$ENV_FILE")"
fi
if [ ! -f "$ENV_FILE" ]; then
    echo "Error: $ENV_FILE not found" >&2
    exit 1
fi

set -a
. "$ENV_FILE"
set +a

NS_SERVICE="${NS_SERVICE:-by-service}"
NS_MIDDLEWARE="${NS_MIDDLEWARE:-by-middleware}"
NS_SANDBOX="${NS_SANDBOX:-by-sandbox}"
OPENSANDBOX_WORKLOAD_NAMESPACE="${OPENSANDBOX_WORKLOAD_NAMESPACE:-$NS_SERVICE}"
K3S_DATA_DIR="${K3S_DATA_DIR:-/data/rancher/k3s}"

RESERVE_PCT="${QUOTA_SYSTEM_RESERVE_PERCENT:-15}"
SANDBOX_PCT="${QUOTA_SANDBOX_PERCENT:-70}"
MIDDLEWARE_PCT="${QUOTA_MIDDLEWARE_PERCENT:-10}"
SERVICE_PCT="${QUOTA_SERVICE_PERCENT:-5}"
SANDBOX_XS_ONLINE_TARGET="${SANDBOX_XS_ONLINE_TARGET:-100}"
SANDBOX_XS_CPU_REQUEST_MILLI="${SANDBOX_XS_CPU_REQUEST_MILLI:-250}"
SANDBOX_XS_MEMORY_REQUEST_MI="${SANDBOX_XS_MEMORY_REQUEST_MI:-765}"
SANDBOX_WORKLOAD_POD_BUFFER="${SANDBOX_WORKLOAD_POD_BUFFER:-40}"

if [ $((RESERVE_PCT + SANDBOX_PCT + MIDDLEWARE_PCT + SERVICE_PCT)) -gt 100 ]; then
    echo "Error: quota percentages exceed 100." >&2
    exit 1
fi
if [ "$RESERVE_PCT" -ge 100 ]; then
    echo "Error: QUOTA_SYSTEM_RESERVE_PERCENT must be less than 100." >&2
    exit 1
fi

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

if ! NODE_JSON=$(kubectl_cmd get nodes -o json 2>/dev/null); then
    echo "Warning: cannot read Kubernetes nodes. Using fallback totals from env or defaults." >&2
    TOTAL_CPU_MILLI="${FALLBACK_TOTAL_CPU_MILLI:-72000}"
    TOTAL_MEM_MI="${FALLBACK_TOTAL_MEM_MI:-282624}"
else
    TOTAL_CPU_MILLI=$(printf '%s' "$NODE_JSON" | python3 -c '
import json, sys
data = json.load(sys.stdin)
total = 0
for n in data.get("items", []):
    cpu = n.get("status", {}).get("allocatable", {}).get("cpu", "0")
    if cpu.endswith("m"):
        total += int(cpu[:-1])
    else:
        total += int(float(cpu) * 1000)
print(total)
')
    TOTAL_MEM_MI=$(printf '%s' "$NODE_JSON" | python3 -c '
import json, sys
data = json.load(sys.stdin)
total = 0
for n in data.get("items", []):
    mem = n.get("status", {}).get("allocatable", {}).get("memory", "0")
    if mem.endswith("Ki"):
        total += int(mem[:-2]) // 1024
    elif mem.endswith("Mi"):
        total += int(mem[:-2])
    elif mem.endswith("Gi"):
        total += int(float(mem[:-2]) * 1024)
    else:
        total += int(mem) // (1024 * 1024)
print(total)
')
fi

usable_cpu=$((TOTAL_CPU_MILLI * (100 - RESERVE_PCT) / 100))
usable_mem=$((TOTAL_MEM_MI * (100 - RESERVE_PCT) / 100))
sandbox_cpu=$((usable_cpu * SANDBOX_PCT / (100 - RESERVE_PCT)))
sandbox_mem=$((usable_mem * SANDBOX_PCT / (100 - RESERVE_PCT)))
middleware_cpu=$((usable_cpu * MIDDLEWARE_PCT / (100 - RESERVE_PCT)))
middleware_mem=$((usable_mem * MIDDLEWARE_PCT / (100 - RESERVE_PCT)))
service_cpu=$((usable_cpu * SERVICE_PCT / (100 - RESERVE_PCT)))
service_mem=$((usable_mem * SERVICE_PCT / (100 - RESERVE_PCT)))

# limits 约为 requests 的 1.5~1.8 倍
sandbox_cpu_lim=$((sandbox_cpu * 18 / 10))
sandbox_mem_lim=$((sandbox_mem * 18 / 10))
sandbox_pods=$((sandbox_cpu / 1000 + 20))

required_xs_cpu=$((SANDBOX_XS_ONLINE_TARGET * SANDBOX_XS_CPU_REQUEST_MILLI))
required_xs_mem=$((SANDBOX_XS_ONLINE_TARGET * SANDBOX_XS_MEMORY_REQUEST_MI))
workload_pods=$((SANDBOX_XS_ONLINE_TARGET + SANDBOX_WORKLOAD_POD_BUFFER))

if [ "$sandbox_cpu" -lt "$required_xs_cpu" ]; then
    sandbox_cpu="$required_xs_cpu"
fi
if [ "$sandbox_mem" -lt "$required_xs_mem" ]; then
    sandbox_mem="$required_xs_mem"
fi
if [ "$sandbox_pods" -lt "$workload_pods" ]; then
    sandbox_pods="$workload_pods"
fi

service_quota_cpu="$service_cpu"
service_quota_mem="$service_mem"
service_quota_pods=30
sandbox_quota_cpu="$sandbox_cpu"
sandbox_quota_mem="$sandbox_mem"
sandbox_quota_cpu_lim="$sandbox_cpu_lim"
sandbox_quota_mem_lim="$sandbox_mem_lim"
sandbox_quota_pods="$sandbox_pods"
sandbox_quota_pvcs="$sandbox_pods"

if [ "$OPENSANDBOX_WORKLOAD_NAMESPACE" = "$NS_SERVICE" ]; then
    service_quota_cpu=$((service_cpu + sandbox_cpu))
    service_quota_mem=$((service_mem + sandbox_mem))
    service_quota_pods="$workload_pods"
    # by-sandbox only hosts OpenSandbox control-plane pods in this topology.
    sandbox_quota_cpu="${OPENSANDBOX_NAMESPACE_CPU_MILLI:-6000}"
    sandbox_quota_mem="${OPENSANDBOX_NAMESPACE_MEMORY_MI:-16384}"
    sandbox_quota_cpu_lim="${OPENSANDBOX_NAMESPACE_LIMIT_CPU_MILLI:-12000}"
    sandbox_quota_mem_lim="${OPENSANDBOX_NAMESPACE_LIMIT_MEMORY_MI:-32768}"
    sandbox_quota_pods="${OPENSANDBOX_NAMESPACE_PODS:-30}"
    sandbox_quota_pvcs="${OPENSANDBOX_NAMESPACE_PVCS:-5}"
fi

format_cpu() {
    local milli=$1
    echo "\"${milli}m\""
}

format_mem() {
    echo "\"${1}Mi\""
}

format_mem_gi() {
    local mi=$1
    if [ "$mi" -ge 1024 ]; then
        echo "\"$((mi / 1024))Gi\""
    else
        echo "\"${mi}Mi\""
    fi
}

OUT="${RESOURCE_QUOTA_OUTPUT:-./generated/60-monitoring/generated-resource-quota.yaml}"
mkdir -p "$(dirname "$OUT")"

cat > "$OUT" <<EOF
# Auto-generated by gen-resource-quota.sh
# Cluster allocatable: CPU=${TOTAL_CPU_MILLI}m Memory=${TOTAL_MEM_MI}Mi
# Reserve ${RESERVE_PCT}%, sandbox ${SANDBOX_PCT}%, middleware ${MIDDLEWARE_PCT}%, service ${SERVICE_PCT}%
# OpenSandbox workload namespace: ${OPENSANDBOX_WORKLOAD_NAMESPACE}
# Sandbox xs target: ${SANDBOX_XS_ONLINE_TARGET} pods @ ${SANDBOX_XS_CPU_REQUEST_MILLI}m/${SANDBOX_XS_MEMORY_REQUEST_MI}Mi
---
apiVersion: v1
kind: ResourceQuota
metadata:
  name: sandbox-quota
  namespace: ${NS_SANDBOX}
spec:
  hard:
    requests.cpu: $(format_cpu "$sandbox_quota_cpu")
    requests.memory: $(format_mem_gi "$sandbox_quota_mem")
    limits.cpu: $(format_cpu "$sandbox_quota_cpu_lim")
    limits.memory: $(format_mem_gi "$sandbox_quota_mem_lim")
    pods: "${sandbox_quota_pods}"
    persistentvolumeclaims: "${sandbox_quota_pvcs}"
---
apiVersion: v1
kind: LimitRange
metadata:
  name: sandbox-defaults
  namespace: ${NS_SANDBOX}
spec:
  limits:
    - type: Container
      defaultRequest:
        cpu: "1"
        memory: "2Gi"
      default:
        cpu: "2"
        memory: "4Gi"
---
apiVersion: v1
kind: ResourceQuota
metadata:
  name: middleware-quota
  namespace: ${NS_MIDDLEWARE}
spec:
  hard:
    requests.cpu: $(format_cpu "$middleware_cpu")
    requests.memory: $(format_mem_gi "$middleware_mem")
    pods: "50"
---
apiVersion: v1
kind: ResourceQuota
metadata:
  name: service-quota
  namespace: ${NS_SERVICE}
spec:
  hard:
    requests.cpu: $(format_cpu "$service_quota_cpu")
    requests.memory: $(format_mem_gi "$service_quota_mem")
    pods: "${service_quota_pods}"
    persistentvolumeclaims: "5"
EOF

echo "Generated $OUT"
echo "  workload namespace: ${OPENSANDBOX_WORKLOAD_NAMESPACE}"
echo "  sandbox:  CPU req=$(format_cpu "$sandbox_quota_cpu") mem=$(format_mem_gi "$sandbox_quota_mem") pods~${sandbox_quota_pods}"
echo "  middleware: CPU req=$(format_cpu "$middleware_cpu") mem=$(format_mem_gi "$middleware_mem")"
echo "  service:  CPU req=$(format_cpu "$service_quota_cpu") mem=$(format_mem_gi "$service_quota_mem") pods~${service_quota_pods}"

if [ "$DRY_RUN" = true ]; then
    cat "$OUT"
    exit 0
fi

if [ "$APPLY" = true ]; then
    kubectl_cmd apply -f "$OUT"
    echo "Applied resource quotas."
fi
