# ByClaw 部署文档

欢迎使用 ByClaw 部署文档！本指南将帮助您快速完成 ByClaw 中间件及应用的部署工作。

## 🚀 快速开始

如果您想快速上手，请按照以下步骤操作：

1. ⚠️ **必须**：检查并安装 [前置条件](./01-prerequisites.md)（特别注意数据目录准备！）
2. **拉取镜像**：按照 [镜像拉取指南](./02-image-pull.md) 获取所需的 Docker 镜像
3. 配置 [环境变量](./03-configuration.md)
4. 选择适合您的 [部署模式](./04-deployment-modes.md)
5. 开始部署！

---

> ⚠️ **重要提示：** 纯 Docker 部署推荐使用 NFS/SMB/OpenMediaVault 这类文件型运行态卷承载 OpenClaw `/by`，MinIO 保留为对象存储。旧的 `FILE_STORAGE_MINIO_MOUNT_PATH` rclone 挂载仅作为 legacy 模式保留。

## 📚 文档目录

| 文档 | 说明 |
|------|------|
| [前置条件](./01-prerequisites.md) | 部署前需要准备的环境和工具 |
| [镜像拉取指南](./02-image-pull.md) | Docker 镜像列表和拉取方法（外网和公司内部） |
| [配置说明](./03-configuration.md) | 详细的环境变量配置指南（含 `MIDDLEWARE_MODULES`、`STANDALONE_MODULES`） |
| [部署模式选择](./05-deployment-modes.md) | 三种部署模式的对比和选择建议 |
| [中间件部署](./06-middleware-deployment.md) | Redis、MinIO、OpenGauss 等中间件的部署 |
| [拆分部署](./08-standalone-deployment.md) | 各模块独立部署的详细步骤 |
| [验证和故障排查](./09-verification.md) | 部署验证和常见问题解决 |
| [Docker 文件型存储升级 HTML 手册](./docker-file-storage-upgrade.html) | 从 0 到 1 的完整 HTML 操作手册，含固定导航和 SVG 流程图 |
| [Docker 文件型运行态存储部署](./10-docker-file-storage-deployment.md) | 使用 NFS/SMB/OpenMediaVault/CephFS 承载 OpenClaw `/by` |
| [MinIO 到文件型存储迁移](./11-minio-to-file-storage-migration.md) | 从旧 MinIO/rclone 数据卷迁移到 Docker 文件型运行态卷 |
| [一键部署存储模式切换 HTML](./12-one-click-storage-deployment.html) | 通过 `.env` + `deploy.sh init/update` 切换 MinIO/NFS 一键部署方案 |

## 📦 项目架构

ByClaw 由以下组件组成：

| 组件 | 说明 | 默认端口 |
|------|------|---------|
| FE | 前端服务 | 8080 |
| BE | 后端服务 | 8086 (HTTP) / 8082 (WebSocket) |
| QA Manager | QA 管理服务 | 8000 |
| QA Worker | QA 工作进程 | 无端口 |
| Data | DataCloud 服务 | 8087 |
| Redis | 缓存服务 | 6379 |
| MinIO | 对象存储 | 9000 (API) / 9001 (Console) |
| OpenGauss | 数据库 | 5432 |
| OpenSandbox | 沙箱服务 | 9005 |

## 💡 需要帮助？

如果您在部署过程中遇到问题，请先查看 [验证和故障排查](./09-verification.md) 文档。
