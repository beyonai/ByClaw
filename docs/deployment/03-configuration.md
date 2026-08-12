# 配置说明

本文档详细介绍 `.env` 文件中的各项配置。

## 配置文件概述

项目根目录下的 `.env` 文件是所有配置的集中管理文件。您可以参考 `.env.example` 文件来创建自己的配置。

## 1. 域名配置

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `BE_DOMAINNAME` | 后端服务域名 | `ByaiService` |
| `QA_DOMAINNAME` | QA 服务域名 | `byclaw-qa-manager` |
| `DATACLOUD_DOMAINNAME` | DataCloud 域名 | `byclaw-datacloud` |

## 2. 服务端口配置

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `HOST` | 主机地址 | `127.0.0.1` |
| `BE_SERVER_PORT` | 后端 HTTP 端口 | `8086` |
| `BE_WS_PORT` | 后端 WebSocket 端口 | `8082` |
| `BYCLAW_QA_PORT` | QA 服务端口 | `8000` |
| `DATACLOUD_PORT` | DataCloud 端口 | `8087` |

## 3. 数据库配置（OpenGauss）

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `DB_TYPE` | 数据库类型 | `postgresql` |
| `DB_HOST` | 数据库主机 | `127.0.0.1` |
| `DB_PORT` | 数据库端口 | `5432` |
| `DB_DATABASE` | 数据库名 | `postgres` |
| `DB_SCHEMA` | 数据库 Schema | `byai` |
| `DB_USER` | 数据库用户名 | `gaussdb` |
| `DB_PASS` | 数据库密码 | `Admin@123` |

## 4. Redis 配置

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `REDIS_HOST` | Redis 主机 | `127.0.0.1` |
| `REDIS_PORT` | Redis 端口 | `6379` |
| `REDIS_USERNAME` | Redis 用户名 | `default` |
| `REDIS_PASSWORD` | Redis 密码 | `admin123` |
| `REDIS_DATABASE` | Redis 数据库号 | `0` |

## 5. MinIO 对象存储配置

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `FILE_STORAGE_TYPE` | 上传/下载接口使用的文件存储类型：`minio`、`file`、`local` 等 | `minio` |
| `FILE_STORAGE_LOCAL_PATH` | `FILE_STORAGE_TYPE=file` 或 `local` 时的服务器文件根目录 | `/mnt/byclaw-file` |
| `FILE_STORAGE_MINIO_HOST` | MinIO 主机 | `127.0.0.1` |
| `FILE_STORAGE_MINIO_API_PORT` | MinIO API 端口 | `9000` |
| `FILE_STORAGE_MINIO_UI_PORT` | MinIO Console 端口 | `9001` |
| `FILE_STORAGE_MINIO_ACCESS_KEY` | MinIO Access Key | - |
| `FILE_STORAGE_MINIO_SECRET_KEY` | MinIO Secret Key | - |
| `FILE_STORAGE_MINIO_SECURE` | 是否使用 HTTPS | `false` |
| `FILE_STORAGE_MINIO_BUCKET_NAME` | Bucket 名称 | `byclaw` |
| `FILE_STORAGE_MINIO_MOUNT_ENABLED` | 是否启用 legacy rclone 挂载 | `false` |
| `FILE_STORAGE_MINIO_MOUNT_PATH` | legacy rclone 挂载路径 | - |

> 新部署推荐保持 `FILE_STORAGE_MINIO_MOUNT_ENABLED=false`，并使用 `BYCLAW_SANDBOX_VOLUME_BACKEND=file` 把 OpenClaw `/by` 切到 NFS/SMB/OpenMediaVault/CephFS。上传接口可继续使用 `FILE_STORAGE_TYPE=minio`；如果希望上传接口也写入服务器文件型存储，可切为 `FILE_STORAGE_TYPE=file` 并设置 `FILE_STORAGE_LOCAL_PATH=/mnt/byclaw-file`。

## 6. OpenSandbox 配置

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `BYCLAW_SANDBOX_ENABLE` | 是否启用沙箱 | `true` |
| `BYCLAW_SANDBOX_HOST` | 沙箱主机 | `127.0.0.1` |
| `BYCLAW_SANDBOX_PORT` | 沙箱端口 | `9005` |
| `BYCLAW_SANDBOX_BASE_URL` | 沙箱 Base URL | `http://127.0.0.1:9005` |
| `BYCLAW_SANDBOX_API_KEY` | 沙箱 API Key | `dev` |
| `BYCLAW_SANDBOX_STORAGE_MODE` | 沙箱存储模式 | `minio` |
| `BYCLAW_SANDBOX_HEARTBEAT_TIMEOUT` | 心跳超时 | `PT5M` |
| `BYCLAW_SANDBOX_VOLUME_BACKEND` | OpenClaw `/by` 运行态卷后端：`minio-mount` 或 `file` | `minio-mount` |
| `BYCLAW_SANDBOX_FILE_VOLUME_ROOT` | 文件型运行态卷根路径，所有 openSandbox Docker 节点必须一致 | `/mnt/byclaw-file` |
| `BYCLAW_SANDBOX_FILE_VOLUME_TYPE` | 文件型运行态卷类型：`cephfs`、`nfs`、`smb`、`bind` | `bind` |
| `BYCLAW_SANDBOX_FILE_VOLUME_SNAPSHOT_PROVIDER` | 快照/备份提供方：`ceph`、`nas`、`zfs`、`btrfs`、`lvm`、`none` | `none` |
| `BYCLAW_SANDBOX_FILE_BROWSER_ENABLED` | 是否部署 File Browser 浏览用户 `/by` | `false` |

Docker-only 推荐配置：

```bash
FILE_STORAGE_TYPE=minio
FILE_STORAGE_MINIO_MOUNT_ENABLED=false
BYCLAW_SANDBOX_VOLUME_BACKEND=file
BYCLAW_SANDBOX_FILE_VOLUME_ROOT=/mnt/byclaw-file
BYCLAW_SANDBOX_FILE_VOLUME_TYPE=nfs
BYCLAW_SANDBOX_FILE_VOLUME_SNAPSHOT_PROVIDER=nas
```

上传接口切到同一文件型存储时：

```bash
FILE_STORAGE_TYPE=file
FILE_STORAGE_LOCAL_PATH=/mnt/byclaw-file
```

## 7. QA 模块配置

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `BYCLAW_QA_AGENT_DATA_PATH` | Agent 数据路径 | `agent_data` |
| `BYCLAW_QA_CHECKPOINTER_BACKEND` | Checkpointer 后端 | `opengauss` |
| `BYCLAW_QA_KB_MINIO_BUCKET` | 知识库 Bucket | `knowledge-base` |
| `BYCLAW_QA_KB_MINIO_MARKDOWN_BUCKET` | Markdown 知识库 Bucket | `knowledge-base-markdown` |

## 8. DataCloud 配置

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `DATACLOUD_AGENT_LOCALE` | Agent 语言 | `zh_CN` |
| `DATACLOUD_GATEWAY_WORKER_ID` | Gateway Worker ID | `datacloud` |
| `DATACLOUD_GATEWAY_WORKSPACE_DIR` | 工作目录 | `/tmp/datacloud` |
| `DATACLOUD_DISABLE_ASK_USER_TOOL` | 禁用询问用户工具 | `1` |
| `DATACLOUD_REACT_MAX_ROUNDS` | 最大推理轮数 | `10` |

## 9. 业务称谓配置

系统配置项 `DIGITAL_EMPLOYEE_TERMINOLOGY` 用于按部署实例统一配置“数字员工”在客户界面的中英文称谓。默认值保持现有产品称谓，不配置时行为不变。

例如，客户要求显示为“专家”时，将该配置项的 `param_value` 设置为：

```json
{
  "zh-CN": {
    "singular": "专家",
    "plural": "专家",
    "entry": "专家",
    "market": "专家市场"
  },
  "en-US": {
    "singular": "Expert",
    "plural": "Experts",
    "entry": "Experts",
    "market": "Expert Marketplace"
  }
}
```

配置含义：

- `singular`：正文、按钮、错误提示和默认 Agent 提示词中的单数称谓。
- `plural`：英文复数等需要区分单复数的文案。
- `entry`：侧边栏等 AI 员工短入口称谓。
- `market`：市场入口称谓。

每个字段必须为 1～40 个字符，且不能包含换行或 `{}`、`<>`；非法或缺失字段会回退到默认称谓。

该配置只改变客户可见文案，不修改 `DIG_EMPLOYEE`、接口路径、数据库表字段、Redis key、OpenClaw `digitalEmployee` 角色标识、埋点编码等内部协议，也不会替换“企业员工”“全公司所有员工”等真人员工语义。配置保存后需确保系统配置缓存已刷新；QA 请求和 OpenClaw 托管工作区种子会从 `byai:SystemConfig:paramCode` 同步读取同一配置。已有的客户自定义提示词不会被回写；OpenClaw 已生成的托管 Markdown 在下次全量重建工作区种子或服务重启后刷新。

如果部署显式覆盖了 `OPEN_DC_QUERY_KEYS`，无需额外加入此配置项；后端会固定允许登录前读取 `DIGITAL_EMPLOYEE_TERMINOLOGY`，该配置中不得存放密钥或其他敏感信息。

## 10. WHALE_AGENT 知识检索参数

当后端配置 `DATASET_SYSTEM=WHALE_AGENT` 时，数字员工配置页会为每个已关联知识库显示以下检索参数：

- `similarity`：最小匹配度，范围为 `0～1`，默认值为 `0.6`。
- `topK`：最大召回数量，范围为 `1～100`，默认值为 `20`。

参数保存在数字员工与知识库的关联关系中，并由 OpenClaw 在调用 WHALE_AGENT 知识检索接口时传递。历史关联关系无需执行数据库迁移，读取和下次保存时会使用默认值。其他 `DATASET_SYSTEM` 模式及 `CALL_AGENT` 检索链路不使用这两个关联参数。

## 最小配置示例

对于快速开始，您只需要配置以下必需项：

```bash
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
