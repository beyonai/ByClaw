# 配置说明

本文档详细介绍 `.env` 文件中的各项配置。

## 配置文件概述

项目根目录下的 `.env` 文件是所有配置的集中管理文件。您可以参考 `.env.example` 文件来创建自己的配置。

## 1. GHCR 认证配置（必需）

| 变量名 | 说明 | 示例 |
|--------|------|------|
| `GHCR_USER` | 您的 GitHub 用户名 | `john_doe` |
| `GHCR_TOKEN` | GitHub Personal Access Token | `ghp_xxxxxxxxxxxx` |

## 2. 域名配置

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `BE_DOMAINNAME` | 后端服务域名 | `ByaiService` |
| `QA_DOMAINNAME` | QA 服务域名 | `byclaw-qa-manager` |
| `DATACLOUD_DOMAINNAME` | DataCloud 域名 | `byclaw-datacloud` |

## 3. 服务端口配置

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `HOST` | 主机地址 | `127.0.0.1` |
| `BE_SERVER_PORT` | 后端 HTTP 端口 | `8086` |
| `BE_WS_PORT` | 后端 WebSocket 端口 | `8082` |
| `BYCLAW_QA_PORT` | QA 服务端口 | `8000` |
| `DATACLOUD_PORT` | DataCloud 端口 | `8087` |

## 4. 数据库配置（OpenGauss）

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `DB_TYPE` | 数据库类型 | `postgresql` |
| `DB_HOST` | 数据库主机 | `127.0.0.1` |
| `DB_PORT` | 数据库端口 | `5432` |
| `DB_DATABASE` | 数据库名 | `postgres` |
| `DB_SCHEMA` | 数据库 Schema | `byai` |
| `DB_USER` | 数据库用户名 | `gaussdb` |
| `DB_PASS` | 数据库密码 | `Admin@123` |

## 5. Redis 配置

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `REDIS_HOST` | Redis 主机 | `127.0.0.1` |
| `REDIS_PORT` | Redis 端口 | `6379` |
| `REDIS_USERNAME` | Redis 用户名 | `default` |
| `REDIS_PASSWORD` | Redis 密码 | `admin123` |
| `REDIS_DATABASE` | Redis 数据库号 | `0` |

## 6. MinIO 对象存储配置

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `FILE_STORAGE_TYPE` | 文件存储类型 | `minio` |
| `FILE_STORAGE_MINIO_HOST` | MinIO 主机 | `127.0.0.1` |
| `FILE_STORAGE_MINIO_API_PORT` | MinIO API 端口 | `9000` |
| `FILE_STORAGE_MINIO_UI_PORT` | MinIO Console 端口 | `9001` |
| `FILE_STORAGE_MINIO_ACCESS_KEY` | MinIO Access Key | - |
| `FILE_STORAGE_MINIO_SECRET_KEY` | MinIO Secret Key | - |
| `FILE_STORAGE_MINIO_SECURE` | 是否使用 HTTPS | `false` |
| `FILE_STORAGE_MINIO_BUCKET_NAME` | Bucket 名称 | `byclaw` |
| `FILE_STORAGE_MINIO_MOUNT_ENABLED` | 是否启用挂载 | `true` |
| `FILE_STORAGE_MINIO_MOUNT_PATH` | ⚠️ 挂载路径（重要） | - |

> ⚠️ **重要提醒：** `FILE_STORAGE_MINIO_MOUNT_PATH` 指定的目录必须在部署前提前创建好，并设置正确的权限！
> 详细步骤请参考 [前置条件 - 数据目录准备](./01-prerequisites.md#5-⚠️-重要数据目录准备必须)。
> 如果不需要挂载功能，可以设置 `FILE_STORAGE_MINIO_MOUNT_ENABLED=false`。

## 7. OpenSandbox 配置

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `BYCLAW_SANDBOX_ENABLE` | 是否启用沙箱 | `true` |
| `BYCLAW_SANDBOX_HOST` | 沙箱主机 | `127.0.0.1` |
| `BYCLAW_SANDBOX_PORT` | 沙箱端口 | `9005` |
| `BYCLAW_SANDBOX_BASE_URL` | 沙箱 Base URL | `http://127.0.0.1:9005` |
| `BYCLAW_SANDBOX_API_KEY` | 沙箱 API Key | `dev` |
| `BYCLAW_SANDBOX_STORAGE_MODE` | 沙箱存储模式 | `minio` |
| `BYCLAW_SANDBOX_HEARTBEAT_TIMEOUT` | 心跳超时 | `PT5M` |

## 8. QA 模块配置

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `BYCLAW_QA_AGENT_DATA_PATH` | Agent 数据路径 | `agent_data` |
| `BYCLAW_QA_CHECKPOINTER_BACKEND` | Checkpointer 后端 | `opengauss` |
| `BYCLAW_QA_KB_MINIO_BUCKET` | 知识库 Bucket | `knowledge-base` |
| `BYCLAW_QA_KB_MINIO_MARKDOWN_BUCKET` | Markdown 知识库 Bucket | `knowledge-base-markdown` |

## 9. DataCloud 配置

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `DATACLOUD_AGENT_LOCALE` | Agent 语言 | `zh_CN` |
| `DATACLOUD_GATEWAY_WORKER_ID` | Gateway Worker ID | `datacloud` |
| `DATACLOUD_GATEWAY_WORKSPACE_DIR` | 工作目录 | `/tmp/datacloud` |
| `DATACLOUD_DISABLE_ASK_USER_TOOL` | 禁用询问用户工具 | `1` |
| `DATACLOUD_REACT_MAX_ROUNDS` | 最大推理轮数 | `10` |

## 最小配置示例

对于快速开始，您只需要配置以下必需项：

```bash
# GHCR
GHCR_USER=your_github_username
GHCR_TOKEN=your_ghcr_personal_access_token

# 数据库密码（建议修改）
DB_PASS=your_secure_password

# Redis 密码（建议修改）
REDIS_PASSWORD=your_secure_redis_password

# MinIO 密钥（建议修改）
FILE_STORAGE_MINIO_ACCESS_KEY=minioadmin
FILE_STORAGE_MINIO_SECRET_KEY=minioadmin
```

---

**下一步：** 阅读 [部署模式选择](./05-deployment-modes.md) 来选择适合您的部署方式。
