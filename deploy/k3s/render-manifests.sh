#!/bin/bash
# Render Kubernetes manifests from env.k3s into deploy/k3s/generated/.
# The generated directory may contain Secret stringData and is intentionally gitignored.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ENV_FILE="${1:-./env.k3s.example}"
OUT_DIR="${2:-./generated}"
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
NS_MONITORING="${NS_MONITORING:-monitoring}"
OPENSANDBOX_WORKLOAD_NAMESPACE="${OPENSANDBOX_WORKLOAD_NAMESPACE:-$NS_SERVICE}"

STORAGE_CLASS="${STORAGE_CLASS:-longhorn}"
WORKSPACE_PVC_NAME="${WORKSPACE_PVC_NAME:-byclaw-workspace}"
WORKSPACE_PVC_SIZE="${WORKSPACE_PVC_SIZE:-500Gi}"
BYCLAW_SANDBOX_FILE_VOLUME_ROOT="${BYCLAW_SANDBOX_FILE_VOLUME_ROOT:-/mnt/byclaw-workspace}"
FILE_STORAGE_LOCAL_PATH="${FILE_STORAGE_LOCAL_PATH:-$BYCLAW_SANDBOX_FILE_VOLUME_ROOT}"
BYCLAW_SANDBOX_BASE_URL="${BYCLAW_SANDBOX_BASE_URL:-http://opensandbox-server.${NS_SANDBOX}.svc.cluster.local:9005}"
BYCLAW_SANDBOX_ENDPOINT_SCHEME="${BYCLAW_SANDBOX_ENDPOINT_SCHEME:-https}"
OPENSANDBOX_API_PORT="${OPENSANDBOX_API_PORT:-9005}"
OPENSANDBOX_NODE_POOL="${OPENSANDBOX_NODE_POOL:-${K3S_NODE_POOL_GENERAL:-sandbox-general}}"
OPENSANDBOX_REPLICAS="${OPENSANDBOX_REPLICAS:-2}"
OPENSANDBOX_HPA_MIN="${OPENSANDBOX_HPA_MIN:-$OPENSANDBOX_REPLICAS}"
BYCLAW_BE_REPLICAS="${BYCLAW_BE_REPLICAS:-1}"
BYCLAW_FE_REPLICAS="${BYCLAW_FE_REPLICAS:-1}"
BYCLAW_QA_REPLICAS="${BYCLAW_QA_REPLICAS:-1}"
BYCLAW_DATA_REPLICAS="${BYCLAW_DATA_REPLICAS:-1}"
BYCLAW_DEPLOY_CONFIG_DIR="${BYCLAW_DEPLOY_CONFIG_DIR:-$SCRIPT_DIR/../config}"
BYCLAW_BE_APPLICATION_PROPERTIES="${BYCLAW_DEPLOY_CONFIG_DIR}/application.properties"
BYCLAW_BE_LOGBACK_XML="${BYCLAW_DEPLOY_CONFIG_DIR}/logback.xml"
BYCLAW_FE_NGINX_CONF="${BYCLAW_DEPLOY_CONFIG_DIR}/nginx-standalone.conf"
KUBE_DNS_SERVICE_IP="${KUBE_DNS_SERVICE_IP:-10.43.0.10}"

IMAGE_FE="${IMAGE_FE:-ghcr.io/beyonai/byclaw/byclaw-fe:main}"
IMAGE_BE="${IMAGE_BE:-ghcr.io/beyonai/byclaw/byclaw-be:main}"
IMAGE_QA="${IMAGE_QA:-ghcr.io/beyonai/byclaw/byclaw-qa:main}"
IMAGE_DATA="${IMAGE_DATA:-ghcr.io/beyonai/byclaw/byclaw-data:main}"
IMAGE_REDIS="${IMAGE_REDIS:-ghcr.io/beyonai/byclaw/byclaw-redis:main}"
IMAGE_OPENGAUSS="${IMAGE_OPENGAUSS:-ghcr.io/beyonai/byclaw/byclaw-opengauss:main}"
IMAGE_SANDBOX_SERVER="${IMAGE_SANDBOX_SERVER:-sandbox-registry.cn-zhangjiakou.cr.aliyuncs.com/opensandbox/server:v0.1.14}"

if [ "$OPENSANDBOX_WORKLOAD_NAMESPACE" != "$NS_SERVICE" ]; then
    cat >&2 <<EOF
Error: OPENSANDBOX_WORKLOAD_NAMESPACE must be ${NS_SERVICE} for the current ByClaw workspace model.
BE initializes sandbox workspace files through PVC ${WORKSPACE_PVC_NAME}, and Kubernetes PVCs cannot be mounted across namespaces.
Set OPENSANDBOX_WORKLOAD_NAMESPACE=${NS_SERVICE}, or implement the future sharded workspace PVC mapping before changing it.
EOF
    exit 1
fi

BE_DOMAINNAME="${BE_DOMAINNAME:-ByaiService}"
QA_DOMAINNAME="${QA_DOMAINNAME:-byclaw-qa-manager}"
DATACLOUD_DOMAINNAME="${DATACLOUD_DOMAINNAME:-byclaw-datacloud}"
HOST="${HOST:-${BYCLAW_INGRESS_HOST:-byclaw.example.com}}"
BE_SERVER_PORT="${BE_SERVER_PORT:-8086}"
BE_WS_PORT="${BE_WS_PORT:-8082}"
BYCLAW_QA_PORT="${BYCLAW_QA_PORT:-8000}"
DATACLOUD_PORT="${DATACLOUD_PORT:-8088}"
DATACLOUD_DATA_SERVICE_PORT="${DATACLOUD_DATA_SERVICE_PORT:-$DATACLOUD_PORT}"
DATACLOUD_DATA_SERVICE_URL="${DATACLOUD_DATA_SERVICE_URL:-http://127.0.0.1:${DATACLOUD_DATA_SERVICE_PORT}}"
DATACLOUD_API_BASE_URL="${DATACLOUD_API_BASE_URL:-http://${DATACLOUD_DOMAINNAME}.${NS_SERVICE}.svc.cluster.local:${DATACLOUD_DATA_SERVICE_PORT}}"
BE_DOMAINNAME_URL="${BE_DOMAINNAME_URL:-http://byclaw-be.${NS_SERVICE}.svc.cluster.local:${BE_SERVER_PORT}}"
BYCLAW_SERVICE_IMAGE_PULL_POLICY="${BYCLAW_SERVICE_IMAGE_PULL_POLICY:-Always}"
OPENSANDBOX_SANDBOX_IMAGE_PULL_POLICY="${OPENSANDBOX_SANDBOX_IMAGE_PULL_POLICY:-Always}"

DB_HOST="${DB_HOST:-opengauss.${NS_MIDDLEWARE}.svc.cluster.local}"
DB_PORT="${DB_PORT:-5432}"
DB_TYPE="${DB_TYPE:-postgresql}"
DB_USER="${DB_USER:-gaussdb}"
DB_PASS="${DB_PASS:-change-me}"
DB_DATABASE="${DB_DATABASE:-postgres}"
DB_SCHEMA="${DB_SCHEMA:-byai}"
REDIS_HOST="${REDIS_HOST:-redis.${NS_MIDDLEWARE}.svc.cluster.local}"
REDIS_PORT="${REDIS_PORT:-6379}"
REDIS_USERNAME="${REDIS_USERNAME:-default}"
REDIS_PASSWORD="${REDIS_PASSWORD:-change-me}"
REDIS_DATABASE="${REDIS_DATABASE:-0}"
OPENSANDBOX_API_KEY="${OPENSANDBOX_API_KEY:-change-me}"
BYCLAW_SANDBOX_API_KEY="${BYCLAW_SANDBOX_API_KEY:-$OPENSANDBOX_API_KEY}"
BYCLAW_INGRESS_HOST="${BYCLAW_INGRESS_HOST:-byclaw.example.com}"
OPENSANDBOX_TLS_SECRET="${OPENSANDBOX_TLS_SECRET:-}"
BYCLAW_TLS_SECRET="${BYCLAW_TLS_SECRET:-}"
SANDBOX_INGRESS_HOST="${SANDBOX_INGRESS_HOST:-sandbox.example.com}"
MONITORING_ENABLED="${MONITORING_ENABLED:-true}"
BYCLAW_QA_AGENT_DATA_PATH="${BYCLAW_QA_AGENT_DATA_PATH:-agent_data}"
BYCLAW_QA_KB_FETCH_CACHE_TTL_SECONDS="${BYCLAW_QA_KB_FETCH_CACHE_TTL_SECONDS:-86400}"
BYCLAW_QA_KB_FETCH_CACHE_CLEANUP_INTERVAL_SECONDS="${BYCLAW_QA_KB_FETCH_CACHE_CLEANUP_INTERVAL_SECONDS:-600}"
BYCLAW_QA_KB_MINIO_BUCKET="${BYCLAW_QA_KB_MINIO_BUCKET:-knowledge-base}"
BYCLAW_QA_KB_MINIO_MARKDOWN_BUCKET="${BYCLAW_QA_KB_MINIO_MARKDOWN_BUCKET:-knowledge-base-markdown}"
BYCLAW_QA_BYAI_WORKER_ID="${BYCLAW_QA_BYAI_WORKER_ID:-instant-search-worker-1}"
MINIO_ENDPOINT="${MINIO_ENDPOINT:-disabled}"
MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-disabled}"
MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-disabled}"
MINIO_SECURE="${MINIO_SECURE:-false}"
DATACLOUD_START_MCP_SERVICE="${DATACLOUD_START_MCP_SERVICE:-true}"
DATACLOUD_START_GATEWAY_WORKER="${DATACLOUD_START_GATEWAY_WORKER:-true}"
DATACLOUD_GATEWAY_WORKER_ID="${DATACLOUD_GATEWAY_WORKER_ID:-BYCLAW_DATA}"
DATACLOUD_GATEWAY_CONSUMER_GROUP="${DATACLOUD_GATEWAY_CONSUMER_GROUP:-datacloud}"
DATACLOUD_GATEWAY_WORKSPACE_DIR="${DATACLOUD_GATEWAY_WORKSPACE_DIR:-/tmp/datacloud}"
DATACLOUD_RESULT_FILE_API_BASE_URL="${DATACLOUD_RESULT_FILE_API_BASE_URL:-$BE_DOMAINNAME_URL}"

if [ ! -f "$BYCLAW_BE_APPLICATION_PROPERTIES" ]; then
    echo "Error: missing BE config: $BYCLAW_BE_APPLICATION_PROPERTIES" >&2
    exit 1
fi
if [ ! -f "$BYCLAW_BE_LOGBACK_XML" ]; then
    echo "Error: missing BE log config: $BYCLAW_BE_LOGBACK_XML" >&2
    exit 1
fi

render_indented_file() {
    sed 's/^/    /' "$1"
}

render_byclaw_be_configmap() {
    cat <<EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: byclaw-be-config
  namespace: ${NS_SERVICE}
data:
  application.properties: |
EOF
    render_indented_file "$BYCLAW_BE_APPLICATION_PROPERTIES"
    cat <<EOF
  logback.xml: |
EOF
    render_indented_file "$BYCLAW_BE_LOGBACK_XML"
    printf '\n'
    cat <<EOF
---
EOF
}

render_byclaw_fe_nginx_conf() {
    if [ ! -f "$BYCLAW_FE_NGINX_CONF" ]; then
        echo "Error: FE nginx config not found: $BYCLAW_FE_NGINX_CONF" >&2
        exit 1
    fi
    sed \
        -e "s#^resolver .*\$#resolver ${KUBE_DNS_SERVICE_IP} valid=10s ipv6=off;#" \
        -e "s#listen       8080;#listen       80;#" \
        -e "/listen       8443 ssl;/d" \
        -e "/http2 on;/d" \
        -e "s#server_name  localhost 127.0.0.1;#server_name  _;#" \
        -e "/ssl_certificate /d" \
        -e "/ssl_certificate_key /d" \
        -e "/ssl_session_cache /d" \
        -e "/ssl_session_timeout /d" \
        -e "/ssl_protocols /d" \
        -e "/ssl_prefer_server_ciphers /d" \
        "$BYCLAW_FE_NGINX_CONF" \
        | awk \
            -v backend_http="http://byclaw-be.${NS_SERVICE}.svc.cluster.local:${BE_SERVER_PORT}" \
            -v backend_ws="http://byclaw-be.${NS_SERVICE}.svc.cluster.local:${BE_WS_PORT}" \
            -v sandbox_http="http://opensandbox-server.${NS_SANDBOX}.svc.cluster.local:${OPENSANDBOX_API_PORT}" \
            '/set \$backend_http/ {
                print "    set $backend_http \"" backend_http "\"; set $backend_ws \"" backend_ws "\"; set $sandbox_http \"" sandbox_http "\";"
                next
            }
            /^[[:space:]]*error_page 500/ {
                print "    location / {"
                print "        root /usr/share/nginx/html;"
                print "        index index.html index.htm;"
                print "        try_files $uri $uri/ /index.html;"
                print "        absolute_redirect off;"
                print "    }"
                print ""
                print
                next
            }
            { print }'
}

compute_sha256() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum | awk '{print $1}'
    else
        shasum -a 256 | awk '{print $1}'
    fi
}

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"/{00-namespaces,10-storage,20-middleware,30-sandbox,40-service,50-ingress,60-monitoring}

cat > "$OUT_DIR/00-namespaces/namespaces.yaml" <<EOF
apiVersion: v1
kind: Namespace
metadata:
  name: ${NS_SERVICE}
---
apiVersion: v1
kind: Namespace
metadata:
  name: ${NS_MIDDLEWARE}
---
apiVersion: v1
kind: Namespace
metadata:
  name: ${NS_SANDBOX}
---
apiVersion: v1
kind: Namespace
metadata:
  name: ${NS_MONITORING}
EOF

cat > "$OUT_DIR/10-storage/workspace-pvc.yaml" <<EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: ${WORKSPACE_PVC_NAME}
  namespace: ${NS_SERVICE}
spec:
  accessModes:
    - ReadWriteMany
  storageClassName: ${STORAGE_CLASS}
  resources:
    requests:
      storage: ${WORKSPACE_PVC_SIZE}
EOF

cat > "$OUT_DIR/20-middleware/opengauss.yaml" <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: opengauss-auth
  namespace: ${NS_MIDDLEWARE}
type: Opaque
stringData:
  username: "${DB_USER}"
  password: "${DB_PASS}"
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: opengauss-data
  namespace: ${NS_MIDDLEWARE}
spec:
  accessModes: ["ReadWriteOnce"]
  storageClassName: ${STORAGE_CLASS}
  resources:
    requests:
      storage: ${OPENGAUSS_PVC_SIZE:-100Gi}
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: opengauss
  namespace: ${NS_MIDDLEWARE}
spec:
  serviceName: opengauss
  replicas: 1
  selector:
    matchLabels:
      app: opengauss
  template:
    metadata:
      labels:
        app: opengauss
    spec:
      securityContext:
        runAsUser: 0
      containers:
        - name: opengauss
          image: ${IMAGE_OPENGAUSS}
          imagePullPolicy: IfNotPresent
          securityContext:
            privileged: true
            runAsUser: 0
          command:
            - /bin/bash
            - -c
          args:
            - |
              chmod -R a+r /docker-entrypoint-initdb.d 2>/dev/null || true
              chown -R omm:omm /var/lib/opengauss
              exec gosu omm entrypoint.sh gaussdb
          ports:
            - containerPort: 5432
          env:
            - name: GS_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: opengauss-auth
                  key: password
            - name: GS_USERNAME
              valueFrom:
                secretKeyRef:
                  name: opengauss-auth
                  key: username
            - name: GS_PORT
              value: "${DB_PORT}"
            - name: GS_DB
              value: "${DB_DATABASE}"
            - name: OTHER_PG_CONF
              value: |
                shared_preload_libraries = 'age'
          volumeMounts:
            - name: data
              mountPath: /var/lib/opengauss
          resources:
            requests:
              cpu: "${OPENGAUSS_CPU_REQUEST:-1}"
              memory: "${OPENGAUSS_MEMORY_REQUEST:-4Gi}"
            limits:
              cpu: "${OPENGAUSS_CPU_LIMIT:-4}"
              memory: "${OPENGAUSS_MEMORY_LIMIT:-8Gi}"
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: opengauss-data
---
apiVersion: v1
kind: Service
metadata:
  name: opengauss
  namespace: ${NS_MIDDLEWARE}
spec:
  selector:
    app: opengauss
  ports:
    - port: 5432
      targetPort: 5432
EOF

if [ "${OPENGAUSS_PUBLIC_ENABLED:-false}" = "true" ]; then
    cat >> "$OUT_DIR/20-middleware/opengauss.yaml" <<EOF
---
apiVersion: v1
kind: Service
metadata:
  name: ${OPENGAUSS_PUBLIC_SERVICE_NAME:-opengauss-public}
  namespace: ${NS_MIDDLEWARE}
  labels:
    app: opengauss
    byclaw.io/expose: public
spec:
  type: LoadBalancer
  selector:
    app: opengauss
  ports:
    - name: postgres
      port: ${OPENGAUSS_PUBLIC_PORT:-5432}
      targetPort: 5432
      protocol: TCP
EOF
fi

cat > "$OUT_DIR/20-middleware/redis.yaml" <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: redis-auth
  namespace: ${NS_MIDDLEWARE}
type: Opaque
stringData:
  password: "${REDIS_PASSWORD}"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: redis
  namespace: ${NS_MIDDLEWARE}
spec:
  replicas: 1
  selector:
    matchLabels:
      app: redis
  template:
    metadata:
      labels:
        app: redis
    spec:
      containers:
        - name: redis
          image: ${IMAGE_REDIS}
          args: ["redis-server", "--requirepass", "\$(REDIS_PASSWORD)"]
          env:
            - name: REDIS_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: redis-auth
                  key: password
          ports:
            - containerPort: 6379
          resources:
            requests:
              cpu: "${REDIS_CPU_REQUEST:-250m}"
              memory: "${REDIS_MEMORY_REQUEST:-512Mi}"
            limits:
              cpu: "${REDIS_CPU_LIMIT:-1}"
              memory: "${REDIS_MEMORY_LIMIT:-2Gi}"
---
apiVersion: v1
kind: Service
metadata:
  name: redis
  namespace: ${NS_MIDDLEWARE}
spec:
  selector:
    app: redis
  ports:
    - port: 6379
      targetPort: 6379
EOF

bash ./gen-opensandbox-k8s-config.sh "$ENV_FILE" "$OUT_DIR/30-sandbox/opensandbox-server-k8s.toml" >/dev/null
# Jinja 模板，仅嵌入 ConfigMap；勿放在 30-sandbox 根目录（会被 kubectl apply 误当成 BatchSandbox CR）
mkdir -p "$OUT_DIR/30-sandbox/.templates"
cat > "$OUT_DIR/30-sandbox/.templates/batchsandbox-template.yaml" <<EOF
apiVersion: sandbox.opensandbox.io/v1alpha1
kind: BatchSandbox
metadata:
  namespace: ${NS_SANDBOX}
  labels:
    byclaw.io/runtime: opensandbox
spec:
  replicas: 1
  ttlSecondsAfterFinished: 3600
  template:
    metadata:
      labels:
        byclaw.io/workload: sandbox
    spec:
      serviceAccountName: opensandbox-runtime
      restartPolicy: Never
      nodeSelector:
        byclaw.io/node-pool: ${OPENSANDBOX_NODE_POOL}
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: kubernetes.io/hostname
          whenUnsatisfiable: ScheduleAnyway
          labelSelector:
            matchLabels:
              byclaw.io/workload: sandbox
      containers:
        - name: main
          image: "{{ image }}"
          imagePullPolicy: ${OPENSANDBOX_SANDBOX_IMAGE_PULL_POLICY}
          resources:
            requests:
              cpu: "{{ cpu_request | default('1') }}"
              memory: "{{ memory_request | default('2Gi') }}"
            limits:
              cpu: "{{ cpu_limit | default('2') }}"
              memory: "{{ memory_limit | default('4Gi') }}"
          volumeMounts:
            - name: scratch
              mountPath: /tmp/scratch
      volumes:
        - name: scratch
          emptyDir:
            sizeLimit: ${SANDBOX_SCRATCH_SIZE:-10Gi}
EOF

cat > "$OUT_DIR/30-sandbox/.templates/opensandbox-resource-requests-patch.py" <<'EOF'
from pathlib import Path


def patch_file(path, replacements):
    file_path = Path(path)
    text = file_path.read_text()
    original = text
    for old, new in replacements:
        if new in text:
            continue
        if old not in text:
            raise RuntimeError(f"patch anchor not found in {path}: {old[:80]!r}")
        text = text.replace(old, new, 1)
    if text != original:
        file_path.write_text(text)


def append_once(path, marker, content):
    file_path = Path(path)
    text = file_path.read_text()
    if marker in text:
        return
    file_path.write_text(text.rstrip() + "\n\n" + content.strip() + "\n")


patch_file(
    "/app/opensandbox_server/api/schema.py",
    [
        (
            '''    resource_limits: Optional[ResourceLimits] = Field(
        None,
        alias="resourceLimits",
        description="Runtime resource constraints for the sandbox instance. Optional when poolRef is provided.",
    )
''',
            '''    resource_limits: Optional[ResourceLimits] = Field(
        None,
        alias="resourceLimits",
        description="Runtime resource constraints for the sandbox instance. Optional when poolRef is provided.",
    )
    resource_requests: Optional[ResourceLimits] = Field(
        None,
        alias="resourceRequests",
        description="Kubernetes resource requests for the sandbox instance. Defaults to resourceLimits when omitted.",
    )
''',
        ),
    ],
)

append_once(
    "/app/opensandbox_server/api/schema.py",
    "class ResizeSandboxRequest(BaseModel):",
    '''
class ResizeSandboxRequest(BaseModel):
    """
    Request to resize a running sandbox.
    """
    resource_requests: Optional[ResourceLimits] = Field(
        None,
        alias="resourceRequests",
        description="Kubernetes resource requests for the sandbox instance.",
    )
    resource_limits: Optional[ResourceLimits] = Field(
        None,
        alias="resourceLimits",
        description="Kubernetes resource limits for the sandbox instance.",
    )
    resize_type: Optional[str] = Field(
        "IN_PLACE",
        alias="resizeType",
        description="Resize strategy requested by the caller.",
    )
    metadata: Optional[Dict[str, str]] = Field(
        None,
        description="Caller metadata propagated to the resize response.",
    )

    class Config:
        populate_by_name = True


class ResizeSandboxResponse(BaseModel):
    """
    Response for sandbox resize requests.
    """
    request_id: Optional[str] = Field(None, alias="requestId")
    operation_id: Optional[str] = Field(None, alias="operationId")
    sandbox_id: str = Field(..., alias="sandboxId")
    state: str = Field("Running", description="Sandbox state after the resize request is accepted.")
    message: Optional[str] = Field(None, description="Human-readable resize result.")
    metadata: Optional[Dict[str, str]] = Field(None, description="Response metadata.")

    class Config:
        populate_by_name = True
''',
)

patch_file(
    "/app/opensandbox_server/services/k8s/create_helpers.py",
    [
        (
            '''    resource_limits: Dict[str, str]
    egress_mode: str
''',
            '''    resource_limits: Dict[str, str]
    resource_requests: Dict[str, str]
    egress_mode: str
''',
        ),
        (
            '''    resource_limits = {}
    if request.resource_limits and request.resource_limits.root:
        resource_limits = request.resource_limits.root

    return _CreateWorkloadContext(
''',
            '''    resource_limits = {}
    if request.resource_limits and request.resource_limits.root:
        resource_limits = request.resource_limits.root

    resource_requests = {}
    if getattr(request, "resource_requests", None) and request.resource_requests.root:
        resource_requests = request.resource_requests.root

    return _CreateWorkloadContext(
''',
        ),
        (
            '''        resource_limits=resource_limits,
        egress_mode=egress_mode,
''',
            '''        resource_limits=resource_limits,
        resource_requests=resource_requests,
        egress_mode=egress_mode,
''',
        ),
    ],
)

patch_file(
    "/app/opensandbox_server/services/k8s/provider_common.py",
    [
        (
            '''    resource_limits: Dict[str, str],
    *,
''',
            '''    resource_limits: Dict[str, str],
    resource_requests: Optional[Dict[str, str]] = None,
    *,
''',
        ),
        (
            '''    translated_limits = _translate_resource_limits_for_k8s(resource_limits)
    resources = None
    if translated_limits:
        resources = V1ResourceRequirements(
            limits=translated_limits,
            requests=translated_limits,
        )
''',
            '''    translated_limits = _translate_resource_limits_for_k8s(resource_limits)
    translated_requests = _translate_resource_limits_for_k8s(resource_requests or {})
    resources = None
    if translated_limits:
        resources = V1ResourceRequirements(
            limits=translated_limits,
            requests=translated_requests or translated_limits,
        )
''',
        ),
    ],
)

patch_file(
    "/app/opensandbox_server/services/k8s/batchsandbox_provider.py",
    [
        (
            '''        resource_limits: Dict[str, str],
        labels: Dict[str, str],
''',
            '''        resource_limits: Dict[str, str],
        resource_requests: Dict[str, str],
        labels: Dict[str, str],
''',
        ),
        (
            '''            resource_limits=resource_limits,
            has_network_policy=network_policy is not None,
''',
            '''            resource_limits=resource_limits,
            resource_requests=resource_requests or {},
            has_network_policy=network_policy is not None,
''',
        ),
    ],
)

patch_file(
    "/app/opensandbox_server/services/k8s/kubernetes_service.py",
    [
        (
            '''    RenewSandboxExpirationRequest,
    RenewSandboxExpirationResponse,
    Sandbox,
''',
            '''    RenewSandboxExpirationRequest,
    RenewSandboxExpirationResponse,
    ResizeSandboxRequest,
    ResizeSandboxResponse,
    Sandbox,
''',
        ),
        (
            '''                resource_limits=context.resource_limits,
                labels=context.labels,
''',
            '''                resource_limits=context.resource_limits,
                resource_requests=context.resource_requests,
                labels=context.labels,
''',
        ),
    ],
)

patch_file(
    "/app/opensandbox_server/services/k8s/kubernetes_service.py",
    [
        (
            '''    async def create_sandbox(self, request: CreateSandboxRequest) -> CreateSandboxResponse:
''',
            '''    async def resize_sandbox(self, sandbox_id: str, request: ResizeSandboxRequest) -> ResizeSandboxResponse:
        """
        Resize a running BatchSandbox Pod via the Kubernetes pods/resize subresource.
        """
        import uuid
        from kubernetes.client import ApiException

        try:
            workload = _get_workload_or_404(
                self.workload_provider,
                self.namespace,
                sandbox_id,
            )
            status_info = self.workload_provider.get_status(workload)
            normalized = _normalize_create_status(status_info)
            if normalized.get("state") != "Running":
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "code": SandboxErrorCodes.INVALID_STATE,
                        "message": f"Sandbox {sandbox_id} is not running and cannot be resized.",
                    },
                )

            resource_requests = {}
            if request.resource_requests and request.resource_requests.root:
                resource_requests = request.resource_requests.root
            resource_limits = {}
            if request.resource_limits and request.resource_limits.root:
                resource_limits = request.resource_limits.root
            if not resource_requests and not resource_limits:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={
                        "code": SandboxErrorCodes.INVALID_PARAMETER,
                        "message": "resourceRequests or resourceLimits is required.",
                    },
                )

            pods = self.k8s_client.list_pods(
                namespace=self.namespace,
                label_selector=f"{SANDBOX_ID_LABEL}={sandbox_id}",
            )
            if not pods:
                pods = self.k8s_client.list_pods(
                    namespace=self.namespace,
                    label_selector=f"batch-sandbox.sandbox.opensandbox.io/name={sandbox_id}",
                )
            if not pods:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail={
                        "code": SandboxErrorCodes.K8S_SANDBOX_NOT_FOUND,
                        "message": f"Pod for sandbox {sandbox_id} was not found.",
                    },
                )

            pod = pods[0]
            pod_name = pod.metadata.name
            container_name = pod.spec.containers[0].name
            current_resources = pod.spec.containers[0].resources
            if not resource_requests:
                resource_requests = dict(current_resources.requests or {})
            if not resource_limits:
                resource_limits = dict(current_resources.limits or {})

            resources = {
                "requests": resource_requests,
                "limits": resource_limits,
            }
            pod_resize_body = {
                "spec": {
                    "containers": [
                        {
                            "name": container_name,
                            "resources": resources,
                        }
                    ]
                }
            }

            if self.k8s_client._write_limiter:
                self.k8s_client._write_limiter.acquire()
            await asyncio.to_thread(
                self.k8s_client.get_core_v1_api().patch_namespaced_pod_resize,
                name=pod_name,
                namespace=self.namespace,
                body=pod_resize_body,
            )

            batchsandbox_name = workload["metadata"]["name"]
            json_patch = [
                {
                    "op": "replace",
                    "path": "/spec/template/spec/containers/0/resources",
                    "value": resources,
                }
            ]
            if self.k8s_client._write_limiter:
                self.k8s_client._write_limiter.acquire()
            await asyncio.to_thread(
                self.k8s_client.get_custom_objects_api().api_client.call_api,
                "/apis/{group}/{version}/namespaces/{namespace}/{plural}/{name}",
                "PATCH",
                {
                    "group": "sandbox.opensandbox.io",
                    "version": "v1alpha1",
                    "namespace": self.namespace,
                    "plural": "batchsandboxes",
                    "name": batchsandbox_name,
                },
                [],
                {
                    "Accept": "application/json",
                    "Content-Type": "application/json-patch+json",
                },
                body=json_patch,
                response_type="object",
                auth_settings=["BearerToken"],
                _return_http_data_only=True,
            )

            return ResizeSandboxResponse(
                requestId=str(uuid.uuid4()),
                operationId=str(uuid.uuid4()),
                sandboxId=sandbox_id,
                state="Running",
                message=f"Resize requested for pod {pod_name}.",
                metadata=request.metadata or {},
            )
        except HTTPException:
            raise
        except ApiException as e:
            logger.error("Failed to resize sandbox %s: %s", sandbox_id, e)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": SandboxErrorCodes.K8S_API_ERROR,
                    "message": f"Failed to resize sandbox: {e.body or e.reason or e}",
                },
            ) from e
        except Exception as e:
            logger.error("Failed to resize sandbox %s: %s", sandbox_id, e)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail={
                    "code": SandboxErrorCodes.UNKNOWN_ERROR,
                    "message": f"Failed to resize sandbox: {e}",
                },
            ) from e

    async def create_sandbox(self, request: CreateSandboxRequest) -> CreateSandboxResponse:
''',
        ),
    ],
)

patch_file(
    "/app/opensandbox_server/api/lifecycle.py",
    [
        (
            '''    RenewSandboxExpirationRequest,
    RenewSandboxExpirationResponse,
    Sandbox,
''',
            '''    RenewSandboxExpirationRequest,
    RenewSandboxExpirationResponse,
    ResizeSandboxRequest,
    ResizeSandboxResponse,
    Sandbox,
''',
        ),
        (
            '''@router.post(
    "/sandboxes/{sandbox_id}/renew-expiration",
''',
            '''@router.post(
    "/sandboxes/{sandbox_id}/resize",
    response_model=ResizeSandboxResponse,
    response_model_exclude_none=True,
    status_code=status.HTTP_202_ACCEPTED,
    responses={
        202: {"description": "Sandbox resize accepted"},
        400: {"model": ErrorResponse, "description": "The resize request was invalid"},
        401: {"model": ErrorResponse, "description": "Authentication credentials are missing or invalid"},
        404: {"model": ErrorResponse, "description": "The requested sandbox does not exist"},
        409: {"model": ErrorResponse, "description": "The sandbox cannot be resized in its current state"},
        500: {"model": ErrorResponse, "description": "An unexpected server error occurred"},
    },
)
async def resize_sandbox(
    sandbox_id: str,
    request: ResizeSandboxRequest,
    x_request_id: Optional[str] = Header(None, alias="X-Request-ID", description="Unique request identifier for tracing"),
) -> ResizeSandboxResponse:
    """
    Resize a running sandbox.
    """
    return await sandbox_service.resize_sandbox(sandbox_id, request)


@router.post(
    "/sandboxes/{sandbox_id}/renew-expiration",
''',
        ),
    ],
)

patch_file(
    "/app/opensandbox_server/services/k8s/volume_helper.py",
    [
        (
            '''        elif vol.host is not None:
            host_path = vol.host.path

            pod_volumes.append({
                "name": vol_name,
                "hostPath": {
                    "path": host_path,
                    "type": "DirectoryOrCreate",
                },
            })
''',
            '''        elif vol.host is not None:
            host_path = vol.host.path

            # ByClaw k3s uses a shared Longhorn RWX PVC for sandbox workspaces.
            # Older ByClaw payloads still send the workspace root as a host path;
            # translate that compatibility marker to the real PVC backend.
            byclaw_workspace_host_path = __import__("os").environ.get(
                "BYCLAW_WORKSPACE_HOST_PATH",
                "/mnt/byclaw-workspace",
            )
            if host_path == byclaw_workspace_host_path:
                pvc_claim_name = __import__("os").environ.get(
                    "BYCLAW_WORKSPACE_PVC_NAME",
                    "byclaw-workspace",
                )
                if pvc_claim_name not in pvc_to_volume_name:
                    pod_volumes.append({
                        "name": vol_name,
                        "persistentVolumeClaim": {
                            "claimName": pvc_claim_name,
                        },
                    })
                    pvc_to_volume_name[pvc_claim_name] = vol_name
                    existing_volume_names.add(vol_name)

                mount = {
                    "name": pvc_to_volume_name[pvc_claim_name],
                    "mountPath": vol.mount_path,
                    "readOnly": vol.read_only,
                }
                if vol.sub_path:
                    mount["subPath"] = vol.sub_path
                mounts.append(mount)

                logger.info(
                    "Added ByClaw workspace PVC volume '%s' (claim: %s) mounted at '%s' for sandbox",
                    vol_name,
                    pvc_claim_name,
                    vol.mount_path,
                )
                continue

            pod_volumes.append({
                "name": vol_name,
                "hostPath": {
                    "path": host_path,
                    "type": "DirectoryOrCreate",
                },
            })
''',
        ),
    ],
)

patch_file(
    "/app/opensandbox_server/services/k8s/kubernetes_service.py",
    [
        (
            '''            if expires is not None:
                endpoint = self._build_signed_endpoint(sandbox_id, port, expires)
            else:
                endpoint = self.workload_provider.get_endpoint_info(workload, port, sandbox_id)
''',
            '''            if resolve_internal and expires is None:
                pod_ip = None
                parse_pod_ip = getattr(self.workload_provider, "_parse_pod_ip", None)
                if callable(parse_pod_ip):
                    pod_ip = parse_pod_ip(workload)
                if pod_ip:
                    endpoint = Endpoint(endpoint=f"{pod_ip}:{port}")
                else:
                    endpoint = self.workload_provider.get_endpoint_info(workload, port, sandbox_id)
            elif expires is not None:
                endpoint = self._build_signed_endpoint(sandbox_id, port, expires)
            else:
                endpoint = self.workload_provider.get_endpoint_info(workload, port, sandbox_id)
''',
        ),
    ],
)

print("OpenSandbox resourceRequests and resize patch applied")
EOF

OPENSANDBOX_CONFIG_CHECKSUM="$({
    cat "$OUT_DIR/30-sandbox/opensandbox-server-k8s.toml"
    cat "$OUT_DIR/30-sandbox/.templates/batchsandbox-template.yaml"
    cat "$OUT_DIR/30-sandbox/.templates/opensandbox-resource-requests-patch.py"
} | compute_sha256)"

{
    cat <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: opensandbox-api
  namespace: ${NS_SANDBOX}
type: Opaque
stringData:
  api-key: "${OPENSANDBOX_API_KEY}"
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: opensandbox-server-config
  namespace: ${NS_SANDBOX}
data:
  opensandbox-server-k8s.toml: |
EOF
    sed 's/^/    /' "$OUT_DIR/30-sandbox/opensandbox-server-k8s.toml"
    cat <<EOF
  config.toml: |
EOF
    sed 's/^/    /' "$OUT_DIR/30-sandbox/opensandbox-server-k8s.toml"
    cat <<EOF
  batchsandbox-template.yaml: |
EOF
    sed 's/^/    /' "$OUT_DIR/30-sandbox/.templates/batchsandbox-template.yaml"
    cat <<EOF
  opensandbox-resource-requests-patch.py: |
EOF
    sed 's/^/    /' "$OUT_DIR/30-sandbox/.templates/opensandbox-resource-requests-patch.py"
    cat <<EOF
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: opensandbox-server
  namespace: ${NS_SANDBOX}
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: opensandbox-runtime
  namespace: ${NS_SANDBOX}
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: opensandbox-runtime
  namespace: ${OPENSANDBOX_WORKLOAD_NAMESPACE}
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: opensandbox-sandbox-manager
  namespace: ${NS_SANDBOX}
rules:
  - apiGroups: [""]
    resources: ["pods", "pods/log", "pods/resize", "services", "events", "persistentvolumeclaims", "configmaps", "secrets"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: ["networking.k8s.io"]
    resources: ["ingresses", "networkpolicies"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: ["sandbox.opensandbox.io"]
    resources: ["batchsandboxes", "pools", "sandboxsnapshots"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: opensandbox-server-sandbox-manager
  namespace: ${NS_SANDBOX}
subjects:
  - kind: ServiceAccount
    name: opensandbox-server
    namespace: ${NS_SANDBOX}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: opensandbox-sandbox-manager
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: opensandbox-sandbox-manager
  namespace: ${OPENSANDBOX_WORKLOAD_NAMESPACE}
rules:
  - apiGroups: [""]
    resources: ["pods", "pods/log", "pods/resize", "services", "events", "persistentvolumeclaims", "configmaps", "secrets"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: ["networking.k8s.io"]
    resources: ["ingresses", "networkpolicies"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: ["sandbox.opensandbox.io"]
    resources: ["batchsandboxes", "pools", "sandboxsnapshots"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: opensandbox-server-sandbox-manager
  namespace: ${OPENSANDBOX_WORKLOAD_NAMESPACE}
subjects:
  - kind: ServiceAccount
    name: opensandbox-server
    namespace: ${NS_SANDBOX}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: opensandbox-sandbox-manager
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: opensandbox-server
  namespace: ${NS_SANDBOX}
spec:
  replicas: ${OPENSANDBOX_REPLICAS}
  selector:
    matchLabels:
      app: opensandbox-server
  template:
    metadata:
      labels:
        app: opensandbox-server
      annotations:
        byclaw.io/opensandbox-config-sha256: "${OPENSANDBOX_CONFIG_CHECKSUM}"
    spec:
      serviceAccountName: opensandbox-server
      nodeSelector:
        byclaw.io/node-pool: ${OPENSANDBOX_NODE_POOL}
      containers:
        - name: server
          image: ${IMAGE_SANDBOX_SERVER}
          imagePullPolicy: IfNotPresent
          command: ["/bin/sh", "-c"]
          args:
            - python /etc/opensandbox/opensandbox-resource-requests-patch.py && exec /app/.venv/bin/python3 /app/.venv/bin/opensandbox-server --config /etc/opensandbox/config.toml
          env:
            - name: SANDBOX_CONFIG_PATH
              value: /etc/opensandbox/opensandbox-server-k8s.toml
            - name: OPENSANDBOX_SERVER_API_KEY
              valueFrom:
                secretKeyRef:
                  name: opensandbox-api
                  key: api-key
            - name: BYCLAW_WORKSPACE_HOST_PATH
              value: "${BYCLAW_SANDBOX_FILE_VOLUME_ROOT}"
            - name: BYCLAW_WORKSPACE_PVC_NAME
              value: "${WORKSPACE_PVC_NAME}"
          ports:
            - name: http
              containerPort: ${OPENSANDBOX_API_PORT}
          resources:
            requests:
              cpu: "${OPENSANDBOX_CPU_REQUEST:-500m}"
              memory: "${OPENSANDBOX_MEMORY_REQUEST:-1Gi}"
            limits:
              cpu: "${OPENSANDBOX_CPU_LIMIT:-2}"
              memory: "${OPENSANDBOX_MEMORY_LIMIT:-4Gi}"
          readinessProbe:
            tcpSocket:
              port: http
            initialDelaySeconds: 5
            periodSeconds: 5
          livenessProbe:
            tcpSocket:
              port: http
            initialDelaySeconds: 20
            periodSeconds: 10
          volumeMounts:
            - name: config
              mountPath: /etc/opensandbox
      volumes:
        - name: config
          configMap:
            name: opensandbox-server-config
---
apiVersion: v1
kind: Service
metadata:
  name: opensandbox-server
  namespace: ${NS_SANDBOX}
spec:
  selector:
    app: opensandbox-server
  ports:
    - name: http
      port: ${OPENSANDBOX_API_PORT}
      targetPort: http
EOF
} > "$OUT_DIR/30-sandbox/opensandbox.yaml"

{
render_byclaw_be_configmap
cat <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: byclaw-sandbox-api
  namespace: ${NS_SERVICE}
type: Opaque
stringData:
  api-key: "${BYCLAW_SANDBOX_API_KEY}"
---
apiVersion: v1
kind: Secret
metadata:
  name: byclaw-db-auth
  namespace: ${NS_SERVICE}
type: Opaque
stringData:
  password: "${DB_PASS}"
---
apiVersion: v1
kind: Secret
metadata:
  name: byclaw-redis-auth
  namespace: ${NS_SERVICE}
type: Opaque
stringData:
  password: "${REDIS_PASSWORD}"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: byclaw-be
  namespace: ${NS_SERVICE}
spec:
  replicas: ${BYCLAW_BE_REPLICAS}
  strategy:
    type: Recreate
  selector:
    matchLabels:
      app: byclaw-be
  template:
    metadata:
      labels:
        app: byclaw-be
    spec:
      securityContext:
        fsGroup: 1001
      containers:
        - name: be
          image: ${IMAGE_BE}
          imagePullPolicy: ${BYCLAW_SERVICE_IMAGE_PULL_POLICY}
          ports:
            - name: http
              containerPort: ${BE_SERVER_PORT}
            - name: ws
              containerPort: ${BE_WS_PORT}
          env:
            - name: BE_DOMAINNAME
              value: "${BE_DOMAINNAME}"
            - name: QA_DOMAINNAME
              value: "${QA_DOMAINNAME}"
            - name: DATACLOUD_DOMAINNAME
              value: "${DATACLOUD_DOMAINNAME}"
            - name: HOST
              value: "${HOST}"
            - name: BE_SERVER_PORT
              value: "${BE_SERVER_PORT}"
            - name: BE_WS_PORT
              value: "${BE_WS_PORT}"
            - name: BYCLAW_SANDBOX_ENABLE
              value: "${BYCLAW_SANDBOX_ENABLE:-true}"
            - name: BYCLAW_SANDBOX_BASE_URL
              value: "${BYCLAW_SANDBOX_BASE_URL}"
            - name: BYCLAW_SANDBOX_API_KEY
              valueFrom:
                secretKeyRef:
                  name: byclaw-sandbox-api
                  key: api-key
            - name: BYCLAW_SANDBOX_ENDPOINT_SCHEME
              value: "${BYCLAW_SANDBOX_ENDPOINT_SCHEME}"
            - name: BYCLAW_SANDBOX_PROFILE_ENABLED
              value: "${BYCLAW_SANDBOX_PROFILE_ENABLED:-false}"
            - name: BYCLAW_SANDBOX_TIER_AUTOSCALE_ENABLED
              value: "${BYCLAW_SANDBOX_TIER_AUTOSCALE_ENABLED:-false}"
            - name: BYAI_ACCESS_URLPATTERNS
              value: "${BYAI_ACCESS_URLPATTERNS:-/byaiService/sandbox/autoscale/alerts,/sandbox/autoscale/alerts}"
            - name: BYCLAW_SANDBOX_VOLUME_BACKEND
              value: "${BYCLAW_SANDBOX_VOLUME_BACKEND:-file}"
            - name: FILE_STORAGE_TYPE
              value: "${FILE_STORAGE_TYPE:-file}"
            - name: FILE_STORAGE_MINIO_MOUNT_ENABLED
              value: "${FILE_STORAGE_MINIO_MOUNT_ENABLED:-false}"
            - name: BYCLAW_SANDBOX_FILE_VOLUME_ROOT
              value: "${BYCLAW_SANDBOX_FILE_VOLUME_ROOT}"
            - name: FILE_STORAGE_LOCAL_PATH
              value: "${FILE_STORAGE_LOCAL_PATH}"
            - name: BYCLAW_SANDBOX_FILE_VOLUME_TYPE
              value: "${BYCLAW_SANDBOX_FILE_VOLUME_TYPE:-bind}"
            - name: DB_HOST
              value: "${DB_HOST}"
            - name: DB_PORT
              value: "${DB_PORT}"
            - name: DB_TYPE
              value: "${DB_TYPE}"
            - name: DB_USER
              value: "${DB_USER}"
            - name: DB_PASS
              valueFrom:
                secretKeyRef:
                  name: byclaw-db-auth
                  key: password
            - name: DB_DATABASE
              value: "${DB_DATABASE}"
            - name: DB_SCHEMA
              value: "${DB_SCHEMA}"
            - name: REDIS_HOST
              value: "${REDIS_HOST}"
            - name: REDIS_PORT
              value: "${REDIS_PORT}"
            - name: REDIS_USERNAME
              value: "${REDIS_USERNAME}"
            - name: REDIS_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: byclaw-redis-auth
                  key: password
            - name: REDIS_DATABASE
              value: "${REDIS_DATABASE}"
          resources:
            requests:
              cpu: "${BYCLAW_BE_CPU_REQUEST:-500m}"
              memory: "${BYCLAW_BE_MEMORY_REQUEST:-2Gi}"
            limits:
              cpu: "${BYCLAW_BE_CPU_LIMIT:-2}"
              memory: "${BYCLAW_BE_MEMORY_LIMIT:-4Gi}"
          volumeMounts:
            - name: config
              mountPath: /app/config
              readOnly: true
            - name: logs
              mountPath: /app/logs
            - name: workspace
              mountPath: ${BYCLAW_SANDBOX_FILE_VOLUME_ROOT}
      volumes:
        - name: config
          configMap:
            name: byclaw-be-config
        - name: logs
          emptyDir: {}
        - name: workspace
          persistentVolumeClaim:
            claimName: ${WORKSPACE_PVC_NAME}
---
apiVersion: v1
kind: Service
metadata:
  name: byclaw-be
  namespace: ${NS_SERVICE}
spec:
  selector:
    app: byclaw-be
  ports:
    - name: http
      port: ${BE_SERVER_PORT}
      targetPort: http
    - name: ws
      port: ${BE_WS_PORT}
      targetPort: ws
EOF
} > "$OUT_DIR/40-service/byclaw-be.yaml"

BYCLAW_FE_NGINX_CHECKSUM="$(render_byclaw_fe_nginx_conf | compute_sha256)"

{
cat <<EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: byclaw-fe-nginx
  namespace: ${NS_SERVICE}
data:
  default.conf: |
EOF
render_byclaw_fe_nginx_conf | sed 's/^/    /'
cat <<EOF
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: byclaw-fe
  namespace: ${NS_SERVICE}
spec:
  replicas: ${BYCLAW_FE_REPLICAS}
  strategy:
    type: Recreate
  selector:
    matchLabels:
      app: byclaw-fe
  template:
    metadata:
      labels:
        app: byclaw-fe
      annotations:
        byclaw.io/nginx-config-sha256: "${BYCLAW_FE_NGINX_CHECKSUM}"
    spec:
      containers:
        - name: fe
          image: ${IMAGE_FE}
          imagePullPolicy: ${BYCLAW_SERVICE_IMAGE_PULL_POLICY}
          ports:
            - name: http
              containerPort: 80
          resources:
            requests:
              cpu: "${BYCLAW_FE_CPU_REQUEST:-100m}"
              memory: "${BYCLAW_FE_MEMORY_REQUEST:-256Mi}"
            limits:
              cpu: "${BYCLAW_FE_CPU_LIMIT:-500m}"
              memory: "${BYCLAW_FE_MEMORY_LIMIT:-512Mi}"
          volumeMounts:
            - name: nginx-config
              mountPath: /etc/nginx/conf.d/default.conf
              subPath: default.conf
              readOnly: true
      volumes:
        - name: nginx-config
          configMap:
            name: byclaw-fe-nginx
---
apiVersion: v1
kind: Service
metadata:
  name: byclaw-fe
  namespace: ${NS_SERVICE}
spec:
  selector:
    app: byclaw-fe
  ports:
    - name: http
      port: 80
      targetPort: http
EOF
} > "$OUT_DIR/40-service/byclaw-fe.yaml"

cat > "$OUT_DIR/40-service/byclaw-qa.yaml" <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${QA_DOMAINNAME}
  namespace: ${NS_SERVICE}
spec:
  replicas: ${BYCLAW_QA_REPLICAS}
  strategy:
    type: Recreate
  selector:
    matchLabels:
      app: ${QA_DOMAINNAME}
  template:
    metadata:
      labels:
        app: ${QA_DOMAINNAME}
    spec:
      containers:
        - name: qa
          image: ${IMAGE_QA}
          imagePullPolicy: ${BYCLAW_SERVICE_IMAGE_PULL_POLICY}
          args: ["api"]
          ports:
            - name: http
              containerPort: ${BYCLAW_QA_PORT}
          env:
            - name: QA_DOMAINNAME
              value: "${QA_DOMAINNAME}"
            - name: BE_DOMAINNAME
              value: "${BE_DOMAINNAME}"
            - name: HOST
              value: "${HOST}"
            - name: BYCLAW_QA_PORT
              value: "${BYCLAW_QA_PORT}"
            - name: BYCLAW_QA_AGENT_DATA_PATH
              value: "${BYCLAW_QA_AGENT_DATA_PATH}"
            - name: BYCLAW_QA_KB_FETCH_CACHE_TTL_SECONDS
              value: "${BYCLAW_QA_KB_FETCH_CACHE_TTL_SECONDS}"
            - name: BYCLAW_QA_KB_FETCH_CACHE_CLEANUP_INTERVAL_SECONDS
              value: "${BYCLAW_QA_KB_FETCH_CACHE_CLEANUP_INTERVAL_SECONDS}"
            - name: BYCLAW_QA_KB_MINIO_BUCKET
              value: "${BYCLAW_QA_KB_MINIO_BUCKET}"
            - name: BYCLAW_QA_KB_MINIO_MARKDOWN_BUCKET
              value: "${BYCLAW_QA_KB_MINIO_MARKDOWN_BUCKET}"
            - name: BYCLAW_QA_BYAI_WORKER_ID
              value: "${BYCLAW_QA_BYAI_WORKER_ID}"
            - name: DB_HOST
              value: "${DB_HOST}"
            - name: DB_PORT
              value: "${DB_PORT}"
            - name: DB_TYPE
              value: "${DB_TYPE}"
            - name: DB_USER
              value: "${DB_USER}"
            - name: DB_PASS
              valueFrom:
                secretKeyRef:
                  name: byclaw-db-auth
                  key: password
            - name: DB_DATABASE
              value: "${DB_DATABASE}"
            - name: DB_SCHEMA
              value: "${DB_SCHEMA}"
            - name: REDIS_HOST
              value: "${REDIS_HOST}"
            - name: REDIS_PORT
              value: "${REDIS_PORT}"
            - name: REDIS_USERNAME
              value: "${REDIS_USERNAME}"
            - name: REDIS_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: byclaw-redis-auth
                  key: password
            - name: REDIS_DATABASE
              value: "${REDIS_DATABASE}"
            - name: MINIO_ENDPOINT
              value: "${MINIO_ENDPOINT}"
            - name: MINIO_ACCESS_KEY
              value: "${MINIO_ACCESS_KEY}"
            - name: MINIO_SECRET_KEY
              value: "${MINIO_SECRET_KEY}"
            - name: MINIO_SECURE
              value: "${MINIO_SECURE}"
          resources:
            requests:
              cpu: "${BYCLAW_QA_CPU_REQUEST:-250m}"
              memory: "${BYCLAW_QA_MEMORY_REQUEST:-512Mi}"
            limits:
              cpu: "${BYCLAW_QA_CPU_LIMIT:-1}"
              memory: "${BYCLAW_QA_MEMORY_LIMIT:-2Gi}"
---
apiVersion: v1
kind: Service
metadata:
  name: ${QA_DOMAINNAME}
  namespace: ${NS_SERVICE}
spec:
  selector:
    app: ${QA_DOMAINNAME}
  ports:
    - name: http
      port: ${BYCLAW_QA_PORT}
      targetPort: http
EOF

cat > "$OUT_DIR/40-service/byclaw-data.yaml" <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${DATACLOUD_DOMAINNAME}
  namespace: ${NS_SERVICE}
spec:
  replicas: ${BYCLAW_DATA_REPLICAS}
  strategy:
    type: Recreate
  selector:
    matchLabels:
      app: ${DATACLOUD_DOMAINNAME}
  template:
    metadata:
      labels:
        app: ${DATACLOUD_DOMAINNAME}
    spec:
      containers:
        - name: data
          image: ${IMAGE_DATA}
          imagePullPolicy: ${BYCLAW_SERVICE_IMAGE_PULL_POLICY}
          ports:
            - name: http
              containerPort: ${DATACLOUD_DATA_SERVICE_PORT}
          env:
            - name: DATACLOUD_DOMAINNAME
              value: "${DATACLOUD_DOMAINNAME}"
            - name: BE_DOMAINNAME
              value: "${BE_DOMAINNAME}"
            - name: BE_DOMAINNAME_URL
              value: "${BE_DOMAINNAME_URL}"
            - name: HOST
              value: "${HOST}"
            - name: BE_SERVER_PORT
              value: "${BE_SERVER_PORT}"
            - name: DATACLOUD_PORT
              value: "${DATACLOUD_PORT}"
            - name: DATACLOUD_DATA_SERVICE_PORT
              value: "${DATACLOUD_DATA_SERVICE_PORT}"
            - name: DATACLOUD_DATA_SERVICE_URL
              value: "${DATACLOUD_DATA_SERVICE_URL}"
            - name: DATACLOUD_API_BASE_URL
              value: "${DATACLOUD_API_BASE_URL}"
            - name: DATACLOUD_START_MCP_SERVICE
              value: "${DATACLOUD_START_MCP_SERVICE}"
            - name: DATACLOUD_START_GATEWAY_WORKER
              value: "${DATACLOUD_START_GATEWAY_WORKER}"
            - name: DATACLOUD_GATEWAY_WORKER_ID
              value: "${DATACLOUD_GATEWAY_WORKER_ID}"
            - name: DATACLOUD_GATEWAY_CONSUMER_GROUP
              value: "${DATACLOUD_GATEWAY_CONSUMER_GROUP}"
            - name: DATACLOUD_GATEWAY_WORKSPACE_DIR
              value: "${DATACLOUD_GATEWAY_WORKSPACE_DIR}"
            - name: DATACLOUD_RESULT_FILE_API_BASE_URL
              value: "${DATACLOUD_RESULT_FILE_API_BASE_URL}"
            - name: DB_HOST
              value: "${DB_HOST}"
            - name: DB_PORT
              value: "${DB_PORT}"
            - name: DB_TYPE
              value: "${DB_TYPE}"
            - name: DB_USER
              value: "${DB_USER}"
            - name: DB_PASS
              valueFrom:
                secretKeyRef:
                  name: byclaw-db-auth
                  key: password
            - name: DB_DATABASE
              value: "${DB_DATABASE}"
            - name: DB_SCHEMA
              value: "${DB_SCHEMA}"
            - name: REDIS_HOST
              value: "${REDIS_HOST}"
            - name: REDIS_PORT
              value: "${REDIS_PORT}"
            - name: REDIS_USERNAME
              value: "${REDIS_USERNAME}"
            - name: REDIS_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: byclaw-redis-auth
                  key: password
            - name: REDIS_DATABASE
              value: "${REDIS_DATABASE}"
          resources:
            requests:
              cpu: "${BYCLAW_DATA_CPU_REQUEST:-250m}"
              memory: "${BYCLAW_DATA_MEMORY_REQUEST:-512Mi}"
            limits:
              cpu: "${BYCLAW_DATA_CPU_LIMIT:-1}"
              memory: "${BYCLAW_DATA_MEMORY_LIMIT:-2Gi}"
---
apiVersion: v1
kind: Service
metadata:
  name: ${DATACLOUD_DOMAINNAME}
  namespace: ${NS_SERVICE}
spec:
  selector:
    app: ${DATACLOUD_DOMAINNAME}
  ports:
    - name: http
      port: ${DATACLOUD_DATA_SERVICE_PORT}
      targetPort: http
EOF

{
    cat <<EOF
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: byclaw
  namespace: ${NS_SERVICE}
  annotations:
    traefik.ingress.kubernetes.io/router.entrypoints: web
spec:
  ingressClassName: traefik
  rules:
    - http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: byclaw-fe
                port:
                  number: 80
EOF
} > "$OUT_DIR/50-ingress/byclaw-ingress.yaml"

if [ "${GENERATE_STATIC_SANDBOX_WILDCARD_INGRESS:-false}" = "true" ] && [ -n "$OPENSANDBOX_TLS_SECRET" ]; then
    cat > "$OUT_DIR/50-ingress/sandbox-wildcard-ingress.yaml" <<EOF
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: sandbox-gateway-wildcard
  namespace: ${NS_SANDBOX}
  annotations:
    traefik.ingress.kubernetes.io/router.entrypoints: websecure
spec:
  ingressClassName: traefik
  tls:
    - hosts:
        - "*.${SANDBOX_INGRESS_HOST}"
      secretName: ${OPENSANDBOX_TLS_SECRET}
  rules:
    - host: "*.${SANDBOX_INGRESS_HOST}"
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: opensandbox-ingress-gateway
                port:
                  number: ${OPENSANDBOX_GATEWAY_PORT:-8080}
EOF
fi

if [ "$MONITORING_ENABLED" = "true" ]; then
    cat > "$OUT_DIR/60-monitoring/hpa-opensandbox.yaml" <<EOF
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: opensandbox-server
  namespace: ${NS_SANDBOX}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: opensandbox-server
  minReplicas: ${OPENSANDBOX_HPA_MIN}
  maxReplicas: ${OPENSANDBOX_HPA_MAX:-6}
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: ${OPENSANDBOX_HPA_CPU:-70}
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: ${OPENSANDBOX_HPA_MEMORY:-80}
EOF
    cat > "$OUT_DIR/60-monitoring/alert-rules.yaml" <<EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: prometheus-sandbox-autoscale-rules
  namespace: ${NS_MONITORING}
data:
  sandbox-autoscale-rules.yml: |
    groups:
      - name: byclaw.sandbox.autoscale
        interval: 30s
        rules:
          - alert: OpenClawSandboxCpuHigh
            expr: |
              sum by (namespace, pod) (
                rate(container_cpu_usage_seconds_total{
                  namespace="${OPENSANDBOX_WORKLOAD_NAMESPACE}",
                  container="sandbox",
                  pod=~"[0-9a-f-]{36}-[0-9]+"
                }[5m])
              )
              /
              sum by (namespace, pod) (
                kube_pod_container_resource_requests{
                  namespace="${OPENSANDBOX_WORKLOAD_NAMESPACE}",
                  container="sandbox",
                  resource="cpu"
                }
              ) > ${SANDBOX_AUTOSCALE_CPU_HIGH_RATIO:-0.85}
            for: ${SANDBOX_AUTOSCALE_CPU_HIGH_FOR:-5m}
            labels:
              severity: warning
              service_type: openclaw
              trigger_source: PROMETHEUS_ALERT
              reason_code: metrics.cpu.high
              suggested_resize_type: IN_PLACE
            annotations:
              summary: "OpenClaw 沙箱 CPU 持续偏高"
              reason_detail: "CPU 使用率连续 ${SANDBOX_AUTOSCALE_CPU_HIGH_FOR:-5m} 超过 request 的 ${SANDBOX_AUTOSCALE_CPU_HIGH_PERCENT:-85}%，建议升一级规格。pod={{ \$labels.pod }} value={{ \$value }}"

          - alert: OpenClawSandboxMemoryHigh
            expr: |
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
              ) > ${SANDBOX_AUTOSCALE_MEMORY_HIGH_RATIO:-0.90}
            for: ${SANDBOX_AUTOSCALE_MEMORY_HIGH_FOR:-5m}
            labels:
              severity: warning
              service_type: openclaw
              trigger_source: PROMETHEUS_ALERT
              reason_code: metrics.memory.high
              suggested_resize_type: IN_PLACE
            annotations:
              summary: "OpenClaw 沙箱内存持续偏高"
              reason_detail: "内存 Working Set 连续 ${SANDBOX_AUTOSCALE_MEMORY_HIGH_FOR:-5m} 超过 request 的 ${SANDBOX_AUTOSCALE_MEMORY_HIGH_PERCENT:-90}%，建议升一级规格。pod={{ \$labels.pod }} value={{ \$value }}"

          - alert: OpenClawSandboxMemoryCritical
            expr: |
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
              ) > ${SANDBOX_AUTOSCALE_MEMORY_CRITICAL_RATIO:-0.85}
            for: ${SANDBOX_AUTOSCALE_MEMORY_CRITICAL_FOR:-2m}
            labels:
              severity: critical
              service_type: openclaw
              trigger_source: PROMETHEUS_ALERT
              reason_code: metrics.memory.critical
              suggested_resize_type: HOT_SWITCH
            annotations:
              summary: "OpenClaw 沙箱内存接近上限"
              reason_detail: "内存 Working Set 连续 ${SANDBOX_AUTOSCALE_MEMORY_CRITICAL_FOR:-2m} 超过 limit 的 ${SANDBOX_AUTOSCALE_MEMORY_CRITICAL_PERCENT:-85}%，建议优先原地调整，失败时热切换。pod={{ \$labels.pod }} value={{ \$value }}"

          - alert: OpenClawSandboxLowUsage
            expr: |
              (
                sum by (namespace, pod) (
                  rate(container_cpu_usage_seconds_total{
                    namespace="${OPENSANDBOX_WORKLOAD_NAMESPACE}",
                    container="sandbox",
                    pod=~"[0-9a-f-]{36}-[0-9]+"
                  }[15m])
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
              and
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
            for: ${SANDBOX_AUTOSCALE_LOW_USAGE_FOR:-45m}
            labels:
              severity: info
              service_type: openclaw
              trigger_source: PROMETHEUS_ALERT
              reason_code: metrics.low_usage
              suggested_resize_type: PREFERRED_ONLY
            annotations:
              summary: "OpenClaw 沙箱资源长期低使用"
              reason_detail: "CPU 和内存长期低于当前 request 阈值，建议只更新用户下一次启动推荐规格。pod={{ \$labels.pod }} value={{ \$value }}"
EOF
fi

echo "Rendered manifests into $OUT_DIR"
