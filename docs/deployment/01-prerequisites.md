# 前置条件

部署 ByClaw 之前，请确保您的环境满足以下条件。

## 1. 硬件要求

| 配置 | 最低要求 | 推荐配置 |
|------|---------|---------|
| CPU | 4 核 | 8 核或以上 |
| 内存 | 8 GB | 16 GB 或以上 |
| 磁盘 | 50 GB | 100 GB 或以上（SSD 推荐） |

## 2. 软件要求

### Docker

需要安装 Docker 和 Docker Compose V2。

#### 安装 Docker

**Linux (Ubuntu/Debian):**
```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
```

**macOS:**
使用 Docker Desktop for Mac：
- 下载地址：https://www.docker.com/products/docker-desktop

**Windows:**
使用 Docker Desktop for Windows：
- 下载地址：https://www.docker.com/products/docker-desktop

#### 验证 Docker 安装

```bash
docker --version
docker compose version
```

### 其他工具

- Git（可选，用于克隆代码仓库）
- 文本编辑器（用于修改配置文件）

## 3. GitHub Container Registry (GHCR) 认证

ByClaw 的镜像托管在 GitHub Container Registry (ghcr.io)，您需要配置访问凭证。

### 步骤 1：创建 GitHub Personal Access Token (PAT)

1. 访问 https://github.com/settings/tokens
2. 点击 "Generate new token" → "Generate new token (classic)"
3. 勾选以下权限：
   - `write:packages`
   - `read:packages`
   - `delete:packages`
4. 生成并保存您的 token（只显示一次！）

### 步骤 2：配置 .env 文件

复制项目根目录的 `.env.example` 为 `.env`：

```bash
cp .env.example .env
```

编辑 `.env` 文件，填入您的 GitHub 信息：

```bash
# GHCR (GitHub Container Registry)
GHCR_USER=your_github_username
GHCR_TOKEN=your_ghcr_personal_access_token
```

### 步骤 3：登录 GHCR

部署脚本会自动使用 `.env` 中的凭证登录，但您也可以手动测试：

```bash
echo "your_ghcr_personal_access_token" | docker login ghcr.io -u "your_github_username" --password-stdin
```

## 4. 网络要求

- 能够访问 GitHub Container Registry (ghcr.io)
- 如果是国内环境，可能需要配置镜像加速器

## 5. rclone（MinIO 文件挂载）

ByClaw 使用 [rclone](https://rclone.org/) 将 MinIO 对象存储桶以 FUSE 文件系统的方式挂载到宿主机。这样数字员工的沙箱环境可以像访问本地目录一样读写 MinIO 中的文件，无需通过 S3 API 中转。

> **注意：** rclone 需要安装在**目标宿主机**上（即 `FILE_STORAGE_MINIO_MOUNT_TARGET_*_HOST` 指向的机器），而不是运行 ByClaw 后端的机器。后端通过 SSH 远程执行 rclone 命令。

### 为什么需要 rclone

- 沙箱环境需要以本地文件路径访问用户上传的文件和知识库数据
- rclone mount 将 MinIO bucket 映射为本地目录，对应用层完全透明
- 支持自动恢复断开的挂载点（Transport endpoint is not connected）

### 安装 rclone

在**每台目标宿主机**上安装：

**Linux（推荐）：**
```bash
# 官方一键安装脚本
curl https://rclone.org/install.sh | sudo bash

# 或使用包管理器
# Debian/Ubuntu
sudo apt install rclone

# CentOS/RHEL
sudo yum install rclone
```

**macOS：**
```bash
brew install rclone
```

### 验证安装

```bash
rclone version
# 应输出 rclone v1.60+ 版本信息
```

### 额外依赖

rclone mount 依赖 FUSE，请确保目标宿主机已安装：

```bash
# Debian/Ubuntu
sudo apt install fuse3

# CentOS/RHEL
sudo yum install fuse3

# 验证
fusermount3 --version
```

### 配置说明

rclone 本身**不需要配置文件**。ByClaw 后端在执行挂载时会通过命令行参数直接传入 MinIO 的 endpoint、access key 和 secret key。

您只需在 `.env` 中配置以下变量：

```bash
# 启用 MinIO 挂载功能
FILE_STORAGE_MINIO_MOUNT_ENABLED=true

# 挂载基础路径（bucket 会挂载到该路径下的子目录）
FILE_STORAGE_MINIO_MOUNT_PATH=/data/8080

# 目标宿主机 SSH 连接信息（支持多台，索引从 0 开始）
FILE_STORAGE_MINIO_MOUNT_TARGET_0_HOST=192.168.1.100
FILE_STORAGE_MINIO_MOUNT_TARGET_0_PORT=22
FILE_STORAGE_MINIO_MOUNT_TARGET_0_USER=root
FILE_STORAGE_MINIO_MOUNT_TARGET_0_PASSWORD=your_password
FILE_STORAGE_MINIO_MOUNT_TARGET_0_ENABLED=true
```

如果不需要文件挂载功能，设置 `FILE_STORAGE_MINIO_MOUNT_ENABLED=false` 即可跳过。

## 6. ⚠️ 重要：数据目录准备（必须）

在部署之前，**必须**提前准备好 MinIO 挂载目录，否则容器可能无法正常启动！

根据您的 `.env` 配置中的 `FILE_STORAGE_MINIO_MOUNT_PATH` 创建目录：

```bash
# 创建目录（请根据您的实际路径修改）
sudo mkdir -p /data/8080

# 设置正确的权限（容器内用户需要读写权限）
sudo chmod -R 755 /data/8080
sudo chown -R root:root /data/8080

# ⚠️ 重要提示：
# 1. 如果该路径是网络挂载点（NFS/SMB等），请确保：
#    - 挂载点已经正确挂载
#    - 权限设置正确
#    - 不会出现 "Transport endpoint is not connected" 错误
# 2. 如果不需要挂载功能，可以在 .env 中设置：
#    FILE_STORAGE_MINIO_MOUNT_ENABLED=false
```

### 验证目录

创建完成后，验证目录是否正常：

```bash
# 检查 MinIO 目录
ls -la /data/8080
# 应该能看到正常的目录列表，没有 "d?????????" 或权限错误
```

### 常见问题

**问题：** `ls: cannot access 'xxx': Transport endpoint is not connected`

**解决方法：**
1. 检查挂载点是否正常
```bash
mount | grep /data/8080
```

2. 如果挂载异常，先卸载再重新挂载
```bash
sudo umount /data/8080
# 然后重新挂载
```

3. 如果不需要挂载，直接使用本地目录，并在 `.env` 中禁用挂载功能

---

**下一步：** 阅读 [镜像拉取指南](./02-image-pull.md) 来获取所需的 Docker 镜像。
