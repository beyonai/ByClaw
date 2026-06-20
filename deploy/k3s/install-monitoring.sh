#!/bin/bash
# Install ByClaw Prometheus/Grafana monitoring without external Helm chart repos.
# Usage: bash deploy/k3s/install-monitoring.sh [env.k3s]
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

K3S_DATA_DIR="${K3S_DATA_DIR:-/data/rancher/k3s}"
if [ -z "${KUBECONFIG:-}" ] && [ -f "${K3S_DATA_DIR}/server/kubeconfig" ]; then
    export KUBECONFIG="${K3S_DATA_DIR}/server/kubeconfig"
fi

NS_MONITORING="${NS_MONITORING:-monitoring}"
STORAGE_CLASS="${STORAGE_CLASS:-longhorn}"
K3S_API_HOST="${K3S_API_HOST:-127.0.0.1}"
MONITORING_EXTERNAL_BASE_URL="${MONITORING_EXTERNAL_BASE_URL:-http://${K3S_API_HOST}}"
MONITORING_PROMETHEUS_RETENTION="${MONITORING_PROMETHEUS_RETENTION:-15d}"
MONITORING_PROMETHEUS_PVC_SIZE="${MONITORING_PROMETHEUS_PVC_SIZE:-50Gi}"
MONITORING_ALERTMANAGER_PVC_SIZE="${MONITORING_ALERTMANAGER_PVC_SIZE:-2Gi}"
MONITORING_GRAFANA_PVC_SIZE="${MONITORING_GRAFANA_PVC_SIZE:-10Gi}"
IMAGE_PROMETHEUS="${IMAGE_PROMETHEUS:-quay.io/prometheus/prometheus:v2.55.1}"
IMAGE_ALERTMANAGER="${IMAGE_ALERTMANAGER:-quay.io/prometheus/alertmanager:v0.27.0}"
IMAGE_PROMETHEUS_WEBHOOK_DINGTALK="${IMAGE_PROMETHEUS_WEBHOOK_DINGTALK:-timonwong/prometheus-webhook-dingtalk:v2.1.0}"
IMAGE_NODE_EXPORTER="${IMAGE_NODE_EXPORTER:-quay.io/prometheus/node-exporter:v1.8.2}"
IMAGE_KUBE_STATE_METRICS="${IMAGE_KUBE_STATE_METRICS:-m.daocloud.io/registry.k8s.io/kube-state-metrics/kube-state-metrics:v2.14.0}"
IMAGE_GRAFANA="${IMAGE_GRAFANA:-grafana/grafana:11.3.1}"
NS_SERVICE="${NS_SERVICE:-by-service}"
OPENSANDBOX_WORKLOAD_NAMESPACE="${OPENSANDBOX_WORKLOAD_NAMESPACE:-$NS_SERVICE}"
ALERTMANAGER_WEBHOOK_URL="${ALERTMANAGER_WEBHOOK_URL:-http://byclaw-be.${NS_SERVICE}.svc.cluster.local:8086/byaiService/sandbox/autoscale/alerts}"
SANDBOX_AUTOSCALE_DINGTALK_ENABLED="${SANDBOX_AUTOSCALE_DINGTALK_ENABLED:-false}"
SANDBOX_AUTOSCALE_DINGTALK_SERVICE_NAME="${SANDBOX_AUTOSCALE_DINGTALK_SERVICE_NAME:-prometheus-webhook-dingtalk}"
SANDBOX_AUTOSCALE_DINGTALK_TARGET="${SANDBOX_AUTOSCALE_DINGTALK_TARGET:-sandbox}"
SANDBOX_AUTOSCALE_DINGTALK_TIMEOUT="${SANDBOX_AUTOSCALE_DINGTALK_TIMEOUT:-5s}"
SANDBOX_AUTOSCALE_DINGTALK_SEND_RESOLVED="${SANDBOX_AUTOSCALE_DINGTALK_SEND_RESOLVED:-false}"
SANDBOX_AUTOSCALE_DINGTALK_WEBHOOK_URL="${SANDBOX_AUTOSCALE_DINGTALK_WEBHOOK_URL:-}"
SANDBOX_AUTOSCALE_DINGTALK_SECRET="${SANDBOX_AUTOSCALE_DINGTALK_SECRET:-}"
SANDBOX_AUTOSCALE_DINGTALK_RECEIVER_URL="${SANDBOX_AUTOSCALE_DINGTALK_RECEIVER_URL:-http://${SANDBOX_AUTOSCALE_DINGTALK_SERVICE_NAME}.${NS_MONITORING}.svc.cluster.local:8060/dingtalk/${SANDBOX_AUTOSCALE_DINGTALK_TARGET}/send}"

is_true() {
    case "${1:-}" in
        true|TRUE|True|1|yes|YES|Yes|y|Y|on|ON|On)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

SANDBOX_AUTOSCALE_DINGTALK_ACTIVE=false
SANDBOX_AUTOSCALE_DINGTALK_SEND_RESOLVED_VALUE=false
ALERTMANAGER_DINGTALK_WEBHOOK_CONFIG=""
PROMETHEUS_WEBHOOK_DINGTALK_SECRET_CONFIG=""
if is_true "${SANDBOX_AUTOSCALE_DINGTALK_ENABLED}"; then
    SANDBOX_AUTOSCALE_DINGTALK_ACTIVE=true
    if is_true "${SANDBOX_AUTOSCALE_DINGTALK_SEND_RESOLVED}"; then
        SANDBOX_AUTOSCALE_DINGTALK_SEND_RESOLVED_VALUE=true
    fi
    if [ -z "${SANDBOX_AUTOSCALE_DINGTALK_WEBHOOK_URL}" ]; then
        echo "Error: SANDBOX_AUTOSCALE_DINGTALK_ENABLED=true requires SANDBOX_AUTOSCALE_DINGTALK_WEBHOOK_URL." >&2
        exit 1
    fi
    if [ -z "${SANDBOX_AUTOSCALE_DINGTALK_TARGET}" ]; then
        echo "Error: SANDBOX_AUTOSCALE_DINGTALK_TARGET cannot be empty when DingTalk alerting is enabled." >&2
        exit 1
    fi
    ALERTMANAGER_DINGTALK_WEBHOOK_CONFIG="          - url: \"${SANDBOX_AUTOSCALE_DINGTALK_RECEIVER_URL}\"
            send_resolved: ${SANDBOX_AUTOSCALE_DINGTALK_SEND_RESOLVED_VALUE}"
    if [ -n "${SANDBOX_AUTOSCALE_DINGTALK_SECRET}" ]; then
        PROMETHEUS_WEBHOOK_DINGTALK_SECRET_CONFIG="        secret: \"${SANDBOX_AUTOSCALE_DINGTALK_SECRET}\""
    fi
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

require_kubectl() {
    if ! kubectl_cmd get nodes --request-timeout=15s >/dev/null 2>&1; then
        echo "Error: cannot reach k3s API. Set KUBECONFIG=${K3S_DATA_DIR}/server/kubeconfig or run on a server node." >&2
        exit 1
    fi
}

random_password() {
    if command -v openssl >/dev/null 2>&1; then
        openssl rand -base64 24 | tr -d '=+/' | cut -c1-24
        return 0
    fi
    tr -dc A-Za-z0-9 </dev/urandom | head -c 24
}

resolve_grafana_password() {
    if [ -n "${MONITORING_GRAFANA_ADMIN_PASSWORD:-}" ]; then
        printf '%s' "$MONITORING_GRAFANA_ADMIN_PASSWORD"
        return 0
    fi
    if kubectl_cmd -n "$NS_MONITORING" get secret grafana-admin >/dev/null 2>&1; then
        kubectl_cmd -n "$NS_MONITORING" get secret grafana-admin \
            -o jsonpath='{.data.admin-password}' | base64 -d
        return 0
    fi
    random_password
}

wait_monitoring_ready() {
    local timeout="${BYCLAW_K3S_MONITORING_WAIT_TIMEOUT_SECONDS:-300}"
    echo "========== Waiting for monitoring =========="
    kubectl_cmd -n "$NS_MONITORING" rollout status deploy/prometheus --timeout="${timeout}s"
    kubectl_cmd -n "$NS_MONITORING" rollout status deploy/alertmanager --timeout="${timeout}s"
    if [ "${SANDBOX_AUTOSCALE_DINGTALK_ACTIVE}" = "true" ]; then
        kubectl_cmd -n "$NS_MONITORING" rollout status "deploy/${SANDBOX_AUTOSCALE_DINGTALK_SERVICE_NAME}" --timeout="${timeout}s"
    fi
    kubectl_cmd -n "$NS_MONITORING" rollout status deploy/grafana --timeout="${timeout}s"
    kubectl_cmd -n "$NS_MONITORING" rollout status deploy/kube-state-metrics --timeout="${timeout}s"
    kubectl_cmd -n "$NS_MONITORING" rollout status ds/node-exporter --timeout="${timeout}s"
}

verify_prometheus_targets() {
    local pod
    pod="$(kubectl_cmd -n "$NS_MONITORING" get pod -l app=prometheus \
        -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
    if [ -z "$pod" ]; then
        return 0
    fi
    echo "========== Prometheus targets =========="
    kubectl_cmd -n "$NS_MONITORING" exec "$pod" -- sh -lc \
        'wget -qO- http://127.0.0.1:9090/prometheus/api/v1/targets 2>/dev/null | sed "s/,/,\n/g" | grep -E "\"health\":\"(up|down)\"|\"job\"" | head -80' || true
}

create_grafana_dashboards() {
    local grafana_url="${MONITORING_EXTERNAL_BASE_URL%/}/grafana"
    local dashboard_dir="${SCRIPT_DIR}/manifests/monitoring/dashboards"
    if ! command -v curl >/dev/null 2>&1; then
        echo "Warning: curl not found; skip Grafana dashboard import." >&2
        return 0
    fi
    if [ ! -d "$dashboard_dir" ]; then
        echo "Warning: dashboard directory not found: ${dashboard_dir}" >&2
        return 0
    fi
    echo "========== Importing Grafana dashboards =========="
    local dashboard_file import_ok=0
    for dashboard_file in "$dashboard_dir"/*.json; do
        [ -f "$dashboard_file" ] || continue
        if curl -fsS --retry 20 --retry-delay 3 \
            -u "admin:${GRAFANA_ADMIN_PASSWORD}" \
            -H "Content-Type: application/json" \
            -X POST "${grafana_url}/api/dashboards/db" \
            --data-binary "@${dashboard_file}" >/tmp/byclaw-grafana-import.json; then
            python3 - <<'PY' /tmp/byclaw-grafana-import.json "$(basename "$dashboard_file")"
import json, sys
payload = json.load(open(sys.argv[1]))
name = sys.argv[2]
print(f"    imported {name}: {payload.get('url', 'ok')}")
PY
            import_ok=1
        else
            echo "Warning: failed to import ${dashboard_file} through ${grafana_url}" >&2
        fi
    done
    if [ "$import_ok" -eq 0 ]; then
        echo "Warning: no Grafana dashboards imported; monitoring stack is still installed." >&2
    fi
}

require_kubectl

GRAFANA_ADMIN_PASSWORD="$(resolve_grafana_password)"

echo "========== Installing monitoring =========="
echo "    namespace: ${NS_MONITORING}"
echo "    external base URL: ${MONITORING_EXTERNAL_BASE_URL}"
echo "    Prometheus: ${MONITORING_EXTERNAL_BASE_URL}/prometheus"
echo "    Alertmanager: ${MONITORING_EXTERNAL_BASE_URL}/alertmanager"
echo "    Grafana: ${MONITORING_EXTERNAL_BASE_URL}/grafana"

kubectl_cmd create namespace "$NS_MONITORING" --dry-run=client -o yaml | kubectl_cmd apply -f -

cat <<EOF | kubectl_cmd apply -f -
apiVersion: v1
kind: ServiceAccount
metadata:
  name: prometheus
  namespace: ${NS_MONITORING}
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: byclaw-prometheus
rules:
  - apiGroups: [""]
    resources: ["nodes", "nodes/proxy", "services", "endpoints", "pods", "ingresses", "configmaps"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["extensions", "networking.k8s.io"]
    resources: ["ingresses"]
    verbs: ["get", "list", "watch"]
  - nonResourceURLs: ["/metrics"]
    verbs: ["get"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: byclaw-prometheus
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: byclaw-prometheus
subjects:
  - kind: ServiceAccount
    name: prometheus
    namespace: ${NS_MONITORING}
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: alertmanager-config
  namespace: ${NS_MONITORING}
data:
  alertmanager.yml: |
    global:
      resolve_timeout: 5m
    route:
      receiver: byclaw-autoscale
      group_by: ["alertname", "namespace", "pod", "sandboxId", "alertActionType", "reasonCode"]
      group_wait: ${ALERTMANAGER_AUTOSCALE_GROUP_WAIT:-5s}
      group_interval: ${ALERTMANAGER_AUTOSCALE_GROUP_INTERVAL:-1m}
      repeat_interval: ${ALERTMANAGER_AUTOSCALE_REPEAT_INTERVAL:-1h}
    receivers:
      - name: byclaw-autoscale
        webhook_configs:
          - url: "${ALERTMANAGER_WEBHOOK_URL}"
            send_resolved: false
${ALERTMANAGER_DINGTALK_WEBHOOK_CONFIG}
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: prometheus-sandbox-autoscale-rules
  namespace: ${NS_MONITORING}
data:
  sandbox-autoscale-rules.yml: |
    groups:
      - name: byclaw.sandbox.autoscale
        interval: ${SANDBOX_AUTOSCALE_RULE_INTERVAL:-15s}
        rules:
          - alert: OpenClawSandboxCpuHigh
            expr: |
              (
                label_replace(
                  sum by (namespace, pod) (
                    rate(container_cpu_usage_seconds_total{
                    namespace="${OPENSANDBOX_WORKLOAD_NAMESPACE}",
                    container="sandbox",
                    pod=~"[0-9a-f-]{36}-[0-9]+"
                  }[${SANDBOX_AUTOSCALE_CPU_RATE_WINDOW:-1m}])
                )
                /
                sum by (namespace, pod) (
                  kube_pod_container_resource_requests{
                    namespace="${OPENSANDBOX_WORKLOAD_NAMESPACE}",
                    container="sandbox",
                    resource="cpu"
                  }
                ) > ${SANDBOX_AUTOSCALE_CPU_HIGH_RATIO:-1.00}
                and on (namespace, pod)
                kube_pod_status_phase{
                  namespace="${OPENSANDBOX_WORKLOAD_NAMESPACE}",
                  phase="Running",
                  pod=~"[0-9a-f-]{36}-[0-9]+"
                } == 1,
                  "sandboxId", "\$1", "pod", "^([0-9a-f-]{36})-[0-9]+$"
                )
                * on (sandboxId) group_left(userCode, profileKey)
                byclaw_sandbox_autoscale_runtime_info
              )
              unless on (sandboxId)
              byclaw_sandbox_autoscale_boundary_blacklist{direction="up"} == 1
            for: ${SANDBOX_AUTOSCALE_CPU_HIGH_FOR:-30s}
            labels:
              severity: warning
              serviceType: openclaw
              triggerSource: PROMETHEUS_ALERT
              reasonCode: metrics.cpu.high
              alertActionType: AUTOSCALE
              alertActionName: 升配
              alertActionIcon: "📈"
              resizeType: IN_PLACE
              resizeDirection: up
            annotations:
              summary: "OpenClaw 沙箱 CPU 持续偏高"
              reason_detail: "CPU 使用率连续 ${SANDBOX_AUTOSCALE_CPU_HIGH_FOR:-30s} 超过 request 的 ${SANDBOX_AUTOSCALE_CPU_HIGH_PERCENT:-100}%，建议原地升一级规格。pod={{ \$labels.pod }} value={{ \$value }}"

          - alert: OpenClawSandboxMemoryHigh
            expr: |
              (
                label_replace(
                  sum by (namespace, pod) (
                    container_memory_working_set_bytes{
                    namespace="${OPENSANDBOX_WORKLOAD_NAMESPACE}",
                    container="sandbox",
                    pod=~"[0-9a-f-]{36}-[0-9]+"
                  }
                )
                /
                sum by (namespace, pod) (
                  kube_pod_container_resource_requests{
                    namespace="${OPENSANDBOX_WORKLOAD_NAMESPACE}",
                    container="sandbox",
                    resource="memory"
                  }
                ) > ${SANDBOX_AUTOSCALE_MEMORY_HIGH_RATIO:-0.55}
                and on (namespace, pod)
                kube_pod_status_phase{
                  namespace="${OPENSANDBOX_WORKLOAD_NAMESPACE}",
                  phase="Running",
                  pod=~"[0-9a-f-]{36}-[0-9]+"
                } == 1,
                  "sandboxId", "\$1", "pod", "^([0-9a-f-]{36})-[0-9]+$"
                )
                * on (sandboxId) group_left(userCode, profileKey)
                byclaw_sandbox_autoscale_runtime_info
              )
              unless on (sandboxId)
              byclaw_sandbox_autoscale_boundary_blacklist{direction="up"} == 1
            for: ${SANDBOX_AUTOSCALE_MEMORY_HIGH_FOR:-15s}
            labels:
              severity: warning
              serviceType: openclaw
              triggerSource: PROMETHEUS_ALERT
              reasonCode: metrics.memory.high
              alertActionType: AUTOSCALE
              alertActionName: 升配
              alertActionIcon: "📈"
              resizeType: IN_PLACE
              resizeDirection: up
            annotations:
              summary: "OpenClaw 沙箱内存持续偏高"
              reason_detail: "内存 Working Set 连续 ${SANDBOX_AUTOSCALE_MEMORY_HIGH_FOR:-15s} 超过 request 的 ${SANDBOX_AUTOSCALE_MEMORY_HIGH_PERCENT:-55}%，建议原地升一级规格。pod={{ \$labels.pod }} value={{ \$value }}"

          - alert: OpenClawSandboxMemoryCritical
            expr: |
              (
                label_replace(
                  sum by (namespace, pod) (
                    container_memory_working_set_bytes{
                    namespace="${OPENSANDBOX_WORKLOAD_NAMESPACE}",
                    container="sandbox",
                    pod=~"[0-9a-f-]{36}-[0-9]+"
                  }
                )
                /
                sum by (namespace, pod) (
                  kube_pod_container_resource_limits{
                    namespace="${OPENSANDBOX_WORKLOAD_NAMESPACE}",
                    container="sandbox",
                    resource="memory"
                  }
                ) > ${SANDBOX_AUTOSCALE_MEMORY_CRITICAL_RATIO:-0.75}
                and on (namespace, pod)
                kube_pod_status_phase{
                  namespace="${OPENSANDBOX_WORKLOAD_NAMESPACE}",
                  phase="Running",
                  pod=~"[0-9a-f-]{36}-[0-9]+"
                } == 1,
                  "sandboxId", "\$1", "pod", "^([0-9a-f-]{36})-[0-9]+$"
                )
                * on (sandboxId) group_left(userCode, profileKey)
                byclaw_sandbox_autoscale_runtime_info
              )
              unless on (sandboxId)
              byclaw_sandbox_autoscale_boundary_blacklist{direction="up"} == 1
            for: ${SANDBOX_AUTOSCALE_MEMORY_CRITICAL_FOR:-30s}
            labels:
              severity: critical
              serviceType: openclaw
              triggerSource: PROMETHEUS_ALERT
              reasonCode: metrics.memory.critical
              alertActionType: AUTOSCALE
              alertActionName: 升配
              alertActionIcon: "📈"
              resizeType: IN_PLACE
              resizeDirection: up
            annotations:
              summary: "OpenClaw 沙箱内存接近上限"
              reason_detail: "内存 Working Set 连续 ${SANDBOX_AUTOSCALE_MEMORY_CRITICAL_FOR:-30s} 超过 limit 的 ${SANDBOX_AUTOSCALE_MEMORY_CRITICAL_PERCENT:-75}%，建议立即原地升配。pod={{ \$labels.pod }} value={{ \$value }}"
          - alert: OpenClawSandboxOOMKilled
            expr: |
              (
                label_replace(
                  (
                    kube_pod_container_status_terminated_reason{
                      namespace="${OPENSANDBOX_WORKLOAD_NAMESPACE}",
                      container="sandbox",
                      reason="OOMKilled",
                      pod=~"[0-9a-f-]{36}-[0-9]+"
                    } == 1
                    unless
                    kube_pod_container_status_terminated_reason{
                      namespace="${OPENSANDBOX_WORKLOAD_NAMESPACE}",
                      container="sandbox",
                      reason="OOMKilled",
                      pod=~"[0-9a-f-]{36}-[0-9]+"
                    } offset ${SANDBOX_AUTOSCALE_OOM_LOOKBACK:-5m} == 1
                  )
                  or
                  (
                    increase(kube_pod_container_status_last_terminated_reason{
                      namespace="${OPENSANDBOX_WORKLOAD_NAMESPACE}",
                      container="sandbox",
                      reason="OOMKilled",
                      pod=~"[0-9a-f-]{36}-[0-9]+"
                    }[${SANDBOX_AUTOSCALE_OOM_LOOKBACK:-5m}]) > 0
                  ),
                  "sandboxId", "\$1", "pod", "^([0-9a-f-]{36})-[0-9]+$"
                )
                * on (sandboxId) group_left(userCode, profileKey)
                byclaw_sandbox_autoscale_runtime_info
              )
            labels:
              severity: critical
              serviceType: openclaw
              triggerSource: PROMETHEUS_ALERT
              reasonCode: metrics.memory.oom_killed
              alertActionType: ABNORMAL_RECOVERY
              alertActionName: 异常自动恢复
              alertActionIcon: "🧯"
              resizeType: RECOVERY_RESTART
              resizeDirection: recovery
            annotations:
              summary: "OpenClaw 沙箱 OOMKilled"
              reason_detail: "沙箱容器最近 ${SANDBOX_AUTOSCALE_OOM_LOOKBACK:-5m} 发生 OOMKilled，建议保存目标规格偏好并自动重启恢复。pod={{ \$labels.pod }} value={{ \$value }}"

          - alert: OpenClawSandboxImagePullFailed
            expr: |
              (
                label_replace(
                  max by (namespace, pod) (
                    kube_pod_container_status_waiting_reason{
                      namespace="${OPENSANDBOX_WORKLOAD_NAMESPACE}",
                      container="sandbox",
                      reason=~"ErrImagePull|ImagePullBackOff|InvalidImageName",
                      pod=~"[0-9a-f-]{36}-[0-9]+"
                    } == 1
                  ),
                  "sandboxId", "\$1", "pod", "^([0-9a-f-]{36})-[0-9]+$"
                )
                * on (sandboxId) group_left(userCode, profileKey)
                byclaw_sandbox_autoscale_runtime_info
              )
            for: ${SANDBOX_AUTOSCALE_IMAGE_PULL_FAILED_FOR:-1m}
            labels:
              severity: critical
              serviceType: openclaw
              triggerSource: PROMETHEUS_ALERT
              reasonCode: ops.image_pull_failed
              alertActionType: OPS_INCIDENT
              alertActionName: 运维异常
              alertActionIcon: "🚨"
              resizeType: OPS_INCIDENT
            annotations:
              summary: "OpenClaw 沙箱镜像拉取失败"
              reason_detail: "沙箱容器镜像拉取失败，可能是 Harbor 不可用、镜像 tag 不存在或镜像名非法。pod={{ \$labels.pod }} value={{ \$value }}"

          - alert: OpenClawSandboxStartupFailed
            expr: |
              (
                label_replace(
                  max by (namespace, pod) (
                    kube_pod_container_status_waiting_reason{
                      namespace="${OPENSANDBOX_WORKLOAD_NAMESPACE}",
                      container="sandbox",
                      reason=~"CrashLoopBackOff|RunContainerError|CreateContainerConfigError|CreateContainerError",
                      pod=~"[0-9a-f-]{36}-[0-9]+"
                    } == 1
                  ),
                  "sandboxId", "\$1", "pod", "^([0-9a-f-]{36})-[0-9]+$"
                )
                * on (sandboxId) group_left(userCode, profileKey)
                byclaw_sandbox_autoscale_runtime_info
              )
            for: ${SANDBOX_AUTOSCALE_STARTUP_FAILED_FOR:-1m}
            labels:
              severity: critical
              serviceType: openclaw
              triggerSource: PROMETHEUS_ALERT
              reasonCode: recovery.startup_failed
              alertActionType: ABNORMAL_RECOVERY
              alertActionName: 异常自动恢复
              alertActionIcon: "🧯"
              resizeType: RECOVERY_RESTART
              resizeDirection: recovery
            annotations:
              summary: "OpenClaw 沙箱启动异常"
              reason_detail: "沙箱容器启动失败或启动脚本异常，建议保存目标规格偏好并重启恢复。pod={{ \$labels.pod }} value={{ \$value }}"

          - alert: OpenClawSandboxRestartLoop
            expr: |
              (
                label_replace(
                  increase(kube_pod_container_status_restarts_total{
                    namespace="${OPENSANDBOX_WORKLOAD_NAMESPACE}",
                    container="sandbox",
                    pod=~"[0-9a-f-]{36}-[0-9]+"
                  }[${SANDBOX_AUTOSCALE_RESTART_LOOP_WINDOW:-5m}]) >= ${SANDBOX_AUTOSCALE_RESTART_LOOP_THRESHOLD:-2},
                  "sandboxId", "\$1", "pod", "^([0-9a-f-]{36})-[0-9]+$"
                )
                * on (sandboxId) group_left(userCode, profileKey)
                byclaw_sandbox_autoscale_runtime_info
              )
            for: ${SANDBOX_AUTOSCALE_RESTART_LOOP_FOR:-30s}
            labels:
              severity: critical
              serviceType: openclaw
              triggerSource: PROMETHEUS_ALERT
              reasonCode: recovery.restart_loop
              alertActionType: ABNORMAL_RECOVERY
              alertActionName: 异常自动恢复
              alertActionIcon: "🧯"
              resizeType: RECOVERY_RESTART
              resizeDirection: recovery
            annotations:
              summary: "OpenClaw 沙箱容器反复重启"
              reason_detail: "沙箱容器 ${SANDBOX_AUTOSCALE_RESTART_LOOP_WINDOW:-5m} 内重启次数达到阈值 ${SANDBOX_AUTOSCALE_RESTART_LOOP_THRESHOLD:-2}，建议自动重启恢复。pod={{ \$labels.pod }} value={{ \$value }}"

          - alert: OpenClawSandboxServiceUnavailable
            expr: |
              (
                label_replace(
                  (
                    kube_pod_status_phase{
                      namespace="${OPENSANDBOX_WORKLOAD_NAMESPACE}",
                      phase="Running",
                      pod=~"[0-9a-f-]{36}-[0-9]+"
                    } == 1
                  )
                  and on (namespace, pod)
                  max by (namespace, pod) (
                    kube_pod_container_status_ready{
                      namespace="${OPENSANDBOX_WORKLOAD_NAMESPACE}",
                      container="sandbox",
                      pod=~"[0-9a-f-]{36}-[0-9]+"
                    } == 0
                  ),
                  "sandboxId", "\$1", "pod", "^([0-9a-f-]{36})-[0-9]+$"
                )
                * on (sandboxId) group_left(userCode, profileKey)
                byclaw_sandbox_autoscale_runtime_info
              )
            for: ${SANDBOX_AUTOSCALE_SERVICE_UNAVAILABLE_FOR:-60s}
            labels:
              severity: critical
              serviceType: openclaw
              triggerSource: PROMETHEUS_ALERT
              reasonCode: ops.service_unavailable
              alertActionType: OPS_INCIDENT
              alertActionName: 运维异常
              alertActionIcon: "🚨"
              resizeType: OPS_INCIDENT
            annotations:
              summary: "OpenClaw 沙箱服务不可用"
              reason_detail: "沙箱 Pod 已处于 Running，但容器 ${SANDBOX_AUTOSCALE_SERVICE_UNAVAILABLE_FOR:-60s} 内未 ready，服务端口可能未提供服务。pod={{ \$labels.pod }} value={{ \$value }}"

          - alert: OpenClawSandboxLowUsage
            expr: |
              (
                label_replace(
                  (
                    sum by (namespace, pod) (
                      rate(container_cpu_usage_seconds_total{
                        namespace="${OPENSANDBOX_WORKLOAD_NAMESPACE}",
                        container="sandbox",
                        pod=~"[0-9a-f-]{36}-[0-9]+"
                      }[${SANDBOX_AUTOSCALE_CPU_LOW_RATE_WINDOW:-1m}])
                    )
                    /
                    sum by (namespace, pod) (
                      kube_pod_container_resource_requests{
                        namespace="${OPENSANDBOX_WORKLOAD_NAMESPACE}",
                        container="sandbox",
                        resource="cpu"
                      }
                    ) < ${SANDBOX_AUTOSCALE_CPU_LOW_RATIO:-0.25}
                  )
                  and on (namespace, pod)
                  (
                    sum by (namespace, pod) (
                      container_memory_working_set_bytes{
                        namespace="${OPENSANDBOX_WORKLOAD_NAMESPACE}",
                        container="sandbox",
                        pod=~"[0-9a-f-]{36}-[0-9]+"
                      }
                    )
                    /
                    sum by (namespace, pod) (
                      kube_pod_container_resource_requests{
                        namespace="${OPENSANDBOX_WORKLOAD_NAMESPACE}",
                        container="sandbox",
                        resource="memory"
                      }
                    ) < ${SANDBOX_AUTOSCALE_MEMORY_LOW_RATIO:-0.50}
                  )
                  and on (namespace, pod)
                  kube_pod_status_phase{
                    namespace="${OPENSANDBOX_WORKLOAD_NAMESPACE}",
                    phase="Running",
                    pod=~"[0-9a-f-]{36}-[0-9]+"
                  } == 1,
                  "sandboxId", "\$1", "pod", "^([0-9a-f-]{36})-[0-9]+$"
                )
                * on (sandboxId) group_left(userCode, profileKey)
                byclaw_sandbox_autoscale_runtime_info
              )
              unless on (sandboxId)
              byclaw_sandbox_autoscale_boundary_blacklist{direction="down"} == 1
            for: ${SANDBOX_AUTOSCALE_LOW_USAGE_FOR:-5m}
            labels:
              severity: info
              serviceType: openclaw
              triggerSource: PROMETHEUS_ALERT
              reasonCode: metrics.low_usage
              alertActionType: AUTOSCALE
              alertActionName: 降配
              alertActionIcon: "📉"
              resizeType: IN_PLACE
              resizeDirection: down
            annotations:
              summary: "OpenClaw 沙箱资源长期低使用"
              reason_detail: "CPU 连续 ${SANDBOX_AUTOSCALE_LOW_USAGE_FOR:-5m} 低于 request 的 ${SANDBOX_AUTOSCALE_CPU_LOW_PERCENT:-25}% 且内存低于 request 的 ${SANDBOX_AUTOSCALE_MEMORY_LOW_PERCENT:-50}%，建议原地降一级规格。pod={{ \$labels.pod }} value={{ \$value }}"
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: prometheus-config
  namespace: ${NS_MONITORING}
data:
  prometheus.yml: |
    global:
      scrape_interval: ${MONITORING_PROMETHEUS_SCRAPE_INTERVAL:-15s}
      evaluation_interval: ${MONITORING_PROMETHEUS_EVALUATION_INTERVAL:-15s}
    alerting:
      alertmanagers:
        - path_prefix: /alertmanager
          static_configs:
            - targets: ["alertmanager.${NS_MONITORING}.svc.cluster.local:9093"]
    rule_files:
      - /etc/prometheus/rules/*.yml
    scrape_configs:
      - job_name: prometheus
        metrics_path: /prometheus/metrics
        static_configs:
          - targets: ["127.0.0.1:9090"]

      - job_name: byclaw-sandbox-autoscale-boundary-blacklist
        metrics_path: /byaiService/sandbox/autoscale/boundary-blacklist/metrics
        static_configs:
          - targets: ["byclaw-be.${NS_SERVICE}.svc.cluster.local:${BE_SERVER_PORT:-8086}"]

      - job_name: kubernetes-apiservers
        kubernetes_sd_configs:
          - role: endpoints
        scheme: https
        tls_config:
          ca_file: /var/run/secrets/kubernetes.io/serviceaccount/ca.crt
        bearer_token_file: /var/run/secrets/kubernetes.io/serviceaccount/token
        relabel_configs:
          - source_labels: [__meta_kubernetes_namespace, __meta_kubernetes_service_name, __meta_kubernetes_endpoint_port_name]
            action: keep
            regex: default;kubernetes;https

      - job_name: kubernetes-nodes
        scheme: https
        tls_config:
          insecure_skip_verify: true
        bearer_token_file: /var/run/secrets/kubernetes.io/serviceaccount/token
        kubernetes_sd_configs:
          - role: node
        relabel_configs:
          - action: labelmap
            regex: __meta_kubernetes_node_label_(.+)
          - target_label: __address__
            replacement: kubernetes.default.svc:443
          - source_labels: [__meta_kubernetes_node_name]
            regex: (.+)
            target_label: __metrics_path__
            replacement: /api/v1/nodes/\$1/proxy/metrics

      - job_name: kubernetes-nodes-cadvisor
        scheme: https
        tls_config:
          insecure_skip_verify: true
        bearer_token_file: /var/run/secrets/kubernetes.io/serviceaccount/token
        kubernetes_sd_configs:
          - role: node
        relabel_configs:
          - action: labelmap
            regex: __meta_kubernetes_node_label_(.+)
          - target_label: __address__
            replacement: kubernetes.default.svc:443
          - source_labels: [__meta_kubernetes_node_name]
            regex: (.+)
            target_label: __metrics_path__
            replacement: /api/v1/nodes/\$1/proxy/metrics/cadvisor

      - job_name: kube-state-metrics
        static_configs:
          - targets: ["kube-state-metrics.${NS_MONITORING}.svc.cluster.local:8080"]

      - job_name: node-exporter
        kubernetes_sd_configs:
          - role: endpoints
        relabel_configs:
          - source_labels: [__meta_kubernetes_namespace, __meta_kubernetes_service_name]
            action: keep
            regex: ${NS_MONITORING};node-exporter
          - source_labels: [__meta_kubernetes_endpoint_node_name]
            target_label: node

      - job_name: kubernetes-pods
        kubernetes_sd_configs:
          - role: pod
        relabel_configs:
          - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
            action: keep
            regex: true
          - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_path]
            action: replace
            target_label: __metrics_path__
            regex: (.+)
          - source_labels: [__address__, __meta_kubernetes_pod_annotation_prometheus_io_port]
            action: replace
            regex: ([^:]+)(?::\\d+)?;(\\d+)
            replacement: "\$1:\$2"
            target_label: __address__
          - action: labelmap
            regex: __meta_kubernetes_pod_label_(.+)
          - source_labels: [__meta_kubernetes_namespace]
            action: replace
            target_label: namespace
          - source_labels: [__meta_kubernetes_pod_name]
            action: replace
            target_label: pod
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: prometheus-data
  namespace: ${NS_MONITORING}
spec:
  accessModes: ["ReadWriteOnce"]
  storageClassName: ${STORAGE_CLASS}
  resources:
    requests:
      storage: ${MONITORING_PROMETHEUS_PVC_SIZE}
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: prometheus
  namespace: ${NS_MONITORING}
spec:
  replicas: 1
  strategy:
    type: Recreate
  selector:
    matchLabels:
      app: prometheus
  template:
    metadata:
      labels:
        app: prometheus
    spec:
      serviceAccountName: prometheus
      securityContext:
        runAsUser: 65534
        runAsGroup: 65534
        fsGroup: 65534
        fsGroupChangePolicy: OnRootMismatch
      containers:
        - name: prometheus
          image: ${IMAGE_PROMETHEUS}
          args:
            - --config.file=/etc/prometheus/prometheus.yml
            - --storage.tsdb.path=/prometheus
            - --storage.tsdb.retention.time=${MONITORING_PROMETHEUS_RETENTION}
            - --web.enable-lifecycle
            - --web.route-prefix=/prometheus
            - --web.external-url=${MONITORING_EXTERNAL_BASE_URL}/prometheus
          ports:
            - name: http
              containerPort: 9090
          resources:
            requests:
              cpu: "${MONITORING_PROMETHEUS_CPU_REQUEST:-500m}"
              memory: "${MONITORING_PROMETHEUS_MEMORY_REQUEST:-2Gi}"
            limits:
              cpu: "${MONITORING_PROMETHEUS_CPU_LIMIT:-2}"
              memory: "${MONITORING_PROMETHEUS_MEMORY_LIMIT:-4Gi}"
          volumeMounts:
            - name: config
              mountPath: /etc/prometheus
            - name: rules
              mountPath: /etc/prometheus/rules
            - name: data
              mountPath: /prometheus
      volumes:
        - name: config
          configMap:
            name: prometheus-config
        - name: rules
          configMap:
            name: prometheus-sandbox-autoscale-rules
        - name: data
          persistentVolumeClaim:
            claimName: prometheus-data
---
apiVersion: v1
kind: Service
metadata:
  name: prometheus
  namespace: ${NS_MONITORING}
spec:
  selector:
    app: prometheus
  ports:
    - name: http
      port: 9090
      targetPort: http
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: alertmanager-data
  namespace: ${NS_MONITORING}
spec:
  accessModes: ["ReadWriteOnce"]
  storageClassName: ${STORAGE_CLASS}
  resources:
    requests:
      storage: ${MONITORING_ALERTMANAGER_PVC_SIZE}
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: alertmanager
  namespace: ${NS_MONITORING}
spec:
  replicas: 1
  selector:
    matchLabels:
      app: alertmanager
  template:
    metadata:
      labels:
        app: alertmanager
    spec:
      containers:
        - name: alertmanager
          image: ${IMAGE_ALERTMANAGER}
          args:
            - --config.file=/etc/alertmanager/alertmanager.yml
            - --storage.path=/alertmanager
            - --web.route-prefix=/alertmanager
            - --web.external-url=${MONITORING_EXTERNAL_BASE_URL}/alertmanager
          ports:
            - name: http
              containerPort: 9093
          resources:
            requests:
              cpu: "${MONITORING_ALERTMANAGER_CPU_REQUEST:-50m}"
              memory: "${MONITORING_ALERTMANAGER_MEMORY_REQUEST:-64Mi}"
            limits:
              cpu: "${MONITORING_ALERTMANAGER_CPU_LIMIT:-200m}"
              memory: "${MONITORING_ALERTMANAGER_MEMORY_LIMIT:-256Mi}"
          volumeMounts:
            - name: config
              mountPath: /etc/alertmanager
            - name: data
              mountPath: /alertmanager
      volumes:
        - name: config
          configMap:
            name: alertmanager-config
        - name: data
          persistentVolumeClaim:
            claimName: alertmanager-data
---
apiVersion: v1
kind: Service
metadata:
  name: alertmanager
  namespace: ${NS_MONITORING}
spec:
  selector:
    app: alertmanager
  ports:
    - name: http
      port: 9093
      targetPort: http
$(if [ "${SANDBOX_AUTOSCALE_DINGTALK_ACTIVE}" = "true" ]; then cat <<DINGTALK_YAML
---
apiVersion: v1
kind: Secret
metadata:
  name: ${SANDBOX_AUTOSCALE_DINGTALK_SERVICE_NAME}-config
  namespace: ${NS_MONITORING}
type: Opaque
stringData:
  config.yml: |
    timeout: ${SANDBOX_AUTOSCALE_DINGTALK_TIMEOUT}
    templates:
      - /etc/prometheus-webhook-dingtalk/sandbox.tmpl
    targets:
      ${SANDBOX_AUTOSCALE_DINGTALK_TARGET}:
        url: "${SANDBOX_AUTOSCALE_DINGTALK_WEBHOOK_URL}"
${PROMETHEUS_WEBHOOK_DINGTALK_SECRET_CONFIG}
        message:
          title: '{{ template "sandbox.title" . }}'
          text: '{{ template "sandbox.content" . }}'
  sandbox.tmpl: |
    {{ define "sandbox.__action_icon" }}{{ if .Labels.alertActionIcon }}{{ .Labels.alertActionIcon }}{{ else if eq .Labels.alertActionType "OPS_INCIDENT" }}🚨{{ else if eq .Labels.alertActionType "ABNORMAL_RECOVERY" }}🧯{{ else if eq .Labels.resizeDirection "down" }}📉{{ else if eq .Labels.reasonCode "metrics.low_usage" }}📉{{ else }}📈{{ end }}{{ end }}
    {{ define "sandbox.__action_name" }}{{ if .Labels.alertActionName }}{{ .Labels.alertActionName }}{{ else if eq .Labels.alertActionType "OPS_INCIDENT" }}运维异常{{ else if eq .Labels.alertActionType "ABNORMAL_RECOVERY" }}异常自动恢复{{ else if eq .Labels.resizeDirection "down" }}降配{{ else if eq .Labels.reasonCode "metrics.low_usage" }}降配{{ else }}升配{{ end }}{{ end }}
    {{ define "sandbox.__group_action_icon" }}{{ if index .CommonLabels "alertActionIcon" }}{{ index .CommonLabels "alertActionIcon" }}{{ else if eq (index .CommonLabels "alertActionType") "OPS_INCIDENT" }}🚨{{ else if eq (index .CommonLabels "alertActionType") "ABNORMAL_RECOVERY" }}🧯{{ else if eq (index .CommonLabels "resizeDirection") "down" }}📉{{ else if eq (index .CommonLabels "reasonCode") "metrics.low_usage" }}📉{{ else }}📈{{ end }}{{ end }}
    {{ define "sandbox.__group_action_name" }}{{ if index .CommonLabels "alertActionName" }}{{ index .CommonLabels "alertActionName" }}{{ else if eq (index .CommonLabels "alertActionType") "OPS_INCIDENT" }}运维异常{{ else if eq (index .CommonLabels "alertActionType") "ABNORMAL_RECOVERY" }}异常自动恢复{{ else if eq (index .CommonLabels "resizeDirection") "down" }}降配{{ else if eq (index .CommonLabels "reasonCode") "metrics.low_usage" }}降配{{ else }}升配{{ end }}{{ end }}
    {{ define "sandbox.__subject" }}[{{ .Status | toUpper }}{{ if eq .Status "firing" }}:{{ .Alerts.Firing | len }}{{ end }}] {{ template "sandbox.__group_action_icon" . }} {{ template "sandbox.__group_action_name" . }} / {{ index .GroupLabels "alertname" }}{{ end }}
    {{ define "sandbox.__alertmanagerURL" }}{{ .ExternalURL }}/#/alerts?receiver={{ .Receiver }}{{ end }}
    {{ define "sandbox.__alert_list" }}{{ range . }}
    #### \[{{ .Labels.severity | upper }}\] {{ .Annotations.summary }}

    **Graph:** [{{ template "sandbox.__action_icon" . }} {{ template "sandbox.__action_name" . }}]({{ .GeneratorURL }})

    **Description:** {{ if .Annotations.description }}{{ .Annotations.description }}{{ else }}{{ .Annotations.reason_detail }}{{ end }}

    **Details:**
    {{ if .Labels.userCode }}> - USER_CODE: {{ .Labels.userCode | markdown | html }}
    {{ end }}{{ range .Labels.SortedPairs }}{{ if and (ne (.Name) "severity") (ne (.Name) "summary") (ne (.Name) "userCode") }}> - {{ .Name }}: {{ .Value | markdown | html }}
    {{ end }}{{ end }}

    {{ end }}{{ end }}
    {{ define "sandbox.title" }}{{ template "sandbox.__subject" . }}{{ end }}
    {{ define "sandbox.content" }}#### \[{{ .Status | toUpper }}{{ if eq .Status "firing" }}:{{ .Alerts.Firing | len }}{{ end }}\] **[{{ template "sandbox.__group_action_icon" . }} {{ template "sandbox.__group_action_name" . }} / {{ index .GroupLabels "alertname" }}]({{ template "sandbox.__alertmanagerURL" . }})**
    {{ if gt (len .Alerts.Firing) 0 -}}
    **Alerts Firing**
    {{ template "sandbox.__alert_list" .Alerts.Firing }}
    {{ range .AtMobiles }}@{{ . }}{{ end }}
    {{- end }}
    {{ if gt (len .Alerts.Resolved) 0 -}}
    **Alerts Resolved**
    {{ template "sandbox.__alert_list" .Alerts.Resolved }}
    {{ range .AtMobiles }}@{{ . }}{{ end }}
    {{- end }}
    {{- end }}
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${SANDBOX_AUTOSCALE_DINGTALK_SERVICE_NAME}
  namespace: ${NS_MONITORING}
spec:
  replicas: 1
  selector:
    matchLabels:
      app: ${SANDBOX_AUTOSCALE_DINGTALK_SERVICE_NAME}
  template:
    metadata:
      labels:
        app: ${SANDBOX_AUTOSCALE_DINGTALK_SERVICE_NAME}
    spec:
      containers:
        - name: prometheus-webhook-dingtalk
          image: ${IMAGE_PROMETHEUS_WEBHOOK_DINGTALK}
          args:
            - --config.file=/etc/prometheus-webhook-dingtalk/config.yml
            - --web.listen-address=0.0.0.0:8060
          ports:
            - name: http
              containerPort: 8060
          resources:
            requests:
              cpu: "${MONITORING_DINGTALK_CPU_REQUEST:-20m}"
              memory: "${MONITORING_DINGTALK_MEMORY_REQUEST:-32Mi}"
            limits:
              cpu: "${MONITORING_DINGTALK_CPU_LIMIT:-100m}"
              memory: "${MONITORING_DINGTALK_MEMORY_LIMIT:-128Mi}"
          volumeMounts:
            - name: config
              mountPath: /etc/prometheus-webhook-dingtalk
              readOnly: true
      volumes:
        - name: config
          secret:
            secretName: ${SANDBOX_AUTOSCALE_DINGTALK_SERVICE_NAME}-config
---
apiVersion: v1
kind: Service
metadata:
  name: ${SANDBOX_AUTOSCALE_DINGTALK_SERVICE_NAME}
  namespace: ${NS_MONITORING}
spec:
  selector:
    app: ${SANDBOX_AUTOSCALE_DINGTALK_SERVICE_NAME}
  ports:
    - name: http
      port: 8060
      targetPort: http
DINGTALK_YAML
fi)
---
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: node-exporter
  namespace: ${NS_MONITORING}
spec:
  selector:
    matchLabels:
      app: node-exporter
  template:
    metadata:
      labels:
        app: node-exporter
    spec:
      hostNetwork: true
      hostPID: true
      tolerations:
        - operator: Exists
      containers:
        - name: node-exporter
          image: ${IMAGE_NODE_EXPORTER}
          args:
            - --path.rootfs=/host
            - --collector.filesystem.mount-points-exclude=^/(dev|proc|sys|run/credentials/.+|var/lib/docker/.+|var/lib/kubelet/.+)($|/)
            - --collector.netclass.ignored-devices=^(veth.*|cali.*|flannel.*|cni.*)$
          ports:
            - name: metrics
              containerPort: 9100
              hostPort: 9100
          resources:
            requests:
              cpu: "${MONITORING_NODE_EXPORTER_CPU_REQUEST:-50m}"
              memory: "${MONITORING_NODE_EXPORTER_MEMORY_REQUEST:-64Mi}"
            limits:
              cpu: "${MONITORING_NODE_EXPORTER_CPU_LIMIT:-200m}"
              memory: "${MONITORING_NODE_EXPORTER_MEMORY_LIMIT:-256Mi}"
          volumeMounts:
            - name: root
              mountPath: /host
              readOnly: true
      volumes:
        - name: root
          hostPath:
            path: /
---
apiVersion: v1
kind: Service
metadata:
  name: node-exporter
  namespace: ${NS_MONITORING}
spec:
  selector:
    app: node-exporter
  ports:
    - name: metrics
      port: 9100
      targetPort: metrics
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: kube-state-metrics
  namespace: ${NS_MONITORING}
spec:
  replicas: 1
  selector:
    matchLabels:
      app: kube-state-metrics
  template:
    metadata:
      labels:
        app: kube-state-metrics
    spec:
      serviceAccountName: prometheus
      containers:
        - name: kube-state-metrics
          image: ${IMAGE_KUBE_STATE_METRICS}
          ports:
            - name: http
              containerPort: 8080
          resources:
            requests:
              cpu: "${MONITORING_KSM_CPU_REQUEST:-100m}"
              memory: "${MONITORING_KSM_MEMORY_REQUEST:-128Mi}"
            limits:
              cpu: "${MONITORING_KSM_CPU_LIMIT:-500m}"
              memory: "${MONITORING_KSM_MEMORY_LIMIT:-512Mi}"
---
apiVersion: v1
kind: Service
metadata:
  name: kube-state-metrics
  namespace: ${NS_MONITORING}
spec:
  selector:
    app: kube-state-metrics
  ports:
    - name: http
      port: 8080
      targetPort: http
---
apiVersion: v1
kind: Secret
metadata:
  name: grafana-admin
  namespace: ${NS_MONITORING}
type: Opaque
stringData:
  admin-user: admin
  admin-password: ${GRAFANA_ADMIN_PASSWORD}
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: grafana-datasources
  namespace: ${NS_MONITORING}
data:
  datasource.yaml: |
    apiVersion: 1
    datasources:
      - name: Prometheus
        type: prometheus
        access: proxy
        url: http://prometheus.${NS_MONITORING}.svc.cluster.local:9090/prometheus
        isDefault: true
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: grafana-data
  namespace: ${NS_MONITORING}
spec:
  accessModes: ["ReadWriteOnce"]
  storageClassName: ${STORAGE_CLASS}
  resources:
    requests:
      storage: ${MONITORING_GRAFANA_PVC_SIZE}
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: grafana
  namespace: ${NS_MONITORING}
spec:
  replicas: 1
  strategy:
    type: Recreate
  selector:
    matchLabels:
      app: grafana
  template:
    metadata:
      labels:
        app: grafana
    spec:
      securityContext:
        fsGroup: 472
      containers:
        - name: grafana
          image: ${IMAGE_GRAFANA}
          env:
            - name: GF_SECURITY_ADMIN_USER
              valueFrom:
                secretKeyRef:
                  name: grafana-admin
                  key: admin-user
            - name: GF_SECURITY_ADMIN_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: grafana-admin
                  key: admin-password
            - name: GF_SERVER_ROOT_URL
              value: ${MONITORING_EXTERNAL_BASE_URL}/grafana/
            - name: GF_SERVER_SERVE_FROM_SUB_PATH
              value: "true"
          ports:
            - name: http
              containerPort: 3000
          resources:
            requests:
              cpu: "${MONITORING_GRAFANA_CPU_REQUEST:-100m}"
              memory: "${MONITORING_GRAFANA_MEMORY_REQUEST:-256Mi}"
            limits:
              cpu: "${MONITORING_GRAFANA_CPU_LIMIT:-500m}"
              memory: "${MONITORING_GRAFANA_MEMORY_LIMIT:-512Mi}"
          volumeMounts:
            - name: data
              mountPath: /var/lib/grafana
            - name: datasources
              mountPath: /etc/grafana/provisioning/datasources
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: grafana-data
        - name: datasources
          configMap:
            name: grafana-datasources
---
apiVersion: v1
kind: Service
metadata:
  name: grafana
  namespace: ${NS_MONITORING}
spec:
  selector:
    app: grafana
  ports:
    - name: http
      port: 3000
      targetPort: http
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: monitoring
  namespace: ${NS_MONITORING}
  annotations:
    traefik.ingress.kubernetes.io/router.entrypoints: web
spec:
  ingressClassName: traefik
  rules:
    - http:
        paths:
          - path: /prometheus
            pathType: Prefix
            backend:
              service:
                name: prometheus
                port:
                  number: 9090
          - path: /alertmanager
            pathType: Prefix
            backend:
              service:
                name: alertmanager
                port:
                  number: 9093
          - path: /grafana
            pathType: Prefix
            backend:
              service:
                name: grafana
                port:
                  number: 3000
EOF

kubectl_cmd -n "$NS_MONITORING" rollout restart deploy/prometheus deploy/alertmanager >/dev/null 2>&1 || true
if [ "${SANDBOX_AUTOSCALE_DINGTALK_ACTIVE}" = "true" ]; then
    kubectl_cmd -n "$NS_MONITORING" rollout restart "deploy/${SANDBOX_AUTOSCALE_DINGTALK_SERVICE_NAME}" >/dev/null 2>&1 || true
fi
wait_monitoring_ready
verify_prometheus_targets
create_grafana_dashboards

echo "========== Monitoring install completed =========="
echo "    Prometheus: ${MONITORING_EXTERNAL_BASE_URL}/prometheus"
echo "    Alertmanager: ${MONITORING_EXTERNAL_BASE_URL}/alertmanager"
if [ "${SANDBOX_AUTOSCALE_DINGTALK_ACTIVE}" = "true" ]; then
    echo "    DingTalk alert webhook: enabled (${SANDBOX_AUTOSCALE_DINGTALK_SERVICE_NAME}/${SANDBOX_AUTOSCALE_DINGTALK_TARGET})"
fi
echo "    Grafana: ${MONITORING_EXTERNAL_BASE_URL}/grafana"
echo "    Grafana dashboards:"
echo "      - ${MONITORING_EXTERNAL_BASE_URL}/grafana/d/byclaw-k3s-nodes"
echo "      - ${MONITORING_EXTERNAL_BASE_URL}/grafana/d/byclaw-k3s-namespace"
echo "      - ${MONITORING_EXTERNAL_BASE_URL}/grafana/d/byclaw-k3s-pods"
echo "    Grafana user: admin"
echo "    Grafana password: run:"
echo "      kubectl -n ${NS_MONITORING} get secret grafana-admin -o jsonpath='{.data.admin-password}' | base64 -d; echo"
