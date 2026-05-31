# Docker 文件型运行态存储部署指南

本文档用于在纯 Docker 场景下，把 OpenClaw 容器运行态目录 `/by` 从 MinIO/rclone 挂载切换到真实文件系统。ByClaw 后端、OpenSandbox、Redis、MinIO、OpenGauss 仍按 Docker 部署；文件型存储由 NFS/SMB/OpenMediaVault 或 cephadm 管理的 CephFS 提供。

MinIO 继续保留为对象存储、归档、共享和备份目标，不再作为 OpenClaw 的运行态文件系统。

## 1. 推荐拓扑

```text
文件存储服务器
  OpenMediaVault / Linux NFS server / Samba / CephFS(cephadm)
  export: /exports/byclaw
        |
        | NFSv4 / SMB3 / CephFS
        v
OpenSandbox Docker Host A/B/C
  mount -> /mnt/byclaw-file
    byclaw-${USER_CODE}/by
        |
        | docker bind mount
        v
OpenClaw container
  /by
```

所有 openSandbox Docker 节点必须把同一套远端文件系统挂到同一个本地路径，推荐固定为 `/mnt/byclaw-file`。

## 2. 技术选型

| 场景 | 推荐技术 | 说明 |
|------|----------|------|
| 最快落地、单文件服务器 | NFSv4 | Linux 原生、Docker 宿主机挂载简单，推荐作为首选测试路线。 |
| 有 Web 管理面 | OpenMediaVault + NFS/SMB | 适合想通过 UI 管理共享目录、权限、磁盘和快照的环境。 |
| Windows 文件共享环境 | Samba/SMB3 | 适合已有 Windows/SMB NAS 的环境。 |
| 长期分布式文件系统 | CephFS via cephadm | 不需要 Kubernetes/Rook，但部署和运维复杂度明显更高。 |

没有 Kubernetes/K3s 时不要使用 Rook-Ceph。Rook 是 Kubernetes Operator，不适合纯 Docker 环境。

## 3. NFSv4 快速部署

以下示例使用一台 Linux 文件服务器导出 `/exports/byclaw`。

### 3.1 文件服务器

```bash
sudo apt-get update
sudo apt-get install -y nfs-kernel-server

sudo mkdir -p /exports/byclaw
sudo chown -R root:root /exports/byclaw
sudo chmod -R 755 /exports/byclaw
```

编辑 `/etc/exports`：

```text
/exports/byclaw  *(rw,sync,no_subtree_check,no_root_squash)
```

生产环境不要直接使用 `*`，应限制为 openSandbox Docker 宿主机网段，例如 `10.0.0.0/24`。

生效：

```bash
sudo exportfs -rav
sudo systemctl enable --now nfs-server
sudo exportfs -v
```

### 3.2 OpenSandbox Docker 宿主机

每台 openSandbox Docker 宿主机都执行：

```bash
sudo apt-get update
sudo apt-get install -y nfs-common

sudo mkdir -p /mnt/byclaw-file
sudo mount -t nfs4 STORAGE_SERVER:/exports/byclaw /mnt/byclaw-file \
  -o rw,noatime,nconnect=4
```

验证：

```bash
findmnt /mnt/byclaw-file
touch /mnt/byclaw-file/.probe-$(hostname)
ls -la /mnt/byclaw-file
```

写入 `/etc/fstab`：

```text
STORAGE_SERVER:/exports/byclaw /mnt/byclaw-file nfs4 rw,noatime,nconnect=4,_netdev 0 0
```

## 4. OpenMediaVault 路线

如果你希望通过 UI 管理文件服务，可以部署 OpenMediaVault：

1. 在独立存储服务器安装 OpenMediaVault。
2. 创建文件系统和共享目录，例如 `/exports/byclaw`。
3. 启用 NFS 服务，导出共享目录给 openSandbox Docker 宿主机网段。
4. 在每台 openSandbox 宿主机按 NFSv4 客户端步骤挂载到 `/mnt/byclaw-file`。
5. 在 OMV UI 中配置快照、备份和容量告警。

ByClaw 侧配置与 NFSv4 快速部署相同。

## 5. SMB3 路线

如果使用 SMB/NAS：

```bash
sudo apt-get install -y cifs-utils
sudo mkdir -p /mnt/byclaw-file
```

创建凭据文件 `/etc/byclaw-smb.creds`：

```text
username=YOUR_USER
password=YOUR_PASSWORD
domain=WORKGROUP
```

```bash
sudo chmod 600 /etc/byclaw-smb.creds
sudo mount -t cifs //SMB_SERVER/byclaw /mnt/byclaw-file \
  -o credentials=/etc/byclaw-smb.creds,vers=3.0,iocharset=utf8,uid=0,gid=0,file_mode=0755,dir_mode=0755,_netdev
```

写入 `/etc/fstab`：

```text
//SMB_SERVER/byclaw /mnt/byclaw-file cifs credentials=/etc/byclaw-smb.creds,vers=3.0,iocharset=utf8,uid=0,gid=0,file_mode=0755,dir_mode=0755,_netdev 0 0
```

## 6. CephFS 非 Rook 路线

纯 Docker 环境如果确实需要 CephFS，应使用 cephadm 部署 Ceph 集群，而不是 Rook-Ceph。cephadm 会用容器运行 Ceph 服务，但不依赖 Kubernetes。

高层步骤：

1. 准备至少 3 台存储节点和裸盘。
2. 安装 cephadm 并 bootstrap Ceph 集群。
3. 添加 host 和 OSD。
4. 创建 CephFS。
5. 在每台 openSandbox Docker 宿主机安装 `ceph-common`。
6. 挂载 CephFS 到 `/mnt/byclaw-file`。

示例挂载：

```bash
sudo apt-get install -y ceph-common
sudo mkdir -p /mnt/byclaw-file
sudo mount -t ceph MON1,MON2,MON3:/ /mnt/byclaw-file \
  -o name=byclaw,secretfile=/etc/ceph/byclaw.key,_netdev,noatime
```

CephFS 适合长期分布式生产，但部署复杂度高。初次全流程测试建议先用 NFSv4 或 OpenMediaVault。

## 7. 配置 ByClaw

`.env` 推荐配置：

```bash
FILE_STORAGE_TYPE=minio
FILE_STORAGE_LOCAL_PATH=/mnt/byclaw-file
FILE_STORAGE_MINIO_MOUNT_ENABLED=false

BYCLAW_SANDBOX_VOLUME_BACKEND=file
BYCLAW_SANDBOX_FILE_VOLUME_ROOT=/mnt/byclaw-file
BYCLAW_SANDBOX_FILE_VOLUME_TYPE=nfs
BYCLAW_SANDBOX_FILE_VOLUME_SNAPSHOT_PROVIDER=nas
BYCLAW_SANDBOX_FILE_BROWSER_ENABLED=false
```

一键部署通过 `.env` 切换存储方案，`deploy.sh` 只负责 init/update 阶段：

```bash
cp .env.example .env

# .env
BYCLAW_DEPLOY_STORAGE=nfs

# 首次部署
sh deploy.sh init

# 增量更新
sh deploy.sh update
```

`BYCLAW_DEPLOY_STORAGE=nfs` 会自动设置 `FILE_STORAGE_TYPE=file`、`BYCLAW_SANDBOX_VOLUME_BACKEND=file`、`BYCLAW_SANDBOX_FILE_VOLUME_TYPE=nfs`，并在未显式设置 `MIDDLEWARE_MODULES` 时跳过 MinIO 中间件。若 NFS 模式下仍要启动 MinIO：

```bash
BYCLAW_DEPLOY_START_MINIO=true
```

如果部署机可以 SSH 到 NFS Server 和 Docker/openSandbox 宿主机，可以让脚本先初始化 NFS：

```bash
BYCLAW_NFS_SERVER_HOST=10.0.0.10
BYCLAW_NFS_CLIENT_HOSTS=10.0.0.20,10.0.0.21
BYCLAW_DEPLOY_INIT_NFS=true
sh deploy.sh init
```

`BYCLAW_DEPLOY_INIT_NFS=true` 只在 `sh deploy.sh init` 阶段生效：脚本会在 NFS Server 上安装并配置 NFS export，在每台 client 上安装 NFS client、挂载到 `${BYCLAW_SANDBOX_FILE_VOLUME_ROOT:-/mnt/byclaw-file}`、写入 `/etc/fstab`，并执行 `findmnt` 和 `touch` 探针。

对应 `.env` 参数：

```bash
BYCLAW_DEPLOY_INIT_NFS=false
BYCLAW_NFS_SERVER_HOST=10.0.0.10
BYCLAW_NFS_SERVER_PORT=22
BYCLAW_NFS_SERVER_USER=root
BYCLAW_NFS_SERVER_PASSWORD=
BYCLAW_NFS_EXPORT_PATH=/exports/byclaw
BYCLAW_NFS_EXPORT_CLIENTS=*
BYCLAW_NFS_CLIENT_HOSTS=10.0.0.20,10.0.0.21
BYCLAW_NFS_CLIENT_PORT=22
BYCLAW_NFS_CLIENT_USER=root
BYCLAW_NFS_CLIENT_PASSWORD=
BYCLAW_NFS_MOUNT_OPTIONS=rw,hard,noatime,nconnect=4,_netdev
```

如果使用 SMB：

```bash
BYCLAW_SANDBOX_FILE_VOLUME_TYPE=smb
```

如果使用 cephadm CephFS：

```bash
BYCLAW_SANDBOX_FILE_VOLUME_TYPE=cephfs
BYCLAW_SANDBOX_FILE_VOLUME_SNAPSHOT_PROVIDER=ceph
```

### 7.1 上传接口如何切换

`BYCLAW_SANDBOX_VOLUME_BACKEND=file` 只控制 OpenClaw 容器内 `/by` 的运行态卷来源，不强制改变上传接口。

推荐先使用混合模式：

```bash
FILE_STORAGE_TYPE=minio
BYCLAW_SANDBOX_VOLUME_BACKEND=file
```

这种模式下，历史上传、下载、预览、共享继续走 MinIO；OpenClaw `/by` 走 NFS/SMB/CephFS，避免 rclone/FUSE 运行态问题。

如果需要把上传接口也切到服务器文件型存储，改为：

```bash
FILE_STORAGE_TYPE=file
FILE_STORAGE_LOCAL_PATH=/mnt/byclaw-file
BYCLAW_SANDBOX_VOLUME_BACKEND=file
```

后端会把 `file` 作为本地挂载文件系统的配置别名，复用现有 `LocalStorageService`、`FileIngressService` 和 `ObjectStorageRouter` 接入层。业务上传 Controller 不需要区分 MinIO 或文件系统；通过配置即可切换。若希望上传对象与 OpenClaw 运行目录隔离，可把 `FILE_STORAGE_LOCAL_PATH` 指向 `/mnt/byclaw-file-object`，但需要额外挂载并规划备份。

注意：`FILE_STORAGE_TYPE` 会同时影响上传和后续下载/预览读取。切到 `file` 前，请先把需要继续访问的 MinIO 对象迁移到 `FILE_STORAGE_LOCAL_PATH` 对应目录，或者在灰度期保持 `FILE_STORAGE_TYPE=minio`。

### 7.2 BE 配置如何真正使用 NFS

ByClaw BE 不执行 `mount -t nfs4`。NFS 必须先由操作系统挂载到 openSandbox Docker 宿主机的 `/mnt/byclaw-file`，BE 通过下面两组配置使用它：

```bash
# OpenClaw /by 运行态卷使用 NFS
BYCLAW_SANDBOX_VOLUME_BACKEND=file
BYCLAW_SANDBOX_FILE_VOLUME_ROOT=/mnt/byclaw-file
BYCLAW_SANDBOX_FILE_VOLUME_TYPE=nfs
FILE_STORAGE_MINIO_MOUNT_ENABLED=false

# BE 上传、下载、UserFS/ResourceFS CRUD 也使用 NFS
FILE_STORAGE_TYPE=file
FILE_STORAGE_LOCAL_PATH=/mnt/byclaw-file
```

如果只设置 `BYCLAW_SANDBOX_VOLUME_BACKEND=file`，只有 OpenClaw 容器 `/by` 切到 NFS；BE 的上传、下载、文件列表、UserFS CRUD 仍由 `FILE_STORAGE_TYPE` 决定。

如果 BE 运行在 Docker 容器中，BE 容器也必须挂载同一个宿主机路径，否则用户目录 provisioning 和文件 CRUD 访问不到 NFS：

```yaml
services:
  be:
    volumes:
      - ${BYCLAW_SANDBOX_FILE_VOLUME_ROOT:-/mnt/byclaw-file}:${BYCLAW_SANDBOX_FILE_VOLUME_ROOT:-/mnt/byclaw-file}
```

命令行参数等价写法：

```bash
java -jar byclaw-be.jar \
  --byclaw.sandbox.volume.backend=file \
  --byclaw.sandbox.volume.file-root=/mnt/byclaw-file \
  --byclaw.sandbox.volume.file-type=nfs \
  --file.storage.minio.mount.enabled=false \
  --file.storage.type=file \
  --file.storage.local.path=/mnt/byclaw-file
```

### 7.3 用户 private 目录是否自动创建

BE 进程启动时不会为所有历史用户批量创建 NFS private 目录。新增或注册用户时，`UserBucketProvisioningService` 会沿用 MinIO 时代的用户空间初始化链路：

- `FILE_STORAGE_TYPE=minio`：创建用户 bucket。
- `FILE_STORAGE_TYPE=file` 或 `local`：创建 `/mnt/byclaw-file/byclaw-${USER_CODE}/by`。

历史用户迁移或手工补偿时，可以显式准备：

```bash
export USER_CODE=user001
sudo mkdir -p "/mnt/byclaw-file/byclaw-${USER_CODE}/by"
sudo chown -R root:root "/mnt/byclaw-file/byclaw-${USER_CODE}"
sudo chmod -R 755 "/mnt/byclaw-file/byclaw-${USER_CODE}"
```

目录创建边界：

| 时机 | 当前行为 |
|------|----------|
| BE 启动 | 只校验 `byclaw.sandbox.volume.*`，不批量创建所有历史用户目录 |
| 新增/注册用户 | `file/local` 创建 `byclaw-${USER_CODE}/by`；`minio` 创建用户 bucket |
| 数据迁移 | 迁移脚本应创建 `/mnt/byclaw-file/byclaw-${USER_CODE}/by` |
| 启动沙箱 | bind 源路径由 openSandbox 服务端解释；是否自动 `mkdir -p` 取决于 openSandbox 镜像实现 |
| BE CRUD 写文件且 `FILE_STORAGE_TYPE=file` | `LocalStorageService.put` 会创建目标文件的父目录 |

### 7.4 既有文件系统 CRUD 接口兼容性

既有文件系统 CRUD 通过 `UserFS`、`ResourceFS`、`ObjectStorageRouter` 进入底层存储。`FILE_STORAGE_TYPE=file` 会路由到服务器挂载文件系统实现。

| 能力 | `FILE_STORAGE_TYPE=minio` | `FILE_STORAGE_TYPE=file` |
|------|---------------------------|---------------------------|
| 上传/下载/预览接口 | 读写 MinIO | 读写 `FILE_STORAGE_LOCAL_PATH` |
| `UserFS.write/read/list/delete` | 读写用户 MinIO bucket | 读写 NFS 用户目录 |
| `ResourceFS.write/read/list/delete` | 读写 MinIO 公共资源 bucket | 读写文件型公共资源目录 |
| OpenClaw 容器生成文件 | 若 `BYCLAW_SANDBOX_VOLUME_BACKEND=file`，写入 NFS `/by` | 写入 NFS `/by` |
| 文件列表接口 | 看 MinIO，不会自动看到 NFS 新产物 | 看 NFS，可看到 OpenClaw 写入 `/by` 的文件 |

路径映射示例：

```text
UserFS 外部路径: /.sessions/10014538/result.txt
UserFS 内部路径: /by/.sessions/10014538/result.txt
NFS 宿主机路径: /mnt/byclaw-file/byclaw-user001/by/.sessions/10014538/result.txt
A 服务器实际路径: /exports/byclaw/byclaw-user001/by/.sessions/10014538/result.txt
```

## 8. 启动 OpenSandbox

生成 openSandbox 配置：

```bash
cd deploy/middleware
sh gen-opensandbox-config.sh
cat opensandbox-server.toml
```

确认包含：

```toml
[docker.private_volume]
backend = "file"
file_root = "/mnt/byclaw-file"
file_type = "nfs"
```

启动：

```bash
docker compose up -d opensandbox-server
docker compose logs -f opensandbox-server
```

`deploy/middleware/docker-compose.yml` 会把 `${BYCLAW_SANDBOX_FILE_VOLUME_ROOT}` 挂到 opensandbox-server 容器内。最终 OpenClaw 容器是否真正使用该路径，还取决于 openSandbox server 镜像是否支持 `[docker.private_volume]` 配置。

## 9. 验证 OpenClaw `/by`

拉起测试用户沙箱后，在 OpenClaw 容器内执行：

```bash
mount | grep ' /by '
df -h /by
```

结果不应出现 `rclone`、`s3fs`、`goofys`、`fuse`。

运行文件系统语义测试：

```bash
mkdir -p /by/.openclaw/fs-probe /by/tmp /by/output
python3 - <<'PY'
from pathlib import Path
root = Path('/by/.openclaw/fs-probe')
for i in range(100):
    p = root / f'f-{i}.txt'
    p.write_text('hello')
    p.rename(root / f'f-{i}.renamed')
(root / 'wal-test.db').write_bytes(b'probe')
print('ok')
PY
```

在宿主机确认文件落到文件型存储：

```bash
find /mnt/byclaw-file -path '*fs-probe*' -maxdepth 6
```

## 10. 常见问题

### `/by` 仍然是 rclone/FUSE

检查：

```bash
grep BYCLAW_SANDBOX_VOLUME_BACKEND ../../.env
grep FILE_STORAGE_MINIO_MOUNT_ENABLED ../../.env
cat deploy/middleware/opensandbox-server.toml
```

期望：

```text
BYCLAW_SANDBOX_VOLUME_BACKEND=file
FILE_STORAGE_MINIO_MOUNT_ENABLED=false
```

### openSandbox 看不到 `/mnt/byclaw-file`

确认宿主机已挂载：

```bash
findmnt /mnt/byclaw-file
```

确认 compose 已挂载给 opensandbox-server：

```bash
docker inspect byclaw-opensandbox-middleware | grep -A5 /mnt/byclaw-file
```

### NFS 写入权限异常

检查 NFS export 是否允许 openSandbox 宿主机写入，测试环境可用 `no_root_squash`，生产环境应结合固定 UID/GID 和最小权限配置。
