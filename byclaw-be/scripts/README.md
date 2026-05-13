# Scripts 目录

此目录包含项目开发、构建、部署相关的辅助脚本。

## 脚本列表

### 开发脚本

- `setup.sh` - 开发环境初始化
- `dev-start.sh` - 本地开发启动
- `dev-stop.sh` - 停止开发服务

### 构建脚本

- `build.sh` - 项目构建
- `docker-build.sh` - Docker 镜像构建
- `release.sh` - 版本发布

### 部署脚本

- `deploy-docker.sh` - Docker 部署
- `deploy-k8s.sh` - Kubernetes 部署
- `backup.sh` - 数据备份

### 工具脚本

- `code-check.sh` - 代码质量检查
- `generate-api-docs.sh` - 生成 API 文档
- `db-migrate.sh` - 数据库迁移

## 使用示例

```bash
# 初始化开发环境
./scripts/setup.sh

# 本地启动
./scripts/dev-start.sh

# 构建项目
./scripts/build.sh

# 构建 Docker 镜像
./scripts/docker-build.sh
```
