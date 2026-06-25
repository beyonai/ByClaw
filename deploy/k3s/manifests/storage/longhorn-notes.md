# Longhorn 分布式存储（默认方案）

K3s 部署默认使用 Longhorn，不再依赖外部 NFS。

## 架构

- 3 节点 `/data/longhorn` NVMe 块副本（默认 3 副本）
- 沙箱工作区 PVC `byclaw-workspace`：`ReadWriteMany` + `storageClassName: longhorn`
- pip/FFmpeg 临时目录：BatchSandbox 模板 `emptyDir`（本地 NVMe），不经 Longhorn RWX 层

## 安装

```bash
# init 时自动执行（BYCLAW_K3S_INSTALL_LONGHORN=true）
./install-longhorn.sh env.k3s

# 或单独
K3S_ENV_FILE=deploy/k3s/env.k3s sh deploy/k3s/deploy.sh storage-init
```

## 环境变量（env.k3s）

| 变量 | 默认 | 说明 |
|------|------|------|
| `STORAGE_CLASS` | `longhorn` | PVC StorageClass |
| `LONGHORN_DATA_PATH` | `/data/longhorn` | 数据目录（勿用 40G 根分区） |
| `LONGHORN_VERSION` | `v1.6.2` | 安装版本 |
| `WORKSPACE_PVC_SIZE` | `500Gi` | 工作区 PVC 大小 |

## 运维

### 安装卡住时排查（在 k3s server 上）

```bash
export KUBECONFIG=/data/rancher/k3s/server/kubeconfig
# 或
alias kctl='sudo K3S_DATA_DIR=/data/rancher/k3s k3s kubectl'

kctl get pods -n longhorn-system -o wide
kctl get events -n longhorn-system --sort-by='.lastTimestamp' | tail -20
kctl logs -n longhorn-system -l app=longhorn-manager --tail=100
ps aux | grep install-longhorn
```

`install-longhorn.sh` 会先把 manifest 缓存到 `/tmp/byclaw-longhorn/`，再 `kubectl apply -f` 本地文件；也可在 `env.k3s` 设 `LONGHORN_MANIFEST_FILE=/tmp/longhorn.yaml`。

### UI

- UI：`kubectl -n longhorn-system port-forward svc/longhorn-frontend 8080:80`
- 卷详情：Longhorn UI → Volume → byclaw-workspace
- 节点预留：Settings 中 `storage-minimal-available-percentage=15`，与 k3s 镜像缓存预留一致

## RWX 说明

Longhorn RWX 通过 share-manager（NFS-ganesha）导出。极高频小文件写（如 pip 全量安装）仍应使用 `emptyDir` scratch，完成后同步到 `/by`。
