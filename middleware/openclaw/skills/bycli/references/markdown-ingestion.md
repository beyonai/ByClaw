# Markdown 入库流程

把已经拿到的 byCLI Markdown 归一化为 `collectionResult.items[]`，再调用 ByClaw 生态采集入库接口完成产物归档和知识库导入。若 byCLI 返回的是图片或文件地址，则上传到会话文件接口并结束，不进入知识库入库链路。

> **触发边界：** 仅在用户明确表达"存到知识库/入库/导入知识库/沉淀"等意图时进入本流程。查数据/读网页/保存文件/对话记忆均不触发。

---

## 严格禁止

- 不要绕过本 skill 脚本手写 `curl`、`fetch` 或自行拼签名头
- 不要直接调 `/datasetController/uploadFiles`、`/datasetController/build`、Python 知识服务或写 MinIO/数据库
- 不要把 byCLI 返回的图片/文件地址当 Markdown 入库；图片和文件统一走 `/chat/uploadFiles`
- 不要把 token、SESSION、Cookie、Beyond-Token、签名盐写入技能文件、命令参数或对话回复
- 不要猜知识库 ID。用户未指定时先 `list-kb` 查询并让用户选择
- 不要把非 Markdown 的大段原始 JSON 当正文直接入库

## 严格要求

- 必须通过 `node scripts/bycli-markdown-ingest.mjs ...` 执行
- 入库目标必须是知识库：`task.importTarget=knowledgeBase`
- 入库前必须先 `list-kb` 查询可入库知识库，用户选择后再传 `knowledgeBaseResourceId`
- 图片/文件上传必须调用 `/chat/uploadFiles`，multipart 字段为 `files`，固定传 `sessionType=AGENT`
- 多文件入库前确认每个条目有稳定 `fileName`，扩展名 `.md`
- 对用户展示入库摘要并获得确认后再执行真实 `ingest`
- 执行失败时报告脚本返回的 `error`、`backend`、`auth` 摘要；不要切换旁路

---

## 推荐流程

### 1. 获取 Markdown

```bash
bycli web read --url "https://example.com/article" -f json > /tmp/bycli-output.json
```

或：

```bash
bycli browser ec bind
bycli browser ec extract > /tmp/bycli-output.json
```

### 2. 查询个人知识库

```bash
node scripts/bycli-markdown-ingest.mjs list-kb \
  --keyword "默认" \
  --page-num 1 \
  --page-size 20
```

展示 `knowledgeBases[]` 给用户选择。

### 3. 规范化检查（dry-run）

```bash
node scripts/bycli-markdown-ingest.mjs normalize \
  --bycli-json-file /tmp/bycli-output.json \
  --task-name "生态采集-网页" \
  --connector-code web \
  --source-name "网页" \
  --source-url "https://example.com/article" \
  --knowledge-base-resource-id 90001 \
  --knowledge-base-name "个人默认知识库"
```

### 4. 展示摘要

给用户展示：来源、文件数、文件名、知识库目标、是否归档 artifacts。

### 5. 用户确认后执行入库

```bash
node scripts/bycli-markdown-ingest.mjs ingest \
  --bycli-json-file /tmp/bycli-output.json \
  --task-id 10001 \
  --run-id 20001 \
  --task-name "生态采集-网页" \
  --connector-code web \
  --source-name "网页" \
  --source-url "https://example.com/article" \
  --knowledge-base-resource-id 90001 \
  --knowledge-base-name "个人默认知识库"
```

`ingest` 会先调用 `artifacts/store`，再把返回的 `markdownFiles` 传给 `knowledge/import`。

### 图片/文件上传（非 Markdown）

```bash
node scripts/bycli-markdown-ingest.mjs ingest \
  --file-url "https://example.com/report.pdf" \
  --session-id 123456
```

脚本下载资源，调用 `POST /byaiService/chat/uploadFiles`，上传成功后结束。

---

## 输入方式

| 方式 | 说明 |
|------|------|
| `--bycli-json-file <file>` | 读取 `bycli web read -f json` 或 `browser extract` 输出 |
| `--collection-result-file <file>` | 已归一化的 `collectionResult` JSON |
| `--markdown-file <file>` | 单个 Markdown 文件（可重复） |
| `--markdown-dir <dir>` | 目录下所有 `.md` 文件 |
| `--file-url` / `--image-url` / `--resource-url` | HTTP(S) 图片或文件地址 |
| `--file-path` / `--image-path` / `--resource-path` | 本地图片或文件 |
| stdin | 管道 JSON 给脚本 |

byCLI JSON 识别优先级：`items[]` / `markdownFiles[]` / `markdown` / `content` / `text` / `response` / `value`。

图片/文件识别：`fileUrl` / `imageUrl` / `iconUrl` / `downloadUrl` / `path` / `files[]` / `images[]` / `attachments[]` / `resources[]`。如果同一对象包含 Markdown 字段，优先按 Markdown 处理。

---

## 命令

| 命令 | 用途 |
|------|------|
| `help` | 输出脚本参数、后端发现结果和认证摘要 |
| `list-kb` | 查询可入库个人知识库 |
| `normalize` | 只生成 payload，不请求后端（dry-run） |
| `upload-resource` | 上传图片/文件到 `/chat/uploadFiles` |
| `store` | 调 `artifacts/store` 归档产物 |
| `import` | 调 `knowledge/import` 导入知识库 |
| `ingest` | 自动分流：图片/文件上传并结束；Markdown 先 `store` + `import` |

所有命令支持 `--dry-run`。

---

## 关键参数

| 参数 | 说明 |
|------|------|
| `--task-id` / `--run-id` | 采集任务 ID / 运行 ID |
| `--task-name` | 任务名称，如 `生态采集-网页` |
| `--connector-code` | 来源连接器，如 `web`、`zhihu`、`github` |
| `--source-name` / `--source-url` | 来源名称 / 原始链接 |
| `--knowledge-base-resource-id` | 知识库资源 ID（优先使用） |
| `--knowledge-base-id` | 旧链路知识库 ID |
| `--knowledge-base-name` | 知识库名称（展示/审计） |
| `--keyword` / `--page-num` / `--page-size` | 查询知识库列表时使用 |
| `--session-id` / `--agent-id` | 上传文件时使用 |
| `--output-dir` | byCLI 临时输出目录 |

---

## 后端与鉴权

脚本复用 ByClaw 生态采集的后端发现和门户登录态。所有 HTTP 接口拼 `/byaiService` 前缀。

- 优先 Redis 服务发现：`byai_gateway:sd:instances:${BE_DOMAINNAME:-ByaiService}`
- 兜底：`KN_MANAGER_URL` → `HOST`（裸 host 按 `BE_PROTOCOL` + `BE_SERVER_PORT` 补齐）
- 身份自动读取：`BAIYING_SESSION` → `BEYOND_TOKEN` → `USER_CODE` → `identity/by_user_info.json`
- HTTP 请求必须优先使用系统参数 `BEYOND_TOKEN` 写入请求头 `beyond-token`

---

## 详细参考

- [ingestion-api.md](./ingestion-api.md) — 入库接口字段、请求顺序和失败处理速查
- [scripts/bycli-markdown-ingest.mjs](../scripts/bycli-markdown-ingest.mjs) — 规范化与 HTTP 调用脚本
