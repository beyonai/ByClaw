# 镜像拉取指南

本文档列出了 ByClaw 项目使用的所有 Docker 镜像地址，并提供了拉取镜像的详细步骤。

## 镜像分类

### 1. 外网镜像（GitHub Container Registry）

| 镜像名称 | 镜像地址 | 用途 |
|---------|---------|------|
| Redis | `ghcr.io/beyonai/byclaw/byclaw-redis:main` | 缓存服务 |
| MinIO | `ghcr.io/beyonai/byclaw/byclaw-minio:main` | 对象存储 |
| OpenGauss | `ghcr.io/beyonai/byclaw/byclaw-opengauss:main` | 关系型数据库 |
| FE | `ghcr.io/beyonai/byclaw/byclaw-fe:main` | 前端服务 |
| BE | `ghcr.io/beyonai/byclaw/byclaw-be:main` | 后端服务 |
| QA | `ghcr.io/beyonai/byclaw/byclaw-qa:main` | 问答服务 |
| Data | `ghcr.io/beyonai/byclaw/byclaw-data:main` | DataCloud 服务 |
| ByClaw All-in-One | `ghcr.io/beyonai/byclaw/byclaw-all:main` | 包含所有服务的单体镜像 |

### 2. 其他外网镜像

| 镜像名称 | 镜像地址 | 用途 |
|---------|---------|------|
| OpenSandbox | `sandbox-registry.cn-zhangjiakou.cr.aliyuncs.com/opensandbox/server:v0.1.9` | 代码沙箱服务 |

### 3. 公司地址（内部镜像）

> ⚠️ **当前方案：** 由于网络限制，公司内部环境暂时需要手工打 tar 包的方式获取镜像。

**操作步骤：**

1. **在外网环境拉取镜像**：
   ```bash
   # 登录 GHCR
   echo "your_ghcr_token" | docker login ghcr.io -u "your_github_username" --password-stdin
   
   # 拉取所有镜像
   docker pull ghcr.io/beyonai/byclaw/byclaw-redis:main
   docker pull ghcr.io/beyonai/byclaw/byclaw-minio:main
   docker pull ghcr.io/beyonai/byclaw/byclaw-opengauss:main
   docker pull ghcr.io/beyonai/byclaw/byclaw-fe:main
   docker pull ghcr.io/beyonai/byclaw/byclaw-be:main
   docker pull ghcr.io/beyonai/byclaw/byclaw-qa:main
   docker pull ghcr.io/beyonai/byclaw/byclaw-data:main
   docker pull ghcr.io/beyonai/byclaw/byclaw-all:main
   docker pull sandbox-registry.cn-zhangjiakou.cr.aliyuncs.com/opensandbox/server:v0.1.9
   ```

2. **保存为 tar 包**：
   ```bash
   # 保存单个镜像
   docker save -o byclaw-redis.tar ghcr.io/beyonai/byclaw/byclaw-redis:main
   
   # 批量保存所有镜像
   mkdir -p byclaw-images
   for image in \
       ghcr.io/beyonai/byclaw/byclaw-redis:main \
       ghcr.io/beyonai/byclaw/byclaw-minio:main \
       ghcr.io/beyonai/byclaw/byclaw-opengauss:main \
       ghcr.io/beyonai/byclaw/byclaw-fe:main \
       ghcr.io/beyonai/byclaw/byclaw-be:main \
       ghcr.io/beyonai/byclaw/byclaw-qa:main \
       ghcr.io/beyonai/byclaw/byclaw-data:main \
       ghcr.io/beyonai/byclaw/byclaw-all:main \
       sandbox-registry.cn-zhangjiakou.cr.aliyuncs.com/opensandbox/server:v0.1.9
   do
       filename=$(echo $image | sed 's/\//_/g' | sed 's/:/-/g').tar
       echo "Saving $image to $filename..."
       docker save -o "byclaw-images/$filename" $image
   done
   
   # 压缩打包
   tar -czf byclaw-images.tar.gz byclaw-images/
   ```

3. **传输到公司内部环境**：
   - 使用 USB 或其他安全的传输方式将 `byclaw-images.tar.gz` 传输到公司内部环境

4. **在公司内部环境加载镜像**：
   ```bash
   # 解压
   tar -xzf byclaw-images.tar.gz
   
   # 加载所有镜像
   cd byclaw-images
   for file in *.tar; do
       echo "Loading $file..."
       docker load -i $file
   done
   ```

## 拉取镜像的方法

### 方法 1：使用项目提供的脚本（外网环境，推荐）

项目已经提供了自动化的拉取脚本，您可以直接使用：

```bash
# 拉取中间件镜像
cd deploy/middleware
sh pull.sh

# 拉取单体模式镜像
cd ../mono
sh pull.sh

# 拉取拆分模式镜像
cd ../standalone
sh pull.sh
```

### 方法 2：手动拉取（外网环境）

如果需要手动拉取某个特定的镜像：

1. **登录 GHCR**：

```bash
# 使用您的 GitHub Personal Access Token
echo "your_ghcr_token" | docker login ghcr.io -u "your_github_username" --password-stdin
```

2. **拉取镜像**：

```bash
# 拉取单个镜像
docker pull ghcr.io/beyonai/byclaw/byclaw-redis:main

# 拉取所有中间件镜像
docker pull ghcr.io/beyonai/byclaw/byclaw-redis:main
docker pull ghcr.io/beyonai/byclaw/byclaw-minio:main
docker pull ghcr.io/beyonai/byclaw/byclaw-opengauss:main
docker pull sandbox-registry.cn-zhangjiakou.cr.aliyuncs.com/opensandbox/server:v0.1.9

# 拉取所有应用镜像（拆分模式）
docker pull ghcr.io/beyonai/byclaw/byclaw-fe:main
docker pull ghcr.io/beyonai/byclaw/byclaw-be:main
docker pull ghcr.io/beyonai/byclaw/byclaw-qa:main
docker pull ghcr.io/beyonai/byclaw/byclaw-data:main

# 拉取单体模式镜像
docker pull ghcr.io/beyonai/byclaw/byclaw-all:main
```

### 方法 3：批量拉取脚本（外网环境）

您也可以创建一个简单的脚本批量拉取所有镜像：

```bash
#!/bin/bash
set -e

# 登录 GHCR
echo "your_ghcr_token" | docker login ghcr.io -u "your_github_username" --password-stdin

# 拉取所有镜像
echo "拉取中间件镜像..."
docker pull ghcr.io/beyonai/byclaw/byclaw-redis:main
docker pull ghcr.io/beyonai/byclaw/byclaw-minio:main
docker pull ghcr.io/beyonai/byclaw/byclaw-opengauss:main
docker pull sandbox-registry.cn-zhangjiakou.cr.aliyuncs.com/opensandbox/server:v0.1.9

echo "拉取应用镜像..."
docker pull ghcr.io/beyonai/byclaw/byclaw-fe:main
docker pull ghcr.io/beyonai/byclaw/byclaw-be:main
docker pull ghcr.io/beyonai/byclaw/byclaw-qa:main
docker pull ghcr.io/beyonai/byclaw/byclaw-data:main
docker pull ghcr.io/beyonai/byclaw/byclaw-all:main

echo "✅ 所有镜像拉取完成！"
```

## 注意事项

1. **GHCR 认证**：拉取 `ghcr.io` 开头的镜像需要 GitHub Personal Access Token，并且该 Token 需要有 `read:packages` 权限。

2. **网络要求**：
   - 外网环境：确保能够访问 GitHub Container Registry (ghcr.io) 和阿里云容器镜像服务
   - 公司内部环境：使用 tar 包方式导入镜像

3. **镜像大小**：部分镜像（如 OpenGauss）可能较大，拉取和传输时间会较长，请耐心等待。

4. **版本控制**：当前所有镜像都使用 `main` 标签，这是最新的开发版本。如果需要特定版本，请联系开发团队。

## 镜像管理

### 查看已拉取的镜像

```bash
docker images | grep byclaw
```

### 删除镜像

```bash
# 删除单个镜像
docker rmi ghcr.io/beyonai/byclaw/byclaw-redis:main

# 删除所有 byclaw 相关镜像
docker rmi $(docker images | grep byclaw | awk '{print $3}')
```

---

**下一步：** 阅读 [配置说明](./03-configuration.md) 来配置您的环境变量。
