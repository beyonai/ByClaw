#!/bin/bash
# Install an HA k3s cluster through SSH and label nodes for ByClaw sandbox pools.
# Usage:
#   bash deploy/k3s/install-k3s.sh [env.k3s]
#   bash deploy/k3s/install-k3s.sh [env.k3s] registry-sync
#   bash deploy/k3s/install-k3s.sh [env.k3s] image-prune
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ENV_FILE="${1:-./env.k3s.example}"
INSTALL_ACTION="${2:-install}"
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

K3S_API_HOST="${K3S_API_HOST:-k3s-api.example.com}"
K3S_JOIN_URL="${K3S_JOIN_URL:-https://${K3S_API_HOST}:6443}"
K3S_INSTALL_CHANNEL="${K3S_INSTALL_CHANNEL:-stable}"
# China mirror: set K3S_USE_CN_MIRROR=true or K3S_INSTALL_MIRROR=cn with rancher-mirror script URL.
if [ "${K3S_USE_CN_MIRROR:-false}" = "true" ]; then
    K3S_INSTALL_SCRIPT_URL="${K3S_INSTALL_SCRIPT_URL:-https://rancher-mirror.rancher.cn/k3s/k3s-install.sh}"
    K3S_INSTALL_MIRROR="${K3S_INSTALL_MIRROR:-cn}"
    K3S_REGISTRY_MIRROR_DOCKER="${K3S_REGISTRY_MIRROR_DOCKER:-https://docker.m.daocloud.io}"
    K3S_REGISTRY_MIRROR_K8S="${K3S_REGISTRY_MIRROR_K8S:-https://registry.aliyuncs.com/google_containers}"
    K3S_REGISTRY_MIRROR_QUAY="${K3S_REGISTRY_MIRROR_QUAY:-https://quay.m.daocloud.io}"
    K3S_DISABLE_DEFAULT_REGISTRY_ENDPOINT="${K3S_DISABLE_DEFAULT_REGISTRY_ENDPOINT:-true}"
else
    K3S_INSTALL_SCRIPT_URL="${K3S_INSTALL_SCRIPT_URL:-https://get.k3s.io}"
fi
K3S_DATA_DIR="${K3S_DATA_DIR:-/data/rancher/k3s}"
K3S_KUBELET_ROOT="${K3S_KUBELET_ROOT:-/data/kubelet}"
LONGHORN_DATA_PATH="${LONGHORN_DATA_PATH:-/data/longhorn}"
K3S_SERVER_KUBE_RESERVED="${K3S_SERVER_KUBE_RESERVED:-cpu=1000m,memory=2Gi,ephemeral-storage=5Gi}"
K3S_SERVER_SYSTEM_RESERVED="${K3S_SERVER_SYSTEM_RESERVED:-cpu=1000m,memory=2Gi,ephemeral-storage=5Gi}"
K3S_AGENT_KUBE_RESERVED="${K3S_AGENT_KUBE_RESERVED:-cpu=500m,memory=1Gi,ephemeral-storage=3Gi}"
K3S_AGENT_SYSTEM_RESERVED="${K3S_AGENT_SYSTEM_RESERVED:-cpu=500m,memory=1Gi,ephemeral-storage=3Gi}"
K3S_EVICTION_HARD="${K3S_EVICTION_HARD:-memory.available<500Mi,nodefs.available<10%}"
K3S_USER="${K3S_SSH_USER:-${K3S_SERVER_USER:-root}}"
K3S_PORT="${K3S_SSH_PORT:-${K3S_SERVER_PORT:-22}}"
K3S_PASSWORD="${K3S_SSH_PASSWORD:-${K3S_SERVER_PASSWORD:-}}"
K3S_NODE_INTERNAL_IPS="${K3S_NODE_INTERNAL_IPS:-}"
K3S_NODE_EXTERNAL_IPS="${K3S_NODE_EXTERNAL_IPS:-}"
K3S_TLS_SANS="${K3S_TLS_SANS:-}"
K3S_ENABLE_SERVICELB="${K3S_ENABLE_SERVICELB:-true}"
BYCLAW_K3S_CLEAN_STALE_PROCESSES="${BYCLAW_K3S_CLEAN_STALE_PROCESSES:-true}"
BYCLAW_K3S_FORCE_REINSTALL="${BYCLAW_K3S_FORCE_REINSTALL:-false}"
BYCLAW_K3S_PRUNE_EMPTY_IMAGES_ON_UPDATE="${BYCLAW_K3S_PRUNE_EMPTY_IMAGES_ON_UPDATE:-true}"
BYCLAW_K3S_PRUNE_DANGLING_IMAGES="${BYCLAW_K3S_PRUNE_DANGLING_IMAGES:-true}"
BYCLAW_K3S_PRUNE_IMAGE_REPOS="${BYCLAW_K3S_PRUNE_IMAGE_REPOS:-}"

POOL_GENERAL="${K3S_NODE_POOL_GENERAL:-sandbox-general}"
POOL_BROWSER="${K3S_NODE_POOL_BROWSER:-sandbox-browser}"
POOL_HEAVY="${K3S_NODE_POOL_HEAVY:-sandbox-heavy}"
K3S_CUSTOM_NODE_NAMES="${K3S_CUSTOM_NODE_NAMES:-true}"
K3S_NODE_NAME_MASTER_PREFIX="${K3S_NODE_NAME_MASTER_PREFIX:-byclaw-master}"
K3S_NODE_NAME_WORKER_PREFIX="${K3S_NODE_NAME_WORKER_PREFIX:-byclaw-node}"
# Cluster control/data plane uses VPC internal IPs only; SSH hosts may still be public.
K3S_CLUSTER_INTERNAL_ONLY="${K3S_CLUSTER_INTERNAL_ONLY:-true}"

log_step() {
    printf "\n[%s] %s\n" "$(date '+%H:%M:%S')" "$*"
}

k3s_install_env_prefix() {
    local prefix="INSTALL_K3S_CHANNEL='${K3S_INSTALL_CHANNEL}'"
    if [ -n "${K3S_INSTALL_MIRROR:-}" ]; then
        prefix="INSTALL_K3S_MIRROR='${K3S_INSTALL_MIRROR}' ${prefix}"
    fi
    printf '%s' "$prefix"
}

k3s_install_name_env_for_host() {
    local host="$1"
    local role="$2"
    local name
    if [ "${K3S_CUSTOM_NODE_NAMES}" != "true" ]; then
        return 0
    fi
    name="$(k3s_custom_node_name "$host" "$role")"
    printf "INSTALL_K3S_NAME='%s' " "$name"
}

split_csv() {
    local value="${1:-}"
    value="${value// /}"
    if [ -z "$value" ]; then
        return 0
    fi
    IFS=',' read -r -a _split_items <<< "$value"
    printf '%s\n' "${_split_items[@]}" | sed '/^$/d'
}

shell_single_quote() {
    printf "%s" "$1" | sed "s/'/'\\\\''/g; 1s/^/'/; \$s/\$/'/"
}

map_value_for_host() {
    local host="$1"
    local mapping="${2:-}"
    local pair
    local key
    local value
    while IFS= read -r pair; do
        key="${pair%%=*}"
        value="${pair#*=}"
        if [ "$key" = "$host" ] && [ "$value" != "$pair" ]; then
            printf '%s\n' "$value"
            return 0
        fi
    done < <(split_csv "$mapping")
    return 1
}

csv_contains() {
    local needle="$1"
    local list="${2:-}"
    local item
    while IFS= read -r item; do
        [ "$item" = "$needle" ] && return 0
    done < <(split_csv "$list")
    return 1
}

node_pool_for_host() {
    local host="$1"
    if csv_contains "$host" "${K3S_NODE_POOL_BROWSER_HOSTS:-}"; then
        printf '%s\n' "$POOL_BROWSER"
    elif csv_contains "$host" "${K3S_NODE_POOL_HEAVY_HOSTS:-}"; then
        printf '%s\n' "$POOL_HEAVY"
    else
        printf '%s\n' "$POOL_GENERAL"
    fi
}

node_internal_ip_for_host() {
    map_value_for_host "$1" "$K3S_NODE_INTERNAL_IPS" || true
}

node_external_ip_for_host() {
    map_value_for_host "$1" "$K3S_NODE_EXTERNAL_IPS" || true
}

is_private_ip() {
    local ip="$1"
    [[ "$ip" =~ ^10\. ]] && return 0
    [[ "$ip" =~ ^192\.168\. ]] && return 0
    [[ "$ip" =~ ^172\.(1[6-9]|2[0-9]|3[0-1])\. ]] && return 0
    return 1
}

is_public_ip() {
    local value="$1"
    [[ "$value" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || return 1
    is_private_ip "$value" && return 1
    return 0
}

node_ip_for_naming() {
    local host="$1"
    local ip
    ip="$(node_internal_ip_for_host "$host")"
    if [ -z "$ip" ]; then
        echo "Error: K3S_NODE_INTERNAL_IPS must map SSH host $host to a VPC internal IP." >&2
        return 1
    fi
    printf '%s\n' "$ip"
}

validate_k3s_node_name() {
    local name="$1"
    if [[ ! "$name" =~ ^[a-z0-9]([-a-z0-9]*[a-z0-9])?$ ]]; then
        echo "Error: invalid k3s node name '${name}'. Use lowercase DNS labels (a-z, 0-9, hyphen); underscores are not allowed." >&2
        return 1
    fi
}

k3s_custom_node_name() {
    local host="$1"
    local role="$2"
    local ip
    local suffix
    local name
    if [ "${K3S_CUSTOM_NODE_NAMES}" != "true" ]; then
        remote_hostname "$host"
        return 0
    fi
    ip="$(node_ip_for_naming "$host")"
    if [ -z "$ip" ]; then
        echo "Error: cannot derive node name for $host; configure K3S_NODE_INTERNAL_IPS or use an IP SSH host." >&2
        return 1
    fi
    suffix="${ip##*.}"
    if [ "$role" = "server" ]; then
        name="${K3S_NODE_NAME_MASTER_PREFIX}-${suffix}"
    else
        name="${K3S_NODE_NAME_WORKER_PREFIX}-${suffix}"
    fi
    validate_k3s_node_name "$name"
    printf '%s\n' "$name"
}

k3s_node_name_args() {
    local host="$1"
    local role="$2"
    local name
    if [ "${K3S_CUSTOM_NODE_NAMES}" != "true" ]; then
        return 0
    fi
    name="$(k3s_custom_node_name "$host" "$role")"
    printf " --node-name %s" "$(shell_single_quote "$name")"
}

k3s_node_ip_args() {
    local host="$1"
    local internal_ip
    local external_ip
    internal_ip="$(node_internal_ip_for_host "$host")"
    if [ "${K3S_CLUSTER_INTERNAL_ONLY}" = "true" ]; then
        if [ -z "$internal_ip" ]; then
            echo "Error: K3S_NODE_INTERNAL_IPS must map SSH host $host to a VPC internal IP." >&2
            return 1
        fi
        printf " --node-ip %s" "$(shell_single_quote "$internal_ip")"
        return 0
    fi
    external_ip="$(node_external_ip_for_host "$host")"
    if [ -n "$internal_ip" ]; then
        printf " --node-ip %s" "$(shell_single_quote "$internal_ip")"
    fi
    if [ -n "$external_ip" ]; then
        printf " --node-external-ip %s" "$(shell_single_quote "$external_ip")"
    fi
}

k3s_tls_san_append() {
    local value="$1"
    local _seen_name="_K3S_TLS_SAN_SEEN_${2}"
    local seen="${!_seen_name-}"
    [ -n "$value" ] || return 0
    case " ${seen} " in
        *" ${value} "*) return 0 ;;
    esac
    printf -v "$_seen_name" '%s %s' "$seen" "$value"
    printf " --tls-san %s" "$(shell_single_quote "$value")"
}

k3s_tls_san_args() {
    local host="$1"
    local san
    local internal_ip
    local pair
    local key
    local value
    local _seen_id
    _seen_id="$(printf '%s' "$host" | tr -c 'A-Za-z0-9_' '_')"

    if [ "${K3S_CLUSTER_INTERNAL_ONLY}" = "true" ]; then
        internal_ip="$(node_internal_ip_for_host "$host")"
        k3s_tls_san_append "$internal_ip" "$_seen_id"
        if [ "${#SERVER_HOSTS[@]}" -gt 0 ]; then
            k3s_tls_san_append "$(node_internal_ip_for_host "${SERVER_HOSTS[0]}")" "$_seen_id"
        fi
        while IFS= read -r pair; do
            key="${pair%%=*}"
            value="${pair#*=}"
            [ "$value" != "$pair" ] || continue
            is_private_ip "$value" && k3s_tls_san_append "$value" "$_seen_id"
        done < <(split_csv "$K3S_NODE_INTERNAL_IPS")
        while IFS= read -r san; do
            [ -n "$san" ] || continue
            if [[ "$san" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
                is_private_ip "$san" && k3s_tls_san_append "$san" "$_seen_id"
            else
                k3s_tls_san_append "$san" "$_seen_id"
            fi
        done < <(split_csv "$K3S_TLS_SANS")
        return 0
    fi
    if [ -n "$K3S_API_HOST" ]; then
        k3s_tls_san_append "$K3S_API_HOST" "$_seen_id"
    fi
    internal_ip="$(node_internal_ip_for_host "$host")"
    if [ -n "$internal_ip" ] && [ "$internal_ip" != "$K3S_API_HOST" ]; then
        k3s_tls_san_append "$internal_ip" "$_seen_id"
    fi
    while IFS= read -r san; do
        [ -n "$san" ] || continue
        k3s_tls_san_append "$san" "$_seen_id"
    done < <(split_csv "$K3S_TLS_SANS")
}

k3s_advertise_address_args() {
    local host="$1"
    local internal_ip
    internal_ip="$(node_internal_ip_for_host "$host")"
    if [ -n "$internal_ip" ]; then
        printf " --advertise-address %s" "$(shell_single_quote "$internal_ip")"
    fi
}

k3s_registry_install_args() {
    if [ "${K3S_DISABLE_DEFAULT_REGISTRY_ENDPOINT:-false}" = "true" ]; then
        printf '%s' ' --disable-default-registry-endpoint'
    fi
}

k3s_servicelb_install_args() {
    if [ "${K3S_ENABLE_SERVICELB}" != "true" ]; then
        printf '%s' ' --disable servicelb'
    fi
}

registries_mirrors_enabled() {
    [ -n "${K3S_REGISTRY_MIRROR_DOCKER:-}" ] \
        || [ -n "${K3S_REGISTRY_MIRROR_K8S:-}" ] \
        || [ -n "${K3S_REGISTRY_MIRROR_QUAY:-}" ]
}

private_registries_enabled() {
    [ -n "${K3S_PRIVATE_REGISTRIES:-}" ]
}

registries_config_enabled() {
    registries_mirrors_enabled || private_registries_enabled
}

yaml_double_quote() {
    local value="$1"
    value="${value//\\/\\\\}"
    value="${value//\"/\\\"}"
    printf '"%s"' "$value"
}

# K3S_PRIVATE_REGISTRIES: comma-separated entries
#   host[:port]|username|password[|http|insecure]
# Examples:
#   192.168.0.158:8080|admin|secret|http|true
#   harbor.example.com|robot$proj|token|https|false
append_private_registry_mirrors() {
    local yaml="$1"
    local entry host user pass scheme insecure endpoint quoted_host
    local -a fields

    while IFS= read -r entry; do
        entry="$(printf '%s' "$entry" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
        [ -n "$entry" ] || continue
        IFS='|' read -r -a fields <<< "$entry"
        host="${fields[0]:-}"
        user="${fields[1]:-}"
        pass="${fields[2]:-}"
        scheme="${fields[3]:-https}"
        insecure="${fields[4]:-}"
        if [ -z "$host" ] || [ -z "$user" ] || [ -z "$pass" ]; then
            echo "Error: invalid K3S_PRIVATE_REGISTRIES entry (need host|user|pass): $entry" >&2
            exit 1
        fi
        quoted_host="$(yaml_double_quote "$host")"
        endpoint="${scheme}://${host}"
        yaml+="  ${quoted_host}:\n    endpoint:\n      - $(yaml_double_quote "$endpoint")\n"
    done < <(printf '%s\n' "${K3S_PRIVATE_REGISTRIES}" | tr ',' '\n')
    printf '%b' "$yaml"
}

append_private_registry_configs() {
    local yaml="$1"
    local entry host user pass scheme insecure quoted_host quoted_user quoted_pass
    local -a fields

    while IFS= read -r entry; do
        entry="$(printf '%s' "$entry" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
        [ -n "$entry" ] || continue
        IFS='|' read -r -a fields <<< "$entry"
        host="${fields[0]:-}"
        user="${fields[1]:-}"
        pass="${fields[2]:-}"
        scheme="${fields[3]:-https}"
        insecure="${fields[4]:-}"
        if [ -z "$host" ] || [ -z "$user" ] || [ -z "$pass" ]; then
            echo "Error: invalid K3S_PRIVATE_REGISTRIES entry (need host|user|pass): $entry" >&2
            exit 1
        fi
        if [ -z "$insecure" ]; then
            if [ "$scheme" = "http" ]; then
                insecure="true"
            else
                insecure="false"
            fi
        fi
        quoted_host="$(yaml_double_quote "$host")"
        quoted_user="$(yaml_double_quote "$user")"
        quoted_pass="$(yaml_double_quote "$pass")"
        yaml+="  ${quoted_host}:\n"
        yaml+="    auth:\n      username: ${quoted_user}\n      password: ${quoted_pass}\n"
        if [ "$insecure" = "true" ]; then
            yaml+="    tls:\n      insecure_skip_verify: true\n"
        fi
    done < <(printf '%s\n' "${K3S_PRIVATE_REGISTRIES}" | tr ',' '\n')
    printf '%b' "$yaml"
}

build_registries_yaml() {
    local mirrors_yaml=""
    local configs_yaml=""

    if registries_mirrors_enabled || private_registries_enabled; then
        mirrors_yaml="mirrors:\n"
        if [ -n "${K3S_REGISTRY_MIRROR_DOCKER:-}" ]; then
            mirrors_yaml+="  docker.io:\n    endpoint:\n      - $(yaml_double_quote "${K3S_REGISTRY_MIRROR_DOCKER}")\n"
        fi
        if [ -n "${K3S_REGISTRY_MIRROR_K8S:-}" ]; then
            mirrors_yaml+="  registry.k8s.io:\n    endpoint:\n      - $(yaml_double_quote "${K3S_REGISTRY_MIRROR_K8S}")\n"
        fi
        if [ -n "${K3S_REGISTRY_MIRROR_QUAY:-}" ]; then
            mirrors_yaml+="  quay.io:\n    endpoint:\n      - $(yaml_double_quote "${K3S_REGISTRY_MIRROR_QUAY}")\n"
        fi
    fi

    if private_registries_enabled; then
        mirrors_yaml="$(append_private_registry_mirrors "$mirrors_yaml")"$'\n'
        configs_yaml="$(append_private_registry_configs "configs:\n")"
    else
        configs_yaml="configs: {}\n"
    fi

    printf '%b%b' "$mirrors_yaml" "$configs_yaml"
}

registry_prep() {
    if ! registries_config_enabled; then
        return 0
    fi
    local registries_b64
    registries_b64="$(build_registries_yaml | base64 | tr -d '\n')"
    cat <<PREP
echo "[remote:\$(hostname)] write /etc/rancher/k3s/registries.yaml"
sudo mkdir -p /etc/rancher/k3s
echo '${registries_b64}' | base64 -d | sudo tee /etc/rancher/k3s/registries.yaml >/dev/null
PREP
}

restart_k3s_service_if_active() {
    local host="$1"
    local service="$2"
    ssh_run "$host" "if sudo systemctl is-active --quiet '${service}'; then
  echo '[remote:'\$(hostname)'] restart ${service} to apply configuration'
  sudo systemctl restart '${service}'
fi"
}

# With --node-name, k3s uses k3s-<node-name> for both server and agent (not k3s-agent-<name>).
k3s_unit_name_for_host() {
    local host="$1"
    local role="$2"
    if [ "${K3S_CUSTOM_NODE_NAMES}" = "true" ]; then
        printf 'k3s-%s' "$(k3s_custom_node_name "$host" "$role")"
        return 0
    fi
    if [ "$role" = "agent" ]; then
        printf '%s' "k3s-agent"
    else
        printf '%s' "k3s"
    fi
}

uninstall_all_k3s_on_host() {
    local host="$1"
    ssh_run "$host" "set +e
shopt -s nullglob
for script in /usr/local/bin/k3s-uninstall.sh /usr/local/bin/k3s-agent-uninstall.sh /usr/local/bin/k3s-*-uninstall.sh; do
  [ -x \"\$script\" ] || continue
  echo '[remote:'\$(hostname)'] run '\$script
  sudo \"\$script\" || true
done
if [ -d '${K3S_DATA_DIR}' ]; then
  echo '[remote:'\$(hostname)'] purge k3s data dir ${K3S_DATA_DIR}'
  sudo rm -rf '${K3S_DATA_DIR}'
fi"
}

k3s_should_skip_install() {
    local host="$1"
    local role="$2"
    local service
    if [ "${BYCLAW_K3S_FORCE_REINSTALL}" = "true" ]; then
        return 1
    fi
    service="$(k3s_unit_name_for_host "$host" "$role")"
    [ "$(k3s_service_status "$host" "$service" | tail -1)" = "active" ]
}

prepare_cluster_node() {
    local host="$1"
    local role="$2"
    local service
    service="$(k3s_unit_name_for_host "$host" "$role")"
    log_step "Prepare cluster node: host=$host role=$role"
    cleanup_stale_node_install_processes "$host"
    ensure_reinstallable_state "$host" "$role" >/dev/null || true
    ssh_run "$host" "$(common_prep)"
    if registries_config_enabled; then
        restart_k3s_service_if_active "$host" "$service"
    fi
}

prepare_all_cluster_nodes() {
    local host
    log_step "Prepare all cluster nodes (idempotent baseline)"
    for host in "${SERVER_HOSTS[@]}"; do
        [ -n "$host" ] || continue
        prepare_cluster_node "$host" "server"
    done
    for host in "${AGENT_HOSTS[@]}"; do
        [ -n "$host" ] || continue
        prepare_cluster_node "$host" "agent"
    done
}

sync_registries_all_cluster_nodes() {
    local host
    local service
    if ! registries_config_enabled; then
        log_step "Registry sync skipped: no registry mirror or private registry configured"
        return 0
    fi
    log_step "Sync k3s registry config on all cluster nodes"
    for host in "${SERVER_HOSTS[@]}"; do
        [ -n "$host" ] || continue
        service="$(k3s_unit_name_for_host "$host" "server")"
        ssh_run "$host" "$(registry_prep)"
        restart_k3s_service_if_active "$host" "$service"
    done
    for host in "${AGENT_HOSTS[@]}"; do
        [ -n "$host" ] || continue
        service="$(k3s_unit_name_for_host "$host" "agent")"
        ssh_run "$host" "$(registry_prep)"
        restart_k3s_service_if_active "$host" "$service"
    done
}

image_repo_from_ref() {
    local ref="$1"
    local last
    ref="${ref%@sha256:*}"
    last="${ref##*/}"
    if [[ "$last" == *:* ]]; then
        ref="${ref%:*}"
    fi
    printf '%s\n' "$ref"
}

default_prune_image_repos() {
    local image
    local repo
    local repos=""
    for image in "${IMAGE_BE:-}" "${IMAGE_SUPER:-}" "${IMAGE_FE:-}" "${IMAGE_QA:-}" "${IMAGE_DATA:-}"; do
        [ -n "$image" ] || continue
        repo="$(image_repo_from_ref "$image")"
        [ -n "$repo" ] || continue
        case ",${repos}," in
            *",${repo},"*) ;;
            *)
                if [ -n "$repos" ]; then
                    repos="${repos},${repo}"
                else
                    repos="$repo"
                fi
                ;;
        esac
    done
    printf '%s\n' "$repos"
}

prune_empty_images_on_host() {
    local host="$1"
    local repos_csv="$2"
    [ -n "$repos_csv" ] || return 0
    ssh_run "$host" "set -euo pipefail
export K3S_DATA_DIR='${K3S_DATA_DIR}'
repos_csv=$(shell_single_quote "$repos_csv")
prune_dangling='${BYCLAW_K3S_PRUNE_DANGLING_IMAGES}'
echo \"[remote:\$(hostname)] prune empty image refs for repos: \${repos_csv}\"
if ! command -v k3s >/dev/null 2>&1; then
  echo \"[remote:\$(hostname)] k3s not found; skip image prune\"
  exit 0
fi
image_table=\"\$(sudo K3S_DATA_DIR=\"\${K3S_DATA_DIR}\" k3s ctr -n k8s.io images ls 2>/dev/null || true)\"
if [ -z \"\$image_table\" ]; then
  echo \"[remote:\$(hostname)] containerd image table is empty or unavailable\"
  exit 0
fi
tagged_digests=\"\$(printf '%s\n' \"\$image_table\" | awk -v repos=\"\$repos_csv\" '
function repo_of(ref, base, last) {
  base = ref
  sub(/@sha256:.*/, \"\", base)
  last = base
  sub(/^.*\\//, \"\", last)
  if (last ~ /:/) {
    sub(/:[^:\\/]*$/, \"\", base)
  }
  return base
}
function matched(ref, base, i) {
  base = repo_of(ref)
  for (i = 1; i <= n; i++) {
    if (base == repo[i]) return 1
  }
  return 0
}
BEGIN {
  n = split(repos, repo, \",\")
}
NR > 1 && matched(\$1) && \$1 !~ /@sha256:/ && \$3 ~ /^sha256:/ {
  print \$3
}
' | sort -u)\"
removed=0
kept=0
printf '%s\n' \"\$image_table\" | awk -v repos=\"\$repos_csv\" '
function repo_of(ref, base, last) {
  base = ref
  sub(/@sha256:.*/, \"\", base)
  last = base
  sub(/^.*\\//, \"\", last)
  if (last ~ /:/) {
    sub(/:[^:\\/]*$/, \"\", base)
  }
  return base
}
function matched(ref, base, i) {
  base = repo_of(ref)
  for (i = 1; i <= n; i++) {
    if (base == repo[i]) return 1
  }
  return 0
}
BEGIN {
  n = split(repos, repo, \",\")
}
NR > 1 && matched(\$1) && \$1 ~ /@sha256:/ && \$3 ~ /^sha256:/ {
  print \$1, \$3
}
' | while read -r ref digest; do
  [ -n \"\$ref\" ] || continue
  if printf '%s\n' \"\$tagged_digests\" | grep -qx \"\$digest\"; then
    echo \"[remote:\$(hostname)] keep tagged digest ref: \$ref\"
    kept=\$((kept + 1))
    continue
  fi
  echo \"[remote:\$(hostname)] remove empty digest ref: \$ref\"
  sudo K3S_DATA_DIR=\"\${K3S_DATA_DIR}\" k3s ctr -n k8s.io images rm \"\$ref\" >/dev/null 2>&1 || true
  removed=\$((removed + 1))
done
if [ \"\$prune_dangling\" = \"true\" ]; then
  used_image_ids=\"\$(sudo K3S_DATA_DIR=\"\${K3S_DATA_DIR}\" k3s crictl ps -a 2>/dev/null | awk 'NR > 1 {print \$2}' | sort -u)\"
  sudo K3S_DATA_DIR=\"\${K3S_DATA_DIR}\" k3s crictl images 2>/dev/null | awk '\$1 == \"<none>\" && \$2 == \"<none>\" {print \$3}' | while read -r image_id; do
    [ -n \"\$image_id\" ] || continue
    if printf '%s\n' \"\$used_image_ids\" | grep -qx \"\$image_id\"; then
      echo \"[remote:\$(hostname)] keep dangling image used by container: \$image_id\"
      continue
    fi
    echo \"[remote:\$(hostname)] remove dangling image: \$image_id\"
    sudo K3S_DATA_DIR=\"\${K3S_DATA_DIR}\" k3s crictl rmi \"\$image_id\" >/dev/null 2>&1 || true
  done
fi
echo \"[remote:\$(hostname)] image prune completed\"
sudo K3S_DATA_DIR=\"\${K3S_DATA_DIR}\" k3s crictl images | awk 'NR==1 || /byclaw\\/byclaw-(be|super|fe|qa|data)/ || /<none>/'
"
}

prune_empty_images_all_cluster_nodes() {
    local host
    local repos_csv="${BYCLAW_K3S_PRUNE_IMAGE_REPOS:-}"
    if [ "${BYCLAW_K3S_PRUNE_EMPTY_IMAGES_ON_UPDATE}" != "true" ]; then
        echo "Image prune skipped: BYCLAW_K3S_PRUNE_EMPTY_IMAGES_ON_UPDATE=${BYCLAW_K3S_PRUNE_EMPTY_IMAGES_ON_UPDATE}"
        return 0
    fi
    if [ -z "$repos_csv" ]; then
        repos_csv="$(default_prune_image_repos)"
    fi
    if [ -z "$repos_csv" ]; then
        echo "Image prune skipped: no ByClaw image repositories configured"
        return 0
    fi
    log_step "Prune empty containerd image refs on all cluster nodes"
    echo "    repositories: $repos_csv"
    for host in "${SERVER_HOSTS[@]}" "${AGENT_HOSTS[@]}"; do
        [ -n "$host" ] || continue
        prune_empty_images_on_host "$host" "$repos_csv"
    done
}

ssh_base() {
    if [ -n "$K3S_PASSWORD" ]; then
        if ! command -v sshpass >/dev/null 2>&1; then
            echo "Error: sshpass is required when K3S_SSH_PASSWORD is configured." >&2
            exit 1
        fi
        sshpass -p "$K3S_PASSWORD" ssh \
            -o StrictHostKeyChecking=no \
            -p "$K3S_PORT" "$@"
    else
        ssh -o StrictHostKeyChecking=no \
            -p "$K3S_PORT" "$@"
    fi
}

ssh_run() {
    local host="$1"
    local script="$2"
    ssh_base "${K3S_USER}@${host}" "bash -s" <<EOF
$script
EOF
}

remote_hostname() {
    local host="$1"
    ssh_base "${K3S_USER}@${host}" "hostname"
}

cleanup_stale_node_install_processes() {
    local host="$1"
    if [ "$BYCLAW_K3S_CLEAN_STALE_PROCESSES" != "true" ]; then
        return 0
    fi
    log_step "Clean stale k3s install processes and /tmp artifacts on $host"
    ssh_run "$host" "set +e
pids=\$(pgrep -f '/tmp/k3s-install.*/k3s\\.bin|/tmp/k3s-install.*/k3s|/var/tmp/k3s-install.*/k3s|sh -s - server|sh -s - agent' || true)
if [ -n \"\$pids\" ]; then
  echo \"[remote:\$(hostname)] stale k3s install pids: \$pids\"
  for pid in \$pids; do [ \"\$pid\" = \"\$\$\" ] || kill -TERM \"\$pid\" 2>/dev/null || true; done
  sleep 2
  for pid in \$pids; do [ \"\$pid\" = \"\$\$\" ] || kill -KILL \"\$pid\" 2>/dev/null || true; done
else
  echo \"[remote:\$(hostname)] stale k3s install pids: none\"
fi
sleep 1
artifact_count=0
while IFS= read -r path; do
  [ -n \"\$path\" ] || continue
  echo \"[remote:\$(hostname)] remove stale install artifact: \$path\"
  rm -rf \"\$path\"
  artifact_count=\$((artifact_count + 1))
done < <(
  find /tmp /var/tmp -maxdepth 1 \\( \
    -type d -name 'k3s-install.*' -o \
    -type f \\( \
      -name 'k3s' -o \
      -name 'k3s.bin' -o \
      -name 'k3s.hash' -o \
      -name 'k3s-airgap-images*.tar' -o \
      -name 'k3s-airgap-images*.tar.gz' -o \
      -name 'k3s-airgap-images*.tar.zst' -o \
      -name 'k3s-images*.txt' \
    \\) \
  \\) -print 2>/dev/null
)
if [ \"\$artifact_count\" -eq 0 ]; then
  echo \"[remote:\$(hostname)] stale k3s install artifacts: none\"
else
  echo \"[remote:\$(hostname)] stale k3s install artifacts removed: \$artifact_count\"
fi"
}

k3s_service_status() {
    local host="$1"
    local service="$2"
    ssh_run "$host" "if sudo systemctl is-active --quiet '${service}'; then echo active; elif sudo systemctl list-unit-files '${service}.service' --no-legend 2>/dev/null | grep -q '^${service}\\.service'; then echo installed-inactive; else echo missing; fi"
}

ensure_reinstallable_state() {
    local host="$1"
    local role="$2"
    local service
    local status
    service="$(k3s_unit_name_for_host "$host" "$role")"
    status="$(k3s_service_status "$host" "$service" | tail -1)"
    if [ "$BYCLAW_K3S_FORCE_REINSTALL" = "true" ]; then
        log_step "Force reinstall requested on $host (${service} status=$status)"
        uninstall_all_k3s_on_host "$host"
        return 0
    fi
    case "$status" in
        active)
            echo "already-active"
            ;;
        installed-inactive)
            log_step "Found inactive/failed ${service} on $host; uninstalling partial install before retry"
            ssh_run "$host" "sudo systemctl status '${service}' --no-pager -l || true"
            uninstall_all_k3s_on_host "$host"
            ;;
        missing)
            if [ "$role" = "server" ]; then
                status="$(k3s_service_status "$host" "k3s" | tail -1)"
            else
                status="$(k3s_service_status "$host" "k3s-agent" | tail -1)"
            fi
            if [ "$status" != "missing" ]; then
                log_step "Found legacy k3s unit on $host; removing before install with custom node name"
                uninstall_all_k3s_on_host "$host"
            fi
            ;;
    esac
}

remote_k3s_install_verify_service() {
    local service="$1"
    cat <<VERIFY
_service_verified=false
for attempt in 1 2 3 4 5 6 7 8 9 10 11 12; do
  if sudo systemctl is-active --quiet '${service}'; then
    echo "[remote:\$(hostname)] ${service} is active (attempt \${attempt})"
    _service_verified=true
    break
  fi
  sleep 5
done
if [ "\$_service_verified" != "true" ]; then
  echo "[remote:\$(hostname)] ERROR: ${service} is not active after install" >&2
  sudo systemctl status '${service}' --no-pager -l >&2 || true
  sudo journalctl -u '${service}' -n 50 --no-pager >&2 || true
  exit 1
fi
VERIFY
}

common_prep() {
    cat <<PREP
set -euo pipefail
export LC_ALL=C LANG=C DEBIAN_FRONTEND=noninteractive
echo "[remote:\$(hostname)] prepare OS packages and kernel modules"
sudo swapoff -a || true
sudo mkdir -p '${K3S_DATA_DIR}' '${K3S_KUBELET_ROOT}' '${LONGHORN_DATA_PATH}'
sudo modprobe br_netfilter overlay 2>/dev/null || true
if command -v apt-get >/dev/null 2>&1; then
  echo "[remote:\$(hostname)] apt install prerequisites: curl open-iscsi nfs-common util-linux"
  sudo env LC_ALL=C LANG=C DEBIAN_FRONTEND=noninteractive apt-get update -y
  sudo env LC_ALL=C LANG=C DEBIAN_FRONTEND=noninteractive apt-get install -y curl open-iscsi nfs-common util-linux
  sudo systemctl enable --now iscsid 2>/dev/null || sudo systemctl enable --now open-iscsi 2>/dev/null || true
elif command -v yum >/dev/null 2>&1; then
  echo "[remote:\$(hostname)] yum install prerequisites: curl iscsi-initiator-utils nfs-utils util-linux"
  sudo env LC_ALL=C LANG=C yum install -y curl iscsi-initiator-utils nfs-utils util-linux
  sudo systemctl enable --now iscsid 2>/dev/null || true
elif command -v dnf >/dev/null 2>&1; then
  echo "[remote:\$(hostname)] dnf install prerequisites: curl iscsi-initiator-utils nfs-utils util-linux"
  sudo env LC_ALL=C LANG=C dnf install -y curl iscsi-initiator-utils nfs-utils util-linux
  sudo systemctl enable --now iscsid 2>/dev/null || true
fi
$(registry_prep)
PREP
}

install_first_server() {
    local host="$1"
    local pool
    local node_ip_args
    local tls_san_args
    pool="$(node_pool_for_host "$host")"
    node_ip_args="$(k3s_node_ip_args "$host")"
    tls_san_args="$(k3s_tls_san_args "$host")"
    if k3s_should_skip_install "$host" "server"; then
        log_step "Reuse active k3s server on $host"
        ssh_run "$host" "printf '__BYCLAW_K3S_TOKEN__'; sudo cat '${K3S_DATA_DIR}/server/node-token'; printf '\n'"
        return 0
    fi
    log_step "Install cluster-init server: host=$host node=$(k3s_custom_node_name "$host" server) pool=$pool node-ip=$(node_internal_ip_for_host "$host")"
    ssh_run "$host" "set -euo pipefail
if [ -d '${K3S_DATA_DIR}/server' ]; then
  echo '[remote:'\$(hostname)'] remove stale server data before cluster-init'
  sudo rm -rf '${K3S_DATA_DIR}'
fi
echo '[remote:'\$(hostname)'] run k3s server --cluster-init'
set -o pipefail
curl -sfL '${K3S_INSTALL_SCRIPT_URL}' | $(k3s_install_name_env_for_host "$host" server)$(k3s_install_env_prefix) K3S_TOKEN='${K3S_TOKEN:-}' sh -s - server \
  --cluster-init \
  ${tls_san_args} \
  $(k3s_advertise_address_args "$host") \
  $(k3s_node_name_args "$host" "server") \
  $(k3s_registry_install_args) \
  $(k3s_servicelb_install_args) \
  --data-dir '${K3S_DATA_DIR}' \
  --kubelet-arg=root-dir='${K3S_KUBELET_ROOT}' \
  --kubelet-arg=kube-reserved='${K3S_SERVER_KUBE_RESERVED}' \
  --kubelet-arg=system-reserved='${K3S_SERVER_SYSTEM_RESERVED}' \
  --kubelet-arg=eviction-hard='${K3S_EVICTION_HARD}' \
  --node-label byclaw.io/node-pool='${pool}' \
  --node-label byclaw.io/k3s-role=server \
  ${node_ip_args} \
  --write-kubeconfig-mode 600
$(remote_k3s_install_verify_service "$(k3s_unit_name_for_host "$host" server)")
if [ ! -s '${K3S_DATA_DIR}/server/node-token' ]; then
  echo '[remote:'\$(hostname)'] ERROR: missing node token after install' >&2
  exit 1
fi
echo '[remote:'\$(hostname)'] k3s server install completed; reading join token'
printf '__BYCLAW_K3S_TOKEN__'
sudo cat '${K3S_DATA_DIR}/server/node-token'
printf '\n'"
}

join_server() {
    local host="$1"
    local token="$2"
    local pool
    local node_ip_args
    local tls_san_args
    pool="$(node_pool_for_host "$host")"
    node_ip_args="$(k3s_node_ip_args "$host")"
    tls_san_args="$(k3s_tls_san_args "$host")"
    if k3s_should_skip_install "$host" "server"; then
        log_step "Reuse active k3s server on $host"
        return 0
    fi
    log_step "Join additional server: host=$host node=$(k3s_custom_node_name "$host" server) pool=$pool node-ip=$(node_internal_ip_for_host "$host")"
    ssh_run "$host" "set -euo pipefail
echo '[remote:'\$(hostname)'] run k3s server join'
set -o pipefail
curl -sfL '${K3S_INSTALL_SCRIPT_URL}' | $(k3s_install_name_env_for_host "$host" server)$(k3s_install_env_prefix) K3S_TOKEN='${token}' sh -s - server \
  --server '${K3S_JOIN_URL}' \
  --token '${token}' \
  ${tls_san_args} \
  $(k3s_advertise_address_args "$host") \
  $(k3s_node_name_args "$host" "server") \
  $(k3s_registry_install_args) \
  $(k3s_servicelb_install_args) \
  --data-dir '${K3S_DATA_DIR}' \
  --kubelet-arg=root-dir='${K3S_KUBELET_ROOT}' \
  --kubelet-arg=kube-reserved='${K3S_SERVER_KUBE_RESERVED}' \
  --kubelet-arg=system-reserved='${K3S_SERVER_SYSTEM_RESERVED}' \
  --kubelet-arg=eviction-hard='${K3S_EVICTION_HARD}' \
  --node-label byclaw.io/node-pool='${pool}' \
  --node-label byclaw.io/k3s-role=server \
  ${node_ip_args}
$(remote_k3s_install_verify_service "$(k3s_unit_name_for_host "$host" server)")
echo '[remote:'\$(hostname)'] k3s server join completed'"
}

join_agent() {
    local host="$1"
    local token="$2"
    local pool
    local node_ip_args
    pool="$(node_pool_for_host "$host")"
    node_ip_args="$(k3s_node_ip_args "$host")"
    if k3s_should_skip_install "$host" "agent"; then
        log_step "Reuse active k3s agent on $host"
        return 0
    fi
    log_step "Join agent: host=$host node=$(k3s_custom_node_name "$host" agent) pool=$pool node-ip=$(node_internal_ip_for_host "$host")"
    ssh_run "$host" "set -euo pipefail
echo '[remote:'\$(hostname)'] run k3s agent join'
set -o pipefail
curl -sfL '${K3S_INSTALL_SCRIPT_URL}' | $(k3s_install_name_env_for_host "$host" agent)$(k3s_install_env_prefix) K3S_TOKEN='${token}' sh -s - agent \
  --server '${K3S_JOIN_URL}' \
  --token '${token}' \
  $(k3s_node_name_args "$host" "agent") \
  $(k3s_registry_install_args) \
  --data-dir '${K3S_DATA_DIR}' \
  --kubelet-arg=root-dir='${K3S_KUBELET_ROOT}' \
  --kubelet-arg=kube-reserved='${K3S_AGENT_KUBE_RESERVED}' \
  --kubelet-arg=system-reserved='${K3S_AGENT_SYSTEM_RESERVED}' \
  --kubelet-arg=eviction-hard='${K3S_EVICTION_HARD}' \
  --node-label byclaw.io/node-pool='${pool}' \
  --node-label byclaw.io/k3s-role=agent \
  ${node_ip_args}
$(remote_k3s_install_verify_service "$(k3s_unit_name_for_host "$host" agent)")
echo '[remote:'\$(hostname)'] k3s agent join completed'"
}

kubectl_on_first() {
    local first="$1"
    local command="$2"
    # k3s kubectl defaults to /var/lib/rancher/k3s; honor custom --data-dir installs.
    # --request-timeout avoids hanging when the API server is still starting.
    ssh_run "$first" "sudo K3S_DATA_DIR='${K3S_DATA_DIR}' k3s kubectl --request-timeout=15s ${command}"
}

wait_for_k3s_service_active() {
    local host="$1"
    local service="${2:-k3s}"
    local attempt
    for attempt in $(seq 1 60); do
        if ssh_run "$host" "sudo systemctl is-active --quiet '${service}'"; then
            echo "    ${service} is active (attempt ${attempt}/60)" >&2
            return 0
        fi
        echo "    waiting for ${service} systemd unit... attempt ${attempt}/60" >&2
        sleep 5
    done
    echo "Error: ${service} did not become active on ${host} within 300s." >&2
    ssh_run "$host" "sudo systemctl status '${service}' --no-pager -l || true"
    return 1
}

wait_for_k3s_api_ready() {
    local first="$1"
    local attempt
    for attempt in $(seq 1 60); do
        if kubectl_on_first "$first" "get --raw='/readyz'" >/dev/null 2>&1; then
            echo "    k3s API /readyz ok (attempt ${attempt}/60)" >&2
            return 0
        fi
        echo "    waiting for k3s API /readyz... attempt ${attempt}/60" >&2
        sleep 5
    done
    echo "Error: k3s API did not become ready on ${first} within 300s." >&2
    ssh_run "$first" "sudo K3S_DATA_DIR='${K3S_DATA_DIR}' k3s kubectl --request-timeout=15s get nodes -o wide || true; sudo journalctl -u k3s -n 40 --no-pager || true"
    return 1
}

resolve_k3s_node_name() {
    local first="$1"
    local expected_name="$2"
    local hostname="$3"
    local internal_ip="$4"
    local nodes_wide
    local resolved

    if [ -n "$expected_name" ] \
        && kubectl_on_first "$first" "get node '${expected_name}' --no-headers" >/dev/null 2>&1; then
        printf '%s\n' "$expected_name"
        return 0
    fi
    if kubectl_on_first "$first" "get node '${hostname}' --no-headers" >/dev/null 2>&1; then
        printf '%s\n' "$hostname"
        return 0
    fi
    if [ -n "$internal_ip" ]; then
        nodes_wide="$(kubectl_on_first "$first" "get nodes -o wide --no-headers" 2>/dev/null || true)"
        resolved="$(printf '%s\n' "$nodes_wide" | awk -v ip="$internal_ip" '$6 == ip || $7 == ip { print $1; exit }')"
        if [ -n "$resolved" ]; then
            printf '%s\n' "$resolved"
            return 0
        fi
    fi
    return 1
}

wait_for_k3s_node_name() {
    local first="$1"
    local host="$2"
    local service="${3:-k3s}"
    local role="$4"
    local expected_name
    local hostname
    local internal_ip
    local node_name
    local attempt
    local nodes_wide

    expected_name="$(k3s_custom_node_name "$host" "$role")"
    hostname="$(remote_hostname "$host")"
    internal_ip="$(node_internal_ip_for_host "$host")"
    echo "    expected node name=${expected_name} (hostname=${hostname} internal_ip=${internal_ip:-<none>})" >&2

    wait_for_k3s_service_active "$host" "$service"
    wait_for_k3s_api_ready "$first"

    for attempt in $(seq 1 60); do
        if node_name="$(resolve_k3s_node_name "$first" "$expected_name" "$hostname" "$internal_ip")"; then
            echo "    node registered as ${node_name} (attempt ${attempt}/60)" >&2
            if [ "${K3S_CUSTOM_NODE_NAMES}" = "true" ] && [ "$node_name" != "$expected_name" ]; then
                echo "Warning: node registered as ${node_name}, expected ${expected_name}. Run with BYCLAW_K3S_FORCE_REINSTALL=true to recreate the cluster." >&2
            fi
            printf '%s\n' "$node_name"
            return 0
        fi
        nodes_wide="$(kubectl_on_first "$first" "get nodes -o wide --no-headers" 2>/dev/null || true)"
        if [ -n "$nodes_wide" ]; then
            echo "    cluster nodes now: $(printf '%s\n' "$nodes_wide" | awk '{print $1 "(" $6 ")"}' | paste -sd, -)" >&2
        else
            echo "    waiting for node registration... attempt ${attempt}/60" >&2
        fi
        sleep 5
    done
    echo "Error: k3s node for host $host not registered after 300s (expected=$expected_name hostname=$hostname internal_ip=${internal_ip:-<none>})." >&2
    kubectl_on_first "$first" "get nodes -o wide" || true
    ssh_run "$host" "sudo journalctl -u '$(k3s_unit_name_for_host "$host" "$role")' -n 40 --no-pager || true"
    return 1
}

wait_and_label_node() {
    local first="$1"
    local host="$2"
    local role="$3"
    local node_name
    local pool
    local service
    pool="$(node_pool_for_host "$host")"
    service="$(k3s_unit_name_for_host "$host" "$role")"
    log_step "Wait node registration: host=$host role=$role pool=$pool"
    node_name="$(wait_for_k3s_node_name "$first" "$host" "$service" "$role")"
    log_step "Wait node Ready and enforce labels: host=$host node=$node_name role=$role pool=$pool"
    kubectl_on_first "$first" "wait --for=condition=Ready node/${node_name} --timeout=300s"
    kubectl_on_first "$first" "label node '${node_name}' byclaw.io/node-pool='${pool}' byclaw.io/k3s-role='${role}' --overwrite"
    kubectl_on_first "$first" "get node '${node_name}' -o wide"
}

mapfile -t SERVER_HOSTS < <(split_csv "${K3S_SERVER_HOSTS:-}")
mapfile -t AGENT_HOSTS < <(split_csv "${K3S_AGENT_HOSTS:-}")

if [ "${#SERVER_HOSTS[@]}" -eq 0 ]; then
    echo "Error: K3S_SERVER_HOSTS must contain at least one server host." >&2
    exit 1
fi

FIRST="${SERVER_HOSTS[0]}"

validate_cluster_internal_network() {
    local host
    local first_internal

    if [ "${K3S_CLUSTER_INTERNAL_ONLY}" != "true" ]; then
        return 0
    fi

    for host in "${SERVER_HOSTS[@]}" "${AGENT_HOSTS[@]}"; do
        [ -n "$host" ] || continue
        if [ -z "$(node_internal_ip_for_host "$host")" ]; then
            echo "Error: K3S_CLUSTER_INTERNAL_ONLY=true requires K3S_NODE_INTERNAL_IPS for SSH host $host." >&2
            exit 1
        fi
    done

    first_internal="$(node_internal_ip_for_host "${SERVER_HOSTS[0]}")"
    K3S_JOIN_URL="https://${first_internal}:6443"

    if [ -n "${K3S_NODE_EXTERNAL_IPS:-}" ]; then
        echo "Warning: K3S_NODE_EXTERNAL_IPS is ignored when K3S_CLUSTER_INTERNAL_ONLY=true." >&2
    fi
}

validate_cluster_internal_network

if [ "$INSTALL_ACTION" = "registry-sync" ]; then
    echo "========== Sync k3s registry configuration =========="
    if [ -n "${K3S_PRIVATE_REGISTRIES:-}" ]; then
        echo "    private registries: $(printf '%s' "${K3S_PRIVATE_REGISTRIES}" | tr ',' '\n' | cut -d'|' -f1 | awk 'NR>1{printf ","} {printf "%s",$0}')"
    fi
    sync_registries_all_cluster_nodes
    echo "k3s registry sync completed."
    exit 0
fi
if [ "$INSTALL_ACTION" = "image-prune" ]; then
    echo "========== Prune k3s empty image refs =========="
    prune_empty_images_all_cluster_nodes
    echo "k3s empty image prune completed."
    exit 0
fi
if [ "$INSTALL_ACTION" != "install" ]; then
    echo "Error: unsupported install-k3s action '$INSTALL_ACTION'. Use install, registry-sync, or image-prune." >&2
    exit 1
fi

log_step "K3s cluster install plan"
echo "    cluster network: $([ "${K3S_CLUSTER_INTERNAL_ONLY}" = "true" ] && echo internal-only || echo mixed)"
echo "    install script: ${K3S_INSTALL_SCRIPT_URL}"
if [ -n "${K3S_INSTALL_MIRROR:-}" ]; then
    echo "    install mirror: ${K3S_INSTALL_MIRROR}"
fi
if registries_config_enabled; then
    echo "    registry docker.io mirror: ${K3S_REGISTRY_MIRROR_DOCKER:-<none>}"
    echo "    registry.k8s.io mirror: ${K3S_REGISTRY_MIRROR_K8S:-<none>}"
    echo "    disable default registry endpoint: ${K3S_DISABLE_DEFAULT_REGISTRY_ENDPOINT:-false}"
    if private_registries_enabled; then
        echo "    private registries: $(printf '%s' "${K3S_PRIVATE_REGISTRIES}" | tr ',' '\n' | cut -d'|' -f1 | awk 'NR>1{printf ","} {printf "%s",$0}')"
    fi
fi
echo "    join url: ${K3S_JOIN_URL}"
echo "    servicelb enabled: ${K3S_ENABLE_SERVICELB}"
echo "    custom node names: ${K3S_CUSTOM_NODE_NAMES}"
if [ "${K3S_CUSTOM_NODE_NAMES}" = "true" ]; then
    for host in "${SERVER_HOSTS[@]}"; do
        echo "    server ${host} -> $(k3s_custom_node_name "$host" server)"
    done
    for host in "${AGENT_HOSTS[@]}"; do
        echo "    agent ${host} -> $(k3s_custom_node_name "$host" agent)"
    done
fi
echo "    servers: ${SERVER_HOSTS[*]}"
echo "    agents: ${AGENT_HOSTS[*]:-<none>}"
echo "    internal IP map: ${K3S_NODE_INTERNAL_IPS:-<empty>}"
if [ "${K3S_CLUSTER_INTERNAL_ONLY}" != "true" ]; then
    echo "    external IP map: ${K3S_NODE_EXTERNAL_IPS:-<empty>}"
fi

prepare_all_cluster_nodes

TOKEN_FILE="$(mktemp)"
set +e
install_first_server "$FIRST" 2>&1 | while IFS= read -r line; do
    case "$line" in
        __BYCLAW_K3S_TOKEN__*)
            printf '%s\n' "${line#__BYCLAW_K3S_TOKEN__}" > "$TOKEN_FILE"
            echo "==> Captured k3s join token"
            ;;
        *)
            printf '%s\n' "$line"
            ;;
    esac
done
install_status="${PIPESTATUS[0]}"
set -e
if [ "$install_status" -ne 0 ]; then
    rm -f "$TOKEN_FILE"
    echo "Error: first k3s server install failed." >&2
    exit "$install_status"
fi
TOKEN="$(cat "$TOKEN_FILE")"
rm -f "$TOKEN_FILE"
if [ -z "$TOKEN" ]; then
    echo "Error: failed to capture k3s join token from first server." >&2
    exit 1
fi
echo "K3S_TOKEN captured for joining remaining nodes."

idx=0
for host in "${SERVER_HOSTS[@]}"; do
    if [ "$idx" -gt 0 ]; then
        join_server "$host" "$TOKEN"
    fi
    wait_and_label_node "$FIRST" "$host" "server"
    idx=$((idx + 1))
done

for host in "${AGENT_HOSTS[@]}"; do
    join_agent "$host" "$TOKEN"
    wait_and_label_node "$FIRST" "$host" "agent"
done

log_step "k3s HA install completed"
kubectl_on_first "$FIRST" "get nodes -o wide"
echo "==> Copy kubeconfig from ${FIRST}:${K3S_DATA_DIR}/server/kubeconfig or run deploy steps on ${FIRST}."
