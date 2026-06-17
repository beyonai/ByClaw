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
MONITORING_GRAFANA_PVC_SIZE="${MONITORING_GRAFANA_PVC_SIZE:-10Gi}"
IMAGE_PROMETHEUS="${IMAGE_PROMETHEUS:-quay.io/prometheus/prometheus:v2.55.1}"
IMAGE_NODE_EXPORTER="${IMAGE_NODE_EXPORTER:-quay.io/prometheus/node-exporter:v1.8.2}"
IMAGE_KUBE_STATE_METRICS="${IMAGE_KUBE_STATE_METRICS:-m.daocloud.io/registry.k8s.io/kube-state-metrics/kube-state-metrics:v2.14.0}"
IMAGE_GRAFANA="${IMAGE_GRAFANA:-grafana/grafana:11.3.1}"

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
  name: prometheus-config
  namespace: ${NS_MONITORING}
data:
  prometheus.yml: |
    global:
      scrape_interval: 30s
      evaluation_interval: 30s
    scrape_configs:
      - job_name: prometheus
        metrics_path: /prometheus/metrics
        static_configs:
          - targets: ["127.0.0.1:9090"]

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
            - name: data
              mountPath: /prometheus
      volumes:
        - name: config
          configMap:
            name: prometheus-config
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
          - path: /grafana
            pathType: Prefix
            backend:
              service:
                name: grafana
                port:
                  number: 3000
EOF

wait_monitoring_ready
verify_prometheus_targets
create_grafana_dashboards

echo "========== Monitoring install completed =========="
echo "    Prometheus: ${MONITORING_EXTERNAL_BASE_URL}/prometheus"
echo "    Grafana: ${MONITORING_EXTERNAL_BASE_URL}/grafana"
echo "    Grafana dashboards:"
echo "      - ${MONITORING_EXTERNAL_BASE_URL}/grafana/d/byclaw-k3s-nodes"
echo "      - ${MONITORING_EXTERNAL_BASE_URL}/grafana/d/byclaw-k3s-namespace"
echo "      - ${MONITORING_EXTERNAL_BASE_URL}/grafana/d/byclaw-k3s-pods"
echo "    Grafana user: admin"
echo "    Grafana password: run:"
echo "      kubectl -n ${NS_MONITORING} get secret grafana-admin -o jsonpath='{.data.admin-password}' | base64 -d; echo"
