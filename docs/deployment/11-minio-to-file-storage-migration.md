# MinIO/rclone 到 Docker 文件型存储迁移指南

本文档用于把旧的 OpenClaw 运行态数据从 MinIO/rclone 挂载目录迁移到 Docker 场景下的文件型存储。目标存储可以是 NFSv4、SMB3、OpenMediaVault 共享目录，或 cephadm 部署的 CephFS。迁移保持容器内路径 `/by` 不变，也保持用户目录结构 `byclaw-${USER_CODE}/by` 不变。

迁移完成后，MinIO 继续作为对象存储和归档层；文件型存储承载 OpenClaw 运行态文件系统。

## 1. 迁移原则

- 按用户分批迁移，不建议一次迁全量。
- 迁移单个用户前先冻结或停止该用户 OpenClaw 沙箱，避免旧目录继续写入。
- 新旧数据至少保留一个灰度周期。
- 每个用户记录迁移时间、源 bucket、目标路径、对象数量、校验结果和回滚方式。

## 2. 目录规划

旧路径通常来自 MinIO/rclone：

```text
${FILE_STORAGE_MINIO_MOUNT_PATH}/byclaw-${USER_CODE}/by
```

新路径固定为文件型运行态卷：

```text
${BYCLAW_SANDBOX_FILE_VOLUME_ROOT}/byclaw-${USER_CODE}/by
```

推荐环境变量：

```bash
export BYCLAW_SANDBOX_FILE_VOLUME_ROOT=/mnt/byclaw-file
export USER_CODE=user001
```

创建目标目录：

```bash
sudo mkdir -p "${BYCLAW_SANDBOX_FILE_VOLUME_ROOT}/byclaw-${USER_CODE}/by"
sudo chown -R root:root "${BYCLAW_SANDBOX_FILE_VOLUME_ROOT}/byclaw-${USER_CODE}"
sudo chmod -R 755 "${BYCLAW_SANDBOX_FILE_VOLUME_ROOT}/byclaw-${USER_CODE}"
```

## 3. 迁移前检查

确认文件型存储已挂载：

```bash
findmnt "${BYCLAW_SANDBOX_FILE_VOLUME_ROOT}"
touch "${BYCLAW_SANDBOX_FILE_VOLUME_ROOT}/.migration-probe"
rm -f "${BYCLAW_SANDBOX_FILE_VOLUME_ROOT}/.migration-probe"
```

确认 MinIO 可访问：

```bash
mc alias set oldminio http://MINIO_HOST:MINIO_PORT ACCESS_KEY SECRET_KEY
mc ls oldminio
```

确认用户 bucket 或 prefix 存在：

```bash
mc ls "oldminio/byclaw-${USER_CODE}/by/"
```

## 4. 冻结用户沙箱

迁移前停止或冻结目标用户的 OpenClaw 沙箱。可以通过管理后台、openSandbox API 或运维脚本完成。核心要求是迁移窗口内该用户不再写旧 `/by`。

迁移前建议记录当前状态：

```bash
date -Is
mc du "oldminio/byclaw-${USER_CODE}/by/" || true
find "${BYCLAW_SANDBOX_FILE_VOLUME_ROOT}/byclaw-${USER_CODE}/by" -maxdepth 2 -type f | head
```

## 5. 执行迁移

推荐用 `mc mirror` 直接从 MinIO 同步到文件型存储：

```bash
mc mirror --overwrite \
  "oldminio/byclaw-${USER_CODE}/by" \
  "${BYCLAW_SANDBOX_FILE_VOLUME_ROOT}/byclaw-${USER_CODE}/by"
```

如果旧数据来源是 rclone 挂载目录，也可以用 `rsync`：

```bash
export FILE_STORAGE_MINIO_MOUNT_PATH=/data/8080
rsync -aH --info=progress2 \
  "${FILE_STORAGE_MINIO_MOUNT_PATH}/byclaw-${USER_CODE}/by/" \
  "${BYCLAW_SANDBOX_FILE_VOLUME_ROOT}/byclaw-${USER_CODE}/by/"
```

优先使用 `mc mirror`，因为它直接从对象存储读取，避免旧 rclone/FUSE 挂载状态影响迁移。

## 6. 校验

对象数量校验：

```bash
mc find "oldminio/byclaw-${USER_CODE}/by" --type f | wc -l
find "${BYCLAW_SANDBOX_FILE_VOLUME_ROOT}/byclaw-${USER_CODE}/by" -type f | wc -l
```

抽样校验：

```bash
find "${BYCLAW_SANDBOX_FILE_VOLUME_ROOT}/byclaw-${USER_CODE}/by" -type f | head -20
```

关键目录校验：

```bash
ls -la "${BYCLAW_SANDBOX_FILE_VOLUME_ROOT}/byclaw-${USER_CODE}/by/.openclaw" || true
ls -la "${BYCLAW_SANDBOX_FILE_VOLUME_ROOT}/byclaw-${USER_CODE}/by/.sessions" || true
ls -la "${BYCLAW_SANDBOX_FILE_VOLUME_ROOT}/byclaw-${USER_CODE}/by/output" || true
```

文件系统语义校验：

```bash
probe="${BYCLAW_SANDBOX_FILE_VOLUME_ROOT}/byclaw-${USER_CODE}/by/.migration-probe"
mkdir -p "$probe"
for i in $(seq 1 100); do
  echo "$i" > "$probe/file-$i.tmp"
  mv "$probe/file-$i.tmp" "$probe/file-$i.done"
done
rm -rf "$probe"
```

## 7. 切换配置

在 `.env` 中切换运行态卷：

```bash
FILE_STORAGE_TYPE=minio
FILE_STORAGE_MINIO_MOUNT_ENABLED=false

BYCLAW_SANDBOX_VOLUME_BACKEND=file
BYCLAW_SANDBOX_FILE_VOLUME_ROOT=/mnt/byclaw-file
BYCLAW_SANDBOX_FILE_VOLUME_TYPE=nfs
BYCLAW_SANDBOX_FILE_VOLUME_SNAPSHOT_PROVIDER=nas
```

如果使用 SMB，将 `BYCLAW_SANDBOX_FILE_VOLUME_TYPE` 改为 `smb`；如果使用 cephadm CephFS，改为 `cephfs`。

重生成 openSandbox 配置：

```bash
cd deploy/middleware
sh gen-opensandbox-config.sh
docker compose up -d opensandbox-server
```

重启 ByClaw 后端，让 `byclaw.sandbox.volume.*` 生效。

## 8. 灰度验证

拉起该用户 OpenClaw 沙箱，进入容器检查：

```bash
mount | grep ' /by '
df -h /by
ls -la /by
```

`/by` 不应出现 `rclone`、`s3fs`、`goofys`、`fuse`。

验证旧数据可见：

```bash
ls -la /by/.openclaw || true
ls -la /by/.sessions || true
ls -la /by/output || true
```

验证写入：

```bash
mkdir -p /by/.openclaw/migration-smoke
echo ok > /by/.openclaw/migration-smoke/probe.txt
mv /by/.openclaw/migration-smoke/probe.txt /by/.openclaw/migration-smoke/probe.done
cat /by/.openclaw/migration-smoke/probe.done
```

## 9. 回滚

灰度期不要删除旧 MinIO 数据。如果新路径异常：

1. 停止该用户新沙箱。
2. 将 `.env` 临时切回：

```bash
BYCLAW_SANDBOX_VOLUME_BACKEND=minio-mount
FILE_STORAGE_MINIO_MOUNT_ENABLED=true
FILE_STORAGE_MINIO_MOUNT_PATH=/data/8080
```

3. 重生成 openSandbox config 并重启。
4. 重新拉起该用户沙箱。

如果新文件型存储中已经产生增量文件，需要先反向归档：

```bash
mc mirror --overwrite \
  "${BYCLAW_SANDBOX_FILE_VOLUME_ROOT}/byclaw-${USER_CODE}/by" \
  "oldminio/byclaw-${USER_CODE}/by"
```

## 10. 批量迁移建议

建议顺序：

1. 测试用户。
2. 低活跃用户。
3. 高活跃用户。
4. 全量关闭 legacy rclone mount。

批量脚本示例：

```bash
#!/usr/bin/env bash
set -euo pipefail

export BYCLAW_SANDBOX_FILE_VOLUME_ROOT=/mnt/byclaw-file

while read -r USER_CODE; do
  [ -z "$USER_CODE" ] && continue
  echo "==> migrating $USER_CODE"
  mkdir -p "${BYCLAW_SANDBOX_FILE_VOLUME_ROOT}/byclaw-${USER_CODE}/by"
  mc mirror --overwrite \
    "oldminio/byclaw-${USER_CODE}/by" \
    "${BYCLAW_SANDBOX_FILE_VOLUME_ROOT}/byclaw-${USER_CODE}/by"
  echo "==> migrated $USER_CODE"
done < users.txt
```

`users.txt` 每行一个 `userCode`。

## 11. 迁移完成后的状态

最终推荐：

```bash
FILE_STORAGE_TYPE=minio
FILE_STORAGE_MINIO_MOUNT_ENABLED=false
BYCLAW_SANDBOX_VOLUME_BACKEND=file
BYCLAW_SANDBOX_FILE_VOLUME_ROOT=/mnt/byclaw-file
BYCLAW_SANDBOX_FILE_VOLUME_TYPE=nfs
```

保留 MinIO Console 给对象存储管理员使用；用户运行态文件浏览应通过 File Browser 或管理后台接入文件型运行态卷上的用户目录。
