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

> ⚠️ **重要提示：** 部署前请务必提前准备好 MinIO 挂载目录：
> - `FILE_STORAGE_MINIO_MOUNT_PATH` (例如: `/data/8080`)
> 
> 详细步骤请参考 [前置条件 - 数据目录准备](./01-prerequisites.md#5-⚠️-重要数据目录准备必须)。

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
