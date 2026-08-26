# 知识库文档资源化存储改造说明

## 1. 背景与问题

当前知识库原始文件、Markdown 文件及构建过程中的文档读写由 by-qa 调用门户 FS Operation 接口完成。
历史实现使用 UserFS，文件实际归属于发起操作的用户：

- 用户 A 上传或通过会话采集文档到企业知识库 B 后，文件写入 A 的用户空间。
- 用户 C 即使拥有知识库 B 的管理或访问权限，也无法构建、读取或下载该文件。
- 个人知识库或企业知识库分享给其他用户后，同样存在此问题。

根因是“知识库文档属于知识库资源”与“文件存储属于操作用户”两个归属模型不一致。

## 2. 改造原则

知识库的规范文档按资源归属：

- 原始文件；
- Markdown 文件；
- 构建过程中需要持久化并供知识库成员复用的文档文件。

以下文件继续按用户归属，不纳入本次资源化：

- 会话草稿、会话输出；
- 用户临时文件；
- QA 检查报告；
- DataCloud 任务结果文件。

权限仍由门户统一判断：

- RESOURCE 读操作要求知识库访问权限；
- RESOURCE 写、删除、移动、构建操作要求知识库管理权限；
- `resourceId` 与物理路径中的资源标识必须一致。

## 3. 目标调用链

```mermaid
flowchart LR
    U["用户 A / C"] --> P["门户知识库接口"]
    P --> AUTH["知识库资源权限校验"]
    AUTH -->|本地 by-qa| H["携带 X-Byclaw-Resource-Id"]
    H --> QA["by-qa 文档服务"]
    QA --> FS["门户 FS Operation<br/>spaceType=RESOURCE"]
    FS --> KFS["KnowledgeResourceFS"]
    KFS --> B["私有 byclaw-qa bucket"]
```

知识文件路径格式：

```text
/resource/kg_doc/KG_DOC_{resourceId}/.bykc/{knCode}/raw/origin/{filePath}
/resource/kg_doc/KG_DOC_{resourceId}/.bykc/{knCode}/raw/markdown/{filePath}.md
```

数据库内已有的逻辑 StorageLocation 保持 `/.bykc/...` 不变，由 by-qa 存储适配层映射为资源物理路径，
避免为了本次改造批量修改 by-qa 数据库记录。

## 4. 系统改造范围

### 4.1 门户

- 知识库上传、构建、读取、下载、目录操作、移动、删除等调用向本地 by-qa 透传 `resourceId`。
- 常规文件操作通过内部请求头 `X-Byclaw-Resource-Id` 透传资源上下文。
- 异步构建使用 by-qa 的 `fileToMarkdownIndex` 原生接口，并通过 `X-Byclaw-Resource-Id` 请求头传递资源上下文。
- 第三方知识库直连（例如 `WHALE_AGENT`）不携带该内部请求头，OpenAPI path 和请求体保持不变。
- FS Operation 保留统一权限校验，并将 `/resource/kg_doc/` 路径路由到知识库专用 ResourceFS。
- 知识文件使用私有 `byclaw-qa` bucket；公共资源继续使用原 `byclaw` / `byclaw-datacloud` 存储。
- 门户前端接口已使用 `resourceId`，本次不修改前端请求协议。

### 4.2 by-qa

- 默认知识存储 Provider 改为资源感知 Provider。
- 从门户内部请求头 `X-Byclaw-Resource-Id` 建立请求级资源上下文。
- 有资源上下文时，调用门户 FS Operation 的 RESOURCE 空间。
- 后台构建任务显式复制并绑定资源上下文，避免请求结束后丢失 `resourceId`。
- 暂时保留无 `resourceId` 时的 UserFS 回退，兼容尚未同步改造的 DataCloud 和旧调用方。
- 检索向量、知识库元数据等非文件读写流程不改变。

### 4.3 by-datacloud（后续改造）

本轮不修改 by-datacloud。后续应完成：

- DataCloud 调用门户知识库接口时统一使用知识库 `resourceId`；
- 如果仍直接调用本地 by-qa，应携带 `X-Byclaw-Resource-Id`；
- 上传、构建、下载、读取、目录和删除操作均需传递同一 `resourceId`；
- DataCloud 自身任务结果文件继续使用 UserFS，不应迁入知识库 ResourceFS；
- 完成改造并迁移历史文件后，可取消 by-qa 的 UserFS 兼容回退。

## 5. 兼容性影响

### 本地 by-qa

- 新上传的知识文档从操作用户空间转为知识库资源空间。
- 具备同一知识库相应权限的用户可共同读取、下载和构建。
- by-qa 内部问答检索接口、向量数据结构和 knCode 路由不变。

### 第三方知识库

- 第三方直连不接收 `X-Byclaw-Resource-Id`。
- 请求体、路径和认证方式保持原状。
- 第三方文件归属与权限仍由第三方知识库服务负责。

### 旧文件

本次改造不会自动搬迁已经写入各用户 UserFS 的历史知识文件。上线前需要按知识库归属执行迁移：

1. 根据 by-qa 文件记录确定 `knCode` 和逻辑路径；
2. 根据门户资源表映射 `knCode -> resourceId`；
3. 从原用户空间复制到对应知识库资源路径；
4. 校验文件大小或校验和；
5. 确认新链路可读后再决定是否清理旧文件。

## 6. 测试范围

### 单元测试

- by-qa 资源上下文绑定、释放与请求头读取；
- by-qa RESOURCE 写、读、删、移动的参数和资源路径；
- 无 `resourceId` 时 UserFS 兼容回退；
- 门户本地 by-qa 请求携带资源头，旧调用不携带；
- 知识资源路径路由到私有 KnowledgeResourceFS；
- 公共 ResourceFS 与知识 ResourceFS 的 bucket、share type 和初始化。

### 门户与 by-qa 集成测试

- 用户 A 上传，用户 C（有管理权限）构建成功；
- 用户 A 上传，用户 C（有访问权限）读取和下载成功；
- 只有访问权限的用户执行上传、删除、移动、构建时被拒绝；
- 无访问权限用户读取、下载、目录查询时被拒绝；
- `resourceId` 与文件路径不一致时被拒绝；
- 企业知识库、个人知识库分享后的相同场景；
- 文件下载与目录 ZIP 下载；
- 后台构建任务在 HTTP 请求结束后仍使用正确的资源上下文。

### 回归测试

- by-qa 问答检索、构建状态查询和引用查询；
- 第三方 `WHALE_AGENT` 上传、构建、查询和下载；
- 会话文件、QA 报告、DataCloud 结果文件仍走 UserFS；
- DataCloud 未改造期间的旧上传和构建链路仍可通过兼容回退运行。

## 7. 发布建议

1. 先发布门户 FS Operation 和私有知识 ResourceFS。
2. 再发布门户的资源上下文透传与 by-qa 资源存储 Provider。
3. 执行历史文件迁移和双用户权限验收。
4. 改造并发布 by-datacloud。
5. 观察无 `resourceId` 回退日志，调用方归零后移除兼容分支。
