# 云盘作为 knowledge-collection 采集来源（V1 设计）

## 目标

用户在触发 `knowledge-collection` 时给出一个或多个云盘/知识库地址，采集流程从这些云盘里检索并取回文件正文，产出与现有采集会话完全一致的交付物。

V1 只实现两个动作：**按主题检索定位文件**（`search-file`）与**取回正文**（`download`）。

## 非目标

- 不实现 `search`（切片检索）与 `metadata-search`。
- 不实现云盘写入。采集完成后是否入库由根 Agent 依已有的 `ingest-handoff` 契约另行决定，与本设计无关。
- 不改动公共采集链路（WSA / hot-discovery / browser bridge / `public-collect`）。
- 不做云盘目录的递归全量归档（`materializationTarget=all` 语义在 V1 不开放给云盘）。

## 方向说明

`knowledge-collection` 与 `project-cloud-knowledge` 之间是两条独立单向通道：

| 方向 | 触发 | 契约 |
|---|---|---|
| 读（本设计） | 用户给出云盘地址作为采集来源 | 新增 `cloud-knowledge` 企业来源 |
| 写（已存在） | 采集完成后用户要求入库 | `action: "ingest-handoff"`，见 project-cloud-knowledge/SKILL.md |

两条通道的地址都由用户每次给出，互不推导。若来源与入库目标恰好落在同一个 `resourceId`，由写入侧既有的 `check-conflicts` 与覆盖确认规则处理，采集侧不做额外限制。

## 落点选择

云盘接入**企业来源模式**，不接入公共发现通道。

理由：公共通道绑定 WSA/SearXNG 双 provider、热度适配器、browser bridge 单一恢复所有者、重定向授权校验，云盘一项都不需要。而企业来源模式（`enterprise search` / `enterprise materialize` + `adapters/`）的形态与云盘完全吻合：外部 CLI 执行器、结构化 JSON 输出、原地物化、统一 collection contract。

参照实现取 `ima`（最近新增、同为「CLI 执行器 + 本地筛选 + 原地物化」）与 `fws`（已有非 Markdown 文档转换能力）。

## 执行时序

`task.sourceScope` 在首次 `init` 时冻结，而云盘 CLI 的 `--resource-id` 要求正整数，用户手里是地址字符串。因此解析必须前置：

```
用户给出 N 个云盘地址
        │
        ▼
根 Agent 解析（project-context basic → project.cloudResourceId）
        │  每个地址 → { resourceId, directoryPath }
        ▼
init --source-scope '["cloud-knowledge"]' \
     --materialization-target selected \
     --required-content-granularity full-text \
     --cloud-discovery-scope '<JSON>'
        │
        ▼
enterprise search --source cloud-knowledge \
     --parent-session-dir <会话根> --output-dir <会话根> \
     --query <主题> --limit N --metadata-only
        │  只列候选，不下载
        ▼
用户从候选里挑选
        │
        ▼
enterprise materialize --source cloud-knowledge \
     --session-dir <会话根> --output-dir <会话根> --item-ids <...>
        │
        ▼
status / publish（复用现有命令，无需改动）
```

**流程里没有 `collect`。** bundle 写入时 [artifact-writer.mjs:999](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/shared/artifact-writer.mjs#L999) 置 `task.status`，[artifact-writer.mjs:1015](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/shared/artifact-writer.mjs#L1015) 置 `publicationStatus='committed'`，inventory 由 bundle 直接给出。`collect` 是**另一条路**——给手工登记单条目用（[collection-state.mjs:777-802](../../middleware/openclaw/skills/knowledge-collection/scripts/collection-state.mjs#L777-L802) 的 `canonicalItem` + `source` 入参），企业 adapter 路径不经过它。物化完成后直接 `status` 看结果、`publish` 交付。

**两步式是强制的，不是可选优化。** 云盘正常路径由 dispatcher 强制 `metadata-only=true`；[resume.mjs:56](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/shared/resume.mjs#L56) 仍硬校验 `sourceMetadata.metadataOnly === true`，用于拒绝被篡改或不符合 V1 契约的旧会话。云盘文件动辄几十 MB，先列候选再按需下载也避免为用户不要的文件付下载代价。

由此对 adapter 的 `search` 有两条硬要求：

- `sourceMetadata.metadataOnly` 必须写 `true`；
- 候选条目的 `materialization.status` 必须写 `pending`——[resume.mjs:62](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/shared/resume.mjs#L62) 只接受 `pending`，缺状态或写别的值都会让物化阶段整批失败。

`--limit N` 是**发现阶段的抓取上限**，不是交付数量保证。详见「数量语义」。

`--session-dir` 与 `--output-dir` 必须同为会话根：企业 adapter 直接向已初始化会话根写 bundle，不另建子会话。

`enterprise search --query` 必须与 `init --query` **逐字相同**（trim 后严格相等）。照 [enterprise-collection.mjs:134](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise-collection.mjs#L134) 的 ima 判据，不允许在检索阶段改写、细化或拼接主题词。云盘的 DSL 收窄（目录、格式）走 `where`，**不走 `--query`**——需要限定范围就调整授权集或白名单，不要动主题词。若认为需要多个不同检索词，那是多次会话，不是一次会话里的多次漂移。

云盘 `search` **必须使用 metadata-only**：dispatcher 对 `source=cloud-knowledge` 将 `metadata-only` 缺省值视为 `true`，显式传 `false` 直接拒绝，并提示删除该参数或传 `true`。这样不会产生一个已完成但永远无法进入 materialize 的死会话；验收只保留“显式 false 被拒绝”，不再把“先生成非 metadata-only bundle、再在第二步报错”视为正常流程。

`materializationTarget` 与 `metadataOnly` 是两个独立字段，不互相推导。对其他企业来源，`metadataOnly` 是 `enterprise search` 的入参且默认 false；对云盘，dispatcher 强制为 true，显式 false 拒绝。`materializationTarget` 由 `init` 冻结在会话里。两者只在**新建**会话时有一处兜底关系（[artifact-writer.mjs:978](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/shared/artifact-writer.mjs#L978)：`bundle.materializationTarget ?? (metadataOnly ? 'candidates' : 'all')`）。云盘走已初始化会话根，[artifact-writer.mjs:983-984](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/shared/artifact-writer.mjs#L983-L984) 会 `structuredClone` 保留 `init` 时定的 `selected`，兜底值不生效。

同一处还有一条对云盘生效的校验（[artifact-writer.mjs:991-995](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/shared/artifact-writer.mjs#L991-L995)）：写入已初始化会话时，bundle 的 `sourceScope` 必须是会话 `task.sourceScope` 的子集，否则抛 `initialized session sourceScope does not allow: ...`。adapter 不显式给 `sourceScope` 时默认取 `[SOURCE_SCOPE[source] || source]` = `['cloud-knowledge']`，与 `init` 的值一致，自然通过——**前提是 identity 的 `source` 与 scope 枚举同名**，见「需要改动的位置 / 新增 adapter」。

解析失败（项目云盘未初始化、上下文缺少 `project_id`、无 `cloudResourceId`）时终止并说明，不得用普通知识库 `resourceId` 冒充，也不得让 Agent 猜测目录。

## 发现授权集

解析结果作为**发现授权集**持久化进 `session.json`：

```json
{
  "task": {
    "sourceScope": ["cloud-knowledge"],
    "cloudDiscoveryScope": {
      "schemaVersion": "1.0",
      "resources": [
        { "resourceId": 1024, "directoryPath": "/运维", "origin": "user-input" },
        { "resourceId": 2048, "directoryPath": "/", "origin": "user-input" }
      ]
    }
  }
}
```

校验要在**两个阶段各做一次**，只做一次都留缺口：

| 阶段 | 校验对象 | 缺失后果 |
|---|---|---|
| `search` 收到 CLI 响应后 | 每条命中的 `resourceId` + `filePath` 是否落在授权集内 | 后端若返回越出 `prefix` 的路径，越界条目直接写进候选 inventory，`materialize` 阶段再校验时已无法区分「用户选的」与「后端多给的」 |
| `materialize` 下载前 | 每条选中候选的 `resourceId` + `filePath` 再核一遍 | 只信任 inventory 等于信任落盘文件；`session.json` 被改写就能取任意路径 |

两处都以 `SOURCE_NOT_AUTHORIZED_BY_DISCOVERY` 拒绝。`search` 阶段的越界条目**丢弃并计入覆盖缺口**（它不是用户请求的东西，不该占 inventory 名额）；`materialize` 阶段的越界条目记 `materialization.status='failed'` + `reason` 以 `SOURCE_NOT_AUTHORIZED_BY_DISCOVERY:` 开头（它在选中集合里，按「选中且失败的留下」规则必须留在 inventory）。

前缀比较按路径段边界，不做纯字符串 `startsWith`：授权 `/运维` 不得放行 `/运维备份/x.md`。`directoryPath` 为 `/` 时该资源全放行。

原则与公共侧一致——路径来自用户输入或已持久化的发现，不由 Agent 现场构造——但**校验代码必须在 cloud adapter 内新写，不能复用 [discovery-authorization.mjs](../../middleware/openclaw/skills/knowledge-collection/scripts/discovery-authorization.mjs)**。该模块是 HTTP URL 专用：schema `2.0`，全部以 `normalizedHttpUrl(...)` 为键，`authorizePublicSource` / `authorizeArxivAcquisitionVariant` 只认 http(s)。`cloud-knowledge://` URI 进不去这套。沿用的只是 reason code 字符串。

`origin` 仅允许 `user-input`。V1 不支持 Agent 从检索结果推导出新的授权资源。

## 命令映射

### 发现

多地址一次调用即可，`--resource-id` 是 `action="append"`，后端负责跨库合并打分：

```bash
python3 <cloud>/scripts/project_cloud_knowledge.py search-file \
  --resource-id 1024 --resource-id 2048 \
  --query "巡检流程" \
  --where-json '{"and":[{"prefix":{"fieldName":"filePath","value":"/运维"}},{"in":{"fieldName":"fileType","value":["md","pdf","docx"]}}]}' \
  --metadata-field fileType \
  --metadata-field fileSignature \
  --metadata-field fileSize \
  --metadata-field updatedAt \
  --top-k 20
```

V1 只生成两种 DSL 形态，不开放任意表达式：

| 形态 | 用途 | 来源 |
|---|---|---|
| `prefix` on `filePath` | 目录收窄 | 授权集里每个资源的 `directoryPath`（非 `/` 时生成） |
| `in` on `fileType` | 可处理格式白名单 | 固定白名单，见下 |

上例成立的前提是两个资源的 `directoryPath` 相同（都限 `/运维`）。**`directoryPath` 不同时必须按资源分组分别调用**，因为 `where` 是全局条件，无法表达「资源 A 限 `/运维`、资源 B 不限」。分组规则：按 `directoryPath` 取值分桶，同桶资源合并成一次调用。

`--metadata-field fileType`、`fileSize`、`fileSignature` 必须请求：前两者用于物化前拒绝，后者是后端给出的原始内容 SHA-256，用于发现阶段去重。`fileType` 或 `fileSize` 缺失时，候选只能保留在原始检索响应中，不得写入可供物化的 inventory，并以结构化的 `INVALID_RESPONSE` 终态结束；`fileSignature` 缺失不属于响应无效，候选可以写入 inventory，但必须使用 provisional duplicate group，且不得伪造签名。

`--top-k` 与 `--limit` 是两个层级的量：`--limit` 是 dispatcher 层的会话抓取上限（1..500）；`--top-k` 是云盘 CLI 的后端召回数（正整数，无上限）。多资源分组调用时每组各拿 `top-k` 条，合并后可能超过 `limit`，由 adapter 截断（照 [ima.mjs:579](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/adapters/ima.mjs#L579) 的 `found.slice(0, request.limit)`）。取值：`top-k` 设为 `limit` 或略大。

### 取回正文

```bash
python3 <cloud>/scripts/project_cloud_knowledge.py download \
  --resource-id 1024 \
  --file-path /运维/巡检手册.pdf \
  --output <session>/raw/download/<itemId>/download-<itemId>.pdf
```

`download` 是 V1 **唯一**满足 `full-text` 的路径。

### 格式白名单与转换

| 扩展名 | 处理 |
|---|---|
| `.md` `.markdown` `.txt` | 直接作为正文，规范化后写入 `sanitized/items/` |
| `.pdf` `.doc` `.docx` `.xls` `.xlsx` `.ppt` `.pptx` | 经 `by-doc-to-markdown` 转换，复用 `fws.mjs` 的 `CONVERTIBLE_EXTENSIONS` 通路 |
| 其他 | 不进入发现（由 `in` on `fileType` 过滤掉）；若后端返回不受支持的实际类型，物化记 `failed` + `reason` 以 `UNSUPPORTED_FORMAT:` 开头 |

单文件字节上限沿用企业侧现值 50 MiB（`fws.mjs` 的 `MAX_MATERIALIZED_BYTES`）；超限记 `failed` + `reason` 以 `SOURCE_TOO_LARGE:` 开头，不截断。

这两条各有**三道关卡**，不要只做最后一道（原因见「materialize 是一次性的」——条目级失败会让整个会话不可交付）：

| 关卡 | 时机 | 依据 | 结果 |
|---|---|---|---|
| 发现过滤 | 检索 DSL | `in` on `fileType` | 不受支持格式不进候选 |
| 物化前预筛 | 收到 `--item-ids` 后、下载前 | 候选自带的 `fileType` / `fileSize` | 拒绝命令并提示改选，**不写 bundle、不改会话状态** |
| 物化兜底 | 下载/转换时 | 实际字节与实际格式 | 记条目级 `failed` + 前缀 `reason` |

中间那道是新增的、也是最重要的：候选元数据里已有 `fileType` 和 `fileSize`（八个免注册系统属性之二），能判的就别放进物化。由于 search 阶段对这两个字段缺失已经 fail-closed，兜底主要接住 `fileSize` 与实际字节不符、扩展名与实际内容不一致等下载/转换阶段问题。

## 产物布局

`--output-dir` 必须等于 `--parent-session-dir`。不在 `raw/` 下开第二棵会话树，最终正文只在会话根级 `sanitized/items/`：

```text
collection-result.json
raw/
  metadata.json                        # 固定在 raw/ 根级，不加来源子目录
  search-file-<hash>.json              # 每次检索调用一份原始响应
  download/<itemId>/download-<itemId>.<ext> # adapter 生成的安全文件名，materialize 阶段才出现
markdown/items/<name>-<itemId>/index.md
sanitized/items/<name>-<itemId>/index.md
```

`metadata.json` 的位置是**仓库既定约定，不是本设计可选的**：全部现有 adapter 都写在 `raw/metadata.json`，无一例外，都不套来源子目录——[dingtalk.mjs:143](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/adapters/dingtalk.mjs#L143)、[feishu.mjs:105](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/adapters/feishu.mjs#L105)、[fws.mjs:464](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/adapters/fws.mjs#L464)、[ima.mjs:762](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/adapters/ima.mjs#L762)、[wecom.mjs:253](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/adapters/wecom.mjs#L253)。一次会话只有一个来源（`--source` 单值），子目录不解决任何冲突，只会让排查工具与既有约定错位。检索响应与下载物同理留在 `raw/` 下，靠 `search-file-` 前缀与 `download/` 子目录区分，不再套一层 `cloud-knowledge/`。

由此推出一条两步流特有的约束：**`materialize` 阶段不得再写 `raw/metadata.json`**。这个路径固定，第二次写就是覆盖，会把检索阶段落下的 `sourceMetadata.terminal` 与检索侧 `discovery` 信息抹掉。ima 的 `materialize`（[ima.mjs:864-893](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/adapters/ima.mjs#L864-L893)）正是只写 bundle、不写 `raw/metadata.json`，云盘照抄：物化阶段的来源信息进 bundle 的 `sourceMetadata`，不落 `raw/`。

目录名沿用企业侧约定：清洗后标题前 5 个 Unicode 可见字符 + 稳定 `itemId`，完整标题保留在正文元数据与 inventory。`itemId` 必须由 adapter 生成并匹配 `[A-Za-z0-9._-]+`，不能直接采用远端文件名或路径。

三类路径在 bundle 里的写法都是**会话根相对路径**，且各有硬校验：

| 字段 | 要求 | 校验位置 |
|---|---|---|
| `rawArtifacts[]` | 必须以 `raw/` 开头，且指向**已存在的非空常规文件** | [artifact-writer.mjs:723-741](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/shared/artifact-writer.mjs#L723-L741) |
| `materialization.markdownPath` | 必须在 `markdown/` 下，扩展名 `.md`/`.markdown` | [artifact-writer.mjs:572-583](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/shared/artifact-writer.mjs#L572-L583) |
| `materialization.sanitizedPath` | 必须在 `sanitized/items/` 下，扩展名同上 | 同上 |

两条由此推出的写序要求：

- **`search-file-<hash>.json` 必须在写 bundle 之前落盘**，否则 metadata-only 阶段把它列进 `rawArtifacts` 会抛 `must point to a non-empty regular file`。空响应也要落盘成合法 JSON（`{"ok":true,...}`），不能因为「没命中」就不写。
- **metadata-only 阶段的 `rawArtifacts` 不得包含 `download/<itemId>/` 下的任何路径**——那时还没下载，目录不存在。候选条目的 `rawArtifacts` 只列检索响应；下载物在 `materialize` 阶段才追加。

符号链接一律被拒（三类路径都过 `rejectExistingSymlinks`）。

执行身份：`source=cloud-knowledge`、`backend=project-cloud-knowledge`、`sourceSkill=project-cloud-knowledge`。

## 溯源与去重

溯源 URI：`cloud-knowledge://<resourceId><absolutePath>`，例如 `cloud-knowledge://1024/运维/巡检手册.pdf`。

### 云盘路径规范化与本地输出安全

云盘路径分为两类，必须分别处理：

- **远端 `filePath`**：必须是以单个 `/` 开头的绝对 POSIX 路径；拒绝 NUL、控制字符、反斜杠、空路径段、`.` 和 `..` 段。保留远端路径的字符和大小写，不做 URL 编码、解码或路径拼接。授权比较使用路径段数组，`/运维` 只匹配 `/运维` 和 `/运维/...`，不匹配 `/运维备份/...`。
- **本地下载文件名**：绝不把远端 `filePath` 或后端返回的文件名直接作为本地路径。adapter 必须使用 `download-<itemId>.<ext>` 这样的 adapter 生成名，原文件名只存入 inventory 的 `originalFileName`。本地目标固定在 `raw/download/<itemId>/` 下，并在调用 CLI 前后都通过 `writer.absolute()`/等价的 `relative` 检查确认仍在会话根内。

下载目录及其每一级父目录都必须拒绝符号链接、非目录和越权替换；下载完成后目标必须是会话内非空普通文件，文件大小必须再次按实际 `stat` 校验。CLI 自身可能创建 `output.parent`，因此 adapter 在传参前必须完成上述路径校验，writer 在事后校验 `rawArtifacts` 不能替代事前沙箱。

去重按优先级：

1. 同 `resourceId` + 同 `filePath` → 同一条目，只登记一次。
2. 跨 `resourceId` 的 `fileSignature` 相同 → 同一重复组，保留全部来源记录。
3. 无 `fileSignature` 时，只有在正文已物化并计算出稳定正文指纹后，才退回正文指纹（复用现有 `contentFingerprint`）；metadata-only 阶段不得猜测重复组。

非 HTTP 的企业 URI **不得靠路径相似度猜测重复**（SKILL.md 安全规则）。同名不同签名的文件是两个条目。

`duplicateGroupKey` 是云盘重复组的权威持久化字段：有合法 `fileSignature` 时写为 `sha256:<fileSignature>`，无签名时写为 `content:<contentFingerprint>`；在正文尚未物化时写为 `source:<sourceSkill>\n<sourceUrl>`，并标记 `duplicateGroupProvisional=true`。加载/恢复时，`collection-state.mjs` 的 `normalizeDuplicateGroups` 必须对 `sourceUrl` 以 `cloud-knowledge://` 开头的条目保留上述字段，不得按非 HTTP URI 再计算一遍；只有旧会话缺少该字段时才执行兼容回退。

重复组与 `sourceSkill + sourceUrl` 唯一键不冲突，但有个坑：URI 含 `resourceId`，所以跨库同签名文件的 URI 天然不同（`cloud-knowledge://1024/a.md` vs `cloud-knowledge://2048/a.md`），两条记录都能写进 inventory。**不要为重复组归一化 URI**——那会撞唯一键。重复关系记在条目字段里，不靠 URI 表达。正文物化后若从 provisional 组升级为 signature/content 组，必须在同一次 bundle 提交中同时更新所有当前 bundle 条目的 group key，并重建 canonical view；不能只更新单条。

为保持这一契约，`collection-state.mjs` 的 `reconcileCanonicalView` 和 `validateCanonicalView` 也必须识别 cloud 条目：云盘同一 `duplicateGroupKey` 的多个 materialized 条目全部保留，并分别对应自己的 `sanitizedPath`、`sourceUrl` 和 canonical item；现有“每个 duplicate group 只保留一个 canonical item”的公共兼容逻辑只适用于仍使用 URL 去重的来源。

`sourceUrl` 无 scheme 校验（只走 `requireNonEmptyString`），`cloud-knowledge://` 可用。

## 粒度判定

| 情况 | `contentGranularity` |
|---|---|
| `download` 成功，Markdown 或转换产物可读非空 | `full-text` |
| 转换成功但产物明显不完整（转换器报告部分失败） | `unknown` |
| 无可用内容 | 物化 `failed`，不写粒度 |
| 候选未选中（metadata-only 阶段） | 物化 `pending`，不写粒度 |

判定依据是 `download` 产物本身可读非空，**不需要 `fullTextEvidence` 回执**。[collection-state.mjs:848](../../middleware/openclaw/skills/knowledge-collection/scripts/collection-state.mjs#L848) 的证据校验门控在 `isPublicItem`（`source === 'public-internet'` 或存在 `discoveryCandidateId`），企业条目登记 `full-text` 不走这条分支。不要为云盘条目伪造回执。

不得在缺产物时默认 `full-text`。会话要求 `requiredContentGranularity=full-text` 时，`excerpt` / `abstract` / `unknown` 均不满足交付，`deliveryComplete=false`。

## 数量语义

V1 云盘路径的数量是**发现上限 + 报告口径**，不是交付闸门。

真正的数量闸门在 [delivery-state.mjs:82](../../middleware/openclaw/skills/knowledge-collection/scripts/delivery-state.mjs#L82)，读 `task.requestedItemCount`；该字段全仓只有 [probe-state.mjs:161](../../middleware/openclaw/skills/knowledge-collection/scripts/probe-state.mjs#L161) 一处写入，属 `public-collect` 路径。企业路径不设置它，`requestedCount` 恒为 0，数量检查整段跳过。云盘路径**不得**去设置这个字段——它同时要求 `promotionId` / `verificationReceipt` / `fullTextEvidence` / `verifiedTopicStatus` 四件套，企业侧一件都不产出（`scripts/enterprise/` 全目录零命中）。

数量检查既然恒被跳过，唯一还能反映「少交付」的信号就是会话状态本身。由此产生一条必须遵守的约束，写在「硬约束」里：**失败条目必须留在 inventory**。留着 → `deriveCollectionStatus` 判 `partial` → `deliveryCompleteForSession` 对 `partial` 返回 false，用户看得见缺口；丢弃 → inventory 全绿判 `complete` → `deliveryComplete=true`，用户要 5 篇拿到 3 篇而系统报告成功。

报告口径：覆盖缺口须写明「请求 N、命中 M、成功物化 K」，让用户自己判断是否够用。

## 终态与部分失败

先分清两个不同层级的字段，混用会直接抛异常：

| 字段 | 取值 | 校验 |
|---|---|---|
| `handledOutcome(connector, status, ...)` 的 `status` | `complete` / `partial` / `failed` / `auth_required` | 无枚举校验，`auth_required` 合法（见 [dingtalk.mjs:589](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/adapters/dingtalk.mjs#L589)） |
| bundle 的 `collectionStatus` | 只能 `complete` / `partial` / `failed` | [artifact-writer.mjs:775](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/shared/artifact-writer.mjs#L775) 抛 TypeError |

更关键的是：`collectionStatus` **不是可自由赋值的字段，而是推导后校验**。[artifact-writer.mjs:773-785](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/shared/artifact-writer.mjs#L773-L785) 先用 `deriveCollectionStatus` 从 inventory 推出 `derived`，给定值与 `derived` 不符就抛 `bundle.collectionStatus override contradicts inventory`（唯一例外：`partial` 覆盖 `derived=failed` 且 inventory 全 `pending`）。

失败原因有**两个互不替代的层级**，不要混成一个：

| 层级 | 载体 | 取值方式 | 谁看 |
|---|---|---|---|
| 会话终态 | `sourceMetadata.terminal = { status, reasonCode, reason }`，同时 outcome 上平铺 `reasonCode` / `reason` | `reasonCode` 取仓库既有枚举 `AUTH_REQUIRED` / `INVALID_RESPONSE` / `SOURCE_FAILED`（[references/sources/ima.md:21](../../middleware/openclaw/skills/knowledge-collection/references/sources/ima.md) 定为策略，实现见 [ima.mjs:819-856](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/adapters/ima.mjs#L819-L856)） | 调用方 / Agent 决定下一步 |
| 条目失败 | `materialization.reason` | 自由文本，无枚举校验（[fws.mjs:114](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/adapters/fws.mjs#L114)，值由 [fws.mjs:18](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/adapters/fws.mjs#L18) 的 `reasonOf(error)` 取 `error.message`） | 人排查单条 |

`terminal.reasonCode` **只能取上面三个既有值**。本设计约定的 `UNSUPPORTED_FORMAT:` / `SOURCE_TOO_LARGE:` / `SOURCE_NOT_AUTHORIZED_BY_DISCOVERY:` 是**条目级 `materialization.reason` 的 message 前缀**，不是仓库常量，也**不得**出现在 `terminal.reasonCode` 里——把条目原因塞进会话终态码，调用方会把「一篇 PDF 太大」当成整次采集失败。

`handledOutcome` 本身**不含** `reasonCode` 字段（[status-model.mjs:80-94](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/shared/status-model.mjs#L80-L94) 只返回 `connector`/`status`/`outputDir`/`continuable`/`counts`），所以要照 ima 的做法在返回时展开补上。

所以认证失效的正确写法是**让 `failed` 被推导出来，同时把 terminal 写进 bundle**：

```js
const terminal = { status: 'auth_required', reasonCode: 'AUTH_REQUIRED', reason: reasonOf(error) };
await writer.writeCollectionBundle({
  discoverySucceeded: false,   // 关键：不给这个，空 inventory 推出 'complete'，再写 failed 会抛异常
  inventory: [],
  canonicalItems: [],
  // 不必再给 collectionStatus，推导结果就是 'failed'
});
// terminal 随 raw/metadata.json 的 sourceMetadata 一起落盘（照 ima.mjs:754-782 的 persistSearch）
return {
  ...handledOutcome(identity.connector, 'auth_required', outputDir, { failed: 0 }),
  reasonCode: terminal.reasonCode,
  reason: terminal.reason,
};
```

`reasonOf` 是 [ima.mjs:25-27](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/adapters/ima.mjs#L25-L27) 的**本地 helper**（`error instanceof Error ? error.message : String(error)`），不是 `shared/` 的导出——云盘 adapter 里自己写一个同名函数，不要去 import。

`reason` 取 `error.message`，**不得**带上任何认证数据；需要登录时只提示用户去云盘前端完成登录，不读、不回显凭据。

**不要把 `auth_required` 写进 bundle 的 `collectionStatus`，也不要试图用 `collectionStatus` 强行覆盖推导结果**——`terminal.status` 才是承载 `auth_required` 的地方。

下表第三列是**推导出来的**结果（靠 `discoverySucceeded` 与 inventory 状态控制），不是可以直接写的值：

| 情况 | outcome / `terminal.status` | 推出的 `collectionStatus` | 怎么让它推出来 | 原因载体 |
|---|---|---|---|---|
| 登录/授权失效 | `auth_required` | `failed` | `discoverySucceeded: false` | `terminal.reasonCode='AUTH_REQUIRED'` |
| CLI 返回无效 JSON 或 `{ok:false}` | `failed` | `failed` | `discoverySucceeded: false` | `terminal.reasonCode='INVALID_RESPONSE'` |
| 全部资源检索失败 | `failed` | `failed` | `discoverySucceeded: false` | `terminal.reasonCode='SOURCE_FAILED'` |
| 部分目录分组失败 | `partial` | `partial` | adapter 将分组失败映射为 `paginationFailed: true`，并保留成功分组的条目 | `terminal.reasonCode='SOURCE_FAILED'` + 分组 `reason` |
| 格式不受支持 | 条目级，不产生 terminal | 由整体推导 | 该条目 `status='failed'` | `materialization.reason` 以 `UNSUPPORTED_FORMAT:` 开头 |
| 超过字节上限 | 条目级，不产生 terminal | 由整体推导 | 该条目 `status='failed'` | `materialization.reason` 以 `SOURCE_TOO_LARGE:` 开头 |
| 授权集外 | 条目级，不产生 terminal | 由整体推导 | 该条目 `status='failed'` | `materialization.reason` 以 `SOURCE_NOT_AUTHORIZED_BY_DISCOVERY:` 开头 |

`materialization` 的完整字段（照 [fws.mjs:109-115](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/adapters/fws.mjs#L109-L115)）：

```js
materialization: {
  status,                      // 'materialized' | 'pending' | 'failed'
  markdownPath,                // 失败时 null
  sanitizedPath,               // 失败时 null
  pendingArtifactCleanup: [],  // 可省（`?? []` 兜底），但照 fws 写显式空数组
  reason,                      // 自由文本
}
```

### 云盘候选的跨阶段 schema

云盘 adapter 不直接依赖通用 `readResumeCandidates` 的隐式字段投影。新增一个明确的 cloud candidate projection，或扩展该共享函数的 source-specific 分支；两者都必须满足以下往返契约：`search` 写入 `sanitized/metadata.json` 的字段，在 `readResumeCandidates` 返回值中仍保持原类型和原值：

```js
{
  itemId: 'cloud-…',
  resourceId: 1024,
  filePath: '/运维/巡检手册.pdf',
  originalFileName: '巡检手册.pdf',
  fileType: 'pdf',
  fileSize: 123456,
  fileSignature: 'aabb…',
  duplicateGroupKey: 'sha256:aabb…',
  duplicateGroupProvisional: false,
  sourceUrl: 'cloud-knowledge://1024/运维/巡检手册.pdf',
  rawArtifacts: ['raw/search-file-…json'],
  materialization: { status: 'pending', markdownPath: null, sanitizedPath: null }
}
```

`resourceId`、`filePath`、`fileType`、`fileSize` 和 `sourceUrl` 是物化必需字段；`fileSignature` 缺失可以触发 provisional 去重，但不得导致授权字段缺失时放行。任一必需字段缺失、类型错误或与 `sourceUrl` 中的 resource/path 不一致，`materialize` 在取得 writer 和调用下载 CLI 之前直接拒绝，并保持会话文件和目录内容不变。不能通过再次 `search-file` 补字段，因为那会改变用户已经确认的候选集合。

`fileType` 的规范值为小写、无前导点的扩展名；`fileSize` 必须是非负安全整数；`resourceId` 必须是正安全整数；`fileSignature` 如存在必须是小写十六进制 SHA-256。后端 metadata 嵌套对象的解包规则必须固定并在 adapter 中测试，不能用“取第一个 value”之类的模糊启发式。

**写出 failed bundle 会让这个会话目录彻底不可复用，实现方必须知道这一点。** [artifact-writer.mjs:999](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/shared/artifact-writer.mjs#L999) 把 `task.status` 置为 `failed`，而 [openInitializedSessionRoot 340-350](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/shared/artifact-writer.mjs#L340-L350) 的两条准入分支只认 `initialized`（且 inventory 为空）与 `collected`（且 `publicationStatus='committed'`）；`failed` 两条都不满足，于是再跑 `enterprise search` 或 `materialize` 一律抛 `output root must not already exist unless it is an empty initialized collection session`。

因此重试语义是：**登录失败后不能原地重试，必须重新 `init` 到新的会话目录**。这跟 `uncommitted` 的自愈是两回事——`uncommitted` 能被 `recoverInterruptedBundle` 恢复，`failed` 是已提交的终态，没有回退路径。Agent 侧提示语要写清「请在云盘前端完成登录后重新发起采集」，而不是「重试上一条命令」，否则用户会连撞几次同一个异常并误判为 bug。

与之形成对照的是 `abort()` 路径，两者结果完全不同，实现时不要混：

| 失败处置 | 会话残留状态 | 能否原地重试 |
|---|---|---|
| 写出 failed bundle | `task.status='failed'` | **不能**，准入分支两条都不满足 |
| `await writer.abort()` | 保持进入命令前的状态不变 | 能 |

`abort()` 不回滚状态、也不回滚已写文件，只是不再往前推进：检索阶段 abort 则停在 `init` 留下的 `initialized`（走 `emptyInitialized` 分支重进），物化阶段 abort 则停在检索 bundle 的 `collected` + `committed`（走 `committedCollection` 分支重进）。两种都能原地重跑。

`abort()` 之所以不删目录，是因为 [artifact-writer.mjs:865](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/shared/artifact-writer.mjs#L865) 的 `ownsRoot = !initializedRoot`：云盘路径的根一定由 `init` 预先建好，`initializedRoot` 为真 → `ownsRoot=false` → [934 行](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/shared/artifact-writer.mjs#L934) 的 `removeOwnedPath` 不执行，只释放锁。

这里有个容易走偏的地方：既然 `abort()` 能保住会话，实现者很可能觉得认证失败用 `abort()` 更友好。**不行**——[references/sources/ima.md:21](../../middleware/openclaw/skills/knowledge-collection/references/sources/ima.md) 要求所有终态失败都写出完整 bundle，不得留下仅 `initialized` 的会话。`abort()` 只用于**非终态的意外异常**（照 [ima.mjs:889-892](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/adapters/ima.mjs#L889-L892) 的 `materialize` catch：`abort()` 后原样 `throw`，让调用方看到异常栈），认证失效、无效响应、全资源失败这三类必须走 bundle。「会话不可原地重试」是这条策略的既定代价，不是实现可以自行优化掉的缺陷。

### materialize 是一次性的，两步流没有第二次机会

这是两步流最关键的约束，也是最容易在实现时想当然的地方。`materialize` **每个会话只能成功执行一次**，机制是：

1. [artifact-writer.mjs:1005](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/shared/artifact-writer.mjs#L1005) 每次写 bundle 都覆盖 `sanitized/metadata.json`，其中 `metadataOnly` 取自本次 bundle（[770 行](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/shared/artifact-writer.mjs#L770)）。
2. `materialize` 的 bundle 是 `metadataOnly: false`（照 [ima.mjs:886](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/adapters/ima.mjs#L886)），于是检索阶段那份 `metadataOnly: true` 被抹掉。
3. [resume.mjs:56-57](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/shared/resume.mjs#L56-L57) 读的正是 `sanitized/metadata.json`，要求 `metadataOnly === true`，否则抛 `resume session is not a metadata-only cloud-knowledge discovery`。

所以第二次 `materialize` 一律被拒，**与第一次的结果无关**——成功、部分成功、全失败都一样。再叠加「bundle inventory = 选中集合」这条规则（未选中候选不写进 bundle），未选中的候选记录在第一次物化后就从 `sanitized/metadata.json` 里消失了，也无从再选。

由此得到 V1 两步流的真实语义，必须原样告知用户：

| 第一次 materialize 的结果 | `task.status` | 后续可做 |
|---|---|---|
| 全部成功 | `collected` | `publish` 正常 |
| 部分成功 | `collected` | **`publish` 被拒**（`partial` → `deliveryCompleteForSession` 返回 false），且无法补物化 |
| 全部失败 | `failed` | 任何命令被拒 |

**一次失败条目就足以让整个会话无法交付，且不可修补。** 这不是缺陷推测，是 `deriveCollectionStatus`（[status-model.mjs:75-77](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/shared/status-model.mjs#L75-L77)：`materialized === 0` → `failed`，有失败条目 → `partial`）与 `resume.mjs` 一次性判定叠加出的既有行为。V1 不改动它（改动面涉及企业侧共享层，超出本设计范围），但必须靠两件事把风险前移：

- **物化前预筛。** 格式不在白名单、`fileSize` 超 50 MiB 的候选，在下发 `--item-ids` 之前就拦下并提示用户改选。这不是优化，是唯一的防线——放它进物化就是让整个会话报废。
- **选择时告知代价。** 让用户在第二步选择时就知道「这一次选定即定稿，选中的任一条目失败会导致本次采集无法交付，需从检索重来」，而不是等失败后才发现。

失败后的提示语要写明「需重新发起检索（`init` 到新会话目录 + 重跑 `search`）」，并附逐条 `materialization.reason`，让用户下一轮能避开同样的条目。切勿提示「重试上一条命令」。

`abort()` 后已写进 `raw/` 的文件（检索响应、已下载的原始文件）会留下来，但不影响下次准入——[准入判定](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/shared/artifact-writer.mjs#L340-L343) 只看 `task.status` / `publicationStatus` / inventory 条目数，不看 `raw/` 内容。重试时 `search-file-<hash>.json` 同名覆盖，`download/<itemId>/` 下的孤儿文件不会被列进新一轮的 `rawArtifacts`，属惰性残留。

多目录分组部分失败时：记录非敏感失败原因、继续其他分组、在覆盖缺口报告失败分组。只要至少一个分组检索成功就**写出 bundle**（`discoverySucceeded: true`），而不是崩溃退出；同一分组内多个 `resourceId` 按 all-or-nothing 处理。由于共享 `deriveCollectionStatus` 不认识独立的分组失败字段，adapter 必须把“至少一个分组失败”映射为 `paginationFailed: true`，使状态稳定推导为 `partial`；全部分组检索失败才 `discoverySucceeded: false` → `failed`。

条目级失败必须以 `materialization.status=failed` **留在 inventory**，不得丢弃——这是挡住静默少交付的唯一机制，`deriveCollectionStatus` 靠它把会话判为 `partial`，而 `deliveryCompleteForSession` 对 `partial` 直接返回 false。

与之相对，**未选中的候选不得进入 `materialize` 的 bundle inventory**。[status-model.mjs:77](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/shared/status-model.mjs#L77) 的判定是 `materialized === itemStates.length ? 'complete' : 'partial'`，而 `pending` 计入 `itemStates.length`——未选中候选留在里面会让会话永久 `partial`、`publish` 永久被拒。照 ima 的做法：`materialize` 的 inventory 只包含 `--item-ids` 选中的条目。

两条合起来是一条判据：**bundle inventory = 选中集合**，选中且失败的留下记 `failed`，未选中的不出现。

## inventory 与 canonicalItems 的校验契约

`writeCollectionBundle` 对这两个数组有硬校验，漏一条就抛异常。

**inventory 每条必填**（[artifact-writer.mjs:618-645](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/shared/artifact-writer.mjs#L618-L645)）：

- `itemId`、`sourceSkill`、`sourceUrl` 三个非空字符串；
- `rawArtifacts` 必须是字符串数组（可空数组，不能缺）；
- `materialization` 必须是对象，`status` ∈ `materialized|pending|failed`；
- `status === 'materialized'` 时 `markdownPath` 与 `sanitizedPath` 必须非空。

**两个唯一键**：`itemId` 全局唯一；`sourceSkill + sourceUrl` 组合全局唯一。后者与去重规则的交互见下节。

**除必填项外，云盘候选条目还必须显式携带以下字段**，否则两步流的物化前预筛无从实现：

| 字段 | 来源 | 预筛用途 |
|---|---|---|
| `fileType` | `--metadata-field fileType` | 判是否在可转换白名单内 |
| `fileSize` | `--metadata-field fileSize` | 判是否超 50 MiB |
| `filePath` | 系统属性 | 物化阶段复查是否仍在授权集内 |
| `resourceId` | 检索时的分组入参 | 同上，且供下载调用还原目标资源 |
| `fileSignature` | 系统属性 | 跨资源重复组归并 |

这条必须写死，因为 `inventoryItem` 在每个 adapter 里都是**显式字面量而非展开源对象**（见 [ima.mjs:271-301](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/adapters/ima.mjs#L271-L301) 逐字段列举 `kb` / `folderPath` / `preview` / `abstract` 等来源特有字段）。照抄 ima 的字段表会把云盘特有的五个字段全漏掉，而 [artifact-writer.mjs:684-685](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/shared/artifact-writer.mjs#L684-L685) 是 `{ ...item, ... }`，**额外字段能原样持久化**——所以要么现在显式列进去，要么两步流第二步永远只能靠下载失败兜底。

`readResumeCandidates` 必须通过 cloud-specific projection 返回 `sanitized/metadata.json` 中约定的云盘字段；它不是允许任意字段丢失的“原样读取”。**没在 metadata 中存下的字段在物化阶段拿不回来**（回头再查一次后端属性等于二次检索，既慢又可能与用户当时看到的候选不一致）。

候选阶段的 `materialization` 照 ima 填：`status: 'pending'`、两个路径 `null`、`contentGranularity: 'unknown'`、`reason` 给一句说明性文本（ima 用 `'discovery only; materialization is deferred'`）。这里的 `unknown` 是共享 contract 对未物化条目的规范化值，不表示已经取得任何正文。

**`canonicalItems` 与已物化条目双向一对一**（[artifact-writer.mjs:787-812](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/shared/artifact-writer.mjs#L787-L812)）：

| 校验 | 失败信息 |
|---|---|
| `canonicalItems[].fileName` 必须等于某条目的 `materialization.sanitizedPath` | `canonical item has no materialized inventory` |
| `canonicalItems[].url` 必须等于该条目的 `sourceUrl` | `canonical item URL does not match inventory` |
| 每个 `materialized` 条目都要有对应 canonical item | `materialized inventory has no canonical item` |
| `sanitizedPath` 在已物化条目间不得重复 | `inventory materialized sanitized path is duplicated` |

即：**canonicalItems 的条数恒等于 `materialized` 条目数**，`pending` 与 `failed` 条目不进 canonicalItems。云盘即使属于同一 `duplicateGroupKey`，也为每个 materialized inventory 保留独立 canonical item；重复组只用于统计和关联，不在 canonical view 层折叠。照 [ima.mjs:875](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/adapters/ima.mjs#L875) 的写法：

```js
const canonicalItems = inventory
  .filter((item) => item.materialization.status === 'materialized')
  .map((item) => ({
    title: item.title,
    url: item.sourceUrl,                              // 必须与 inventory 一致
    author: '', publishTime: '',
    markdown: item.materialization.sanitizedPath,
    fileName: item.materialization.sanitizedPath,     // 必须与 sanitizedPath 一致
  }));
```

metadata-only 检索阶段全部条目为 `pending`，故 `canonicalItems: []`。

有效空结果是成功，不得伪造记录。

所有终态都必须写出完整 bundle（`collectionStatus` ∈ `complete|partial|failed` + `publicationStatus=committed`），不留只 initialized 的会话。认证失效也要写，只是 `collectionStatus='failed'`。

## 需要改动的位置

### 1. 枚举放开（五处必须同步）

| 文件:行 | 位置 | 漏改后果 |
|---|---|---|
| [research-state.mjs:45](../../middleware/openclaw/skills/knowledge-collection/scripts/research-state.mjs#L45) | `SOURCE_SCOPES` 加 `cloud-knowledge` | `init --source-scope` 抛「仅支持 …」 |
| [knowledge-collection.mjs:364](../../middleware/openclaw/skills/knowledge-collection/scripts/knowledge-collection.mjs#L364) | `source-scope` 的 `items.enum` 加同值 | schema 校验拒绝 |
| [knowledge-collection.mjs:93](../../middleware/openclaw/skills/knowledge-collection/scripts/knowledge-collection.mjs#L93) | `--source-scope` 帮助文本 | 不阻断执行，但 Agent 读 `--help` 后不会用云盘 |
| [enterprise-collection.mjs:382](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise-collection.mjs#L382) | `commandSchema()` 的 `source` enum | 见下 |
| [enterprise-collection.mjs:405](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise-collection.mjs#L405) | `materialize` 的 `source` 收窄 enum（现为 `dingtalk|feishu|ima`） | 见下 |

前三处漏改直接让 `init` 失败。后两处是 **`command-schema` 输出的契约声明，运行时不校验**（[enterprise-collection.mjs:456-474](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise-collection.mjs#L456-L474) 的执行路径只做 `assertEnterpriseScope` 与 dispatcher 的 `SOURCES` 检查），但 Agent 是照 `command-schema` 决定发什么命令的——`materialize` 的 enum 里没有 `cloud-knowledge`，Agent 就永远不会发出第二步调用，两步式流程从 Agent 侧断掉。这是**声明层的闭环缺口，不是运行时报错**，排查起来比抛异常更费劲。

**`search-all` 整条路径对云盘不可用，必须显式拒绝，而不只是不进默认值。**

结构性原因是两条不变量互斥：

| 约束 | 来自 | 要求 |
|---|---|---|
| `search-all` 的会话树隔离 | [assertDistinctSessionTrees](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise-collection.mjs#L89-L101)（`first === second` 或互相嵌套即抛） | `--output-root` 与父会话树**不重叠** |
| 云盘的同会话不变量 | 授权集存在父会话的 `session.json` 里 | 产物必须落在**父会话内** |

ima 能同时活在两种模式下，是因为它的 `search` 走 `initialTaskContract`（[ima.mjs:789-793](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/adapters/ima.mjs#L789-L793)）让 writer **新建**一棵子会话树，并且 [assertImaParentContract](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise-collection.mjs#L126) 的 `outputDir` 形参默认 `null`——`search-all` 只传 3 个实参，输出逃逸检查被有意跳过，只留 query 检查。

云盘照不了这条路：新建的子会话根，其 task 来自 [enterpriseChildTaskContract](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise-collection.mjs#L116-L124)，而它只透传 `query` / `materializationTarget` / `requiredContentGranularity` / `deliveryRequested` **四个字段，不含 `sourceScope`，更不含 `cloudDiscoveryScope`**。子会话里没有授权集，越界校验无参照可比——要么硬失败，要么静默退化成无校验，后者正是本设计一直在防的那类缺口。

所以：`sources` 默认值（[401 行](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise-collection.mjs#L401)）**和** `items` 的 enum 都不要加 `cloud-knowledge`，并在 `parseSearchBatchRequests` 里对它给出明确错误（如「cloud-knowledge 不支持 search-all，请用单源 enterprise search」）。留着一条会静默丢授权集的可达路径，比不支持更糟。

若将来要支持，前置条件是让 `enterpriseChildTaskContract` 透传授权集，那会同时改动 dingtalk / feishu / wecom / ima 四个来源共用的契约——不在 V1 范围。

[artifact-writer.mjs:32](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/shared/artifact-writer.mjs#L32) 的 `SOURCE_SCOPE` 与 [collection-state.mjs:51](../../middleware/openclaw/skills/knowledge-collection/scripts/collection-state.mjs#L51) 的 `SOURCE_SCOPE_ALIAS` **都不需要改**：两处都是 `MAP[source] || source` 回落，`cloud-knowledge` 在 identity 与 scope 两侧同名，回落即正确。

### 2. init 新增参数

`--cloud-discovery-scope`（JSON，`cliEncoding: 'json'`）→ 写入 `task.cloudDiscoveryScope`。校验：非空数组、`resourceId` 为正整数、`directoryPath` 以 `/` 开头、`origin === 'user-input'`。仅当 `sourceScope` 含 `cloud-knowledge` 时接受，否则报错。

**字段名不得含 `token|cookie|secret|password|authorization|credential|device_code` 任一词根。** [secret-sanitizer.mjs:1](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/shared/secret-sanitizer.mjs#L1) 的 `SENSITIVE_KEY` 命中后，[secret-sanitizer.mjs:40](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/shared/secret-sanitizer.mjs#L40) 会在 `removeSensitiveFields` 里把整个键**删除**，而 `writePersistedJson` 每次持久化都跑这一步。用 `cloudAuthorization` 之类的名字会导致：`init` 写进去、adapter 读不到、越界校验静默退化为无校验。这比抛异常危险得多，所以命名是硬约束而非风格问题。

落盘要改**两个**地方，只改一个都不行：

| 改动点 | 不改的后果 |
|---|---|
| [knowledge-collection.mjs:347-374](../../middleware/openclaw/skills/knowledge-collection/scripts/knowledge-collection.mjs#L347-L374) `COMMAND_SPECS.init.properties` 加 `'cloud-discovery-scope'` | [knowledge-collection.mjs:578](../../middleware/openclaw/skills/knowledge-collection/scripts/knowledge-collection.mjs#L578) 的 `validateFlags` 抛「未知参数 --cloud-discovery-scope」，`init` 直接失败 |
| [research-state.mjs:619-648](../../middleware/openclaw/skills/knowledge-collection/scripts/research-state.mjs#L619-L648) 的 `session.task` 字面量加 `cloudDiscoveryScope` | flag 通过校验但**被静默丢弃**——`init` 报成功，adapter 读不到授权集，越界校验退化为无校验 |

第二行是关键坑：`init` 构造 task 用的是**逐字段字面量**，不是 `...args` 展开。参数解析通过 ≠ 字段落盘。`session.mjs` 的 `newSession` 确实用 `...task` 无白名单展开（[session.mjs:246](../../middleware/openclaw/skills/knowledge-collection/scripts/session.mjs#L246)），但那是企业 adapter 新建会话的路径，`init` 不走它——不要把两条路径的宽松度混淆。

建议照 `discoveryGate` 的写法条件写入（[research-state.mjs:641-647](../../middleware/openclaw/skills/knowledge-collection/scripts/research-state.mjs#L641-L647)）：

```js
...(effectiveSourceScope.includes('cloud-knowledge')
  ? { cloudDiscoveryScope: validateCloudDiscoveryScope(args['cloud-discovery-scope']) }
  : {}),
```

写入后必须回读确认：`init` 完成后 `session.json` 的 `task.cloudDiscoveryScope` 存在且 `resources` 非空。这是唯一能同时挡住「字面量漏改」与「字段名撞 `SENSITIVE_KEY`」两个静默失败的检查，列入验收。

### 3. dispatcher 注册

```js
// scripts/enterprise/dispatcher.mjs
const ENTERPRISE_SOURCES = new Set(['dingtalk', 'feishu', 'wecom', 'ima', 'cloud-knowledge']);
const SEARCH_ALL_SOURCES = new Set(['dingtalk', 'feishu', 'wecom', 'ima']);
const SEARCH_ALL_DEFAULT_SOURCES = ['dingtalk', 'feishu', 'wecom', 'ima'];
const SEARCH_OPTIONS = {
  // ...
  'cloud-knowledge': new Map(),   // V1 无 source-options
};
const RESOURCE_OPTIONS = {
  // ...
  'cloud-knowledge': new Map(),   // V1 不支持单 URL 直采
};
```

单源合法性、search-all 可用来源和 search-all 默认来源必须使用上面三个独立定义；不能再让一个 `SOURCES` 同时承担三种语义。`parseSource` 使用 `ENTERPRISE_SOURCES`，`parseSearchBatchRequests` 使用 `SEARCH_ALL_SOURCES` 和固定 `SEARCH_ALL_DEFAULT_SOURCES`。显式 `--sources cloud-knowledge` 或任何含该值的混合列表在解析阶段立即报错并提示使用单源 `enterprise search`；不得创建子会话、调用 adapter 或写 aggregate bundle。

`SEARCH_OPTIONS` 必须是**空 Map**。注册 `file-types` 之类的 flag 等于把格式白名单交给 Agent 现场决定，与「固定白名单、V1 只生成两种 DSL 形态」直接冲突：白名单的作用是保证命中的都是能转成 Markdown 的格式，可放宽就等于可让不可转格式进入发现，物化阶段批量 `UNSUPPORTED_FORMAT`。目录范围同理——它来自授权集，不来自命令行。[dispatcher.mjs:145](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/dispatcher.mjs#L145) 的 `parseOptions` 用闭集校验，空 Map 即可让 `--file-types` 直接被拒。

授权集**不经命令行传递**。`parseSearchRequest` 的 `allowed` 是闭集，注册新 flag 会把 `resourceId` 暴露在命令行，且要多一次一致性校验。adapter 直接从 `--output-dir` 指向的 `session.json` 读 `task.cloudDiscoveryScope`——授权集本来就是会话状态。

三处 ima-only 的硬编码判断要覆盖 `cloud-knowledge`，否则要么被拒、要么失去保护：

| 位置 | 现状 | 需要 |
|---|---|---|
| [dispatcher.mjs:134](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/dispatcher.mjs#L134) | `sessionDir === outputDir` 只校验 ima | 加 `cloud-knowledge`，否则同会话不变量无人执行 |
| [dispatcher.mjs:123](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/dispatcher.mjs#L123) | `materialize` 显式拒 wecom | 确认 `cloud-knowledge` 在放行侧 |
| [enterprise-collection.mjs:126](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise-collection.mjs#L126) `assertImaParentContract` | 只防 ima 的 query 漂移与输出逃逸 | 需要 cloud 等价物，否则子调用可改写主题 |

**写出等价函数还不够，两个调用点都按 `source === 'ima'` 硬编码，不放开就等于没写：**

| 调用点 | 现状 | 漏改后果 |
|---|---|---|
| [enterprise-collection.mjs:463](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise-collection.mjs#L463) | `if (command === 'search' && source === 'ima')` | 单源 `search` 不做 query 一致性检查，验收 28 直接失效 |
[485 行](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise-collection.mjs#L485) 的 `if (sources.includes('ima'))` **不需要**放开——`search-all` 对云盘整条关闭（见上节），云盘根本到不了这里。反过来说，如果实现时顺手把 `cloud-knowledge` 加进了 `items` enum，这一行就变成了绕过口：请求会通过批量路径进入、拿着不含授权集的子会话 task 去跑越界校验。两处要么一起关，要么一起开，不能只开一处。

同一行 463 附近的 `dispatchOptions = { taskContract: enterpriseChildTaskContract(parentSession) }`（[470 行](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise-collection.mjs#L470)）**不必**为云盘照搬：云盘的会话根由 `init` 预先建好，`createArtifactWriter` 走 `initializedRoot` 分支，`initialTaskContract` 不参与建根，传了也是死参数。只放开 query 检查那一半。

`defaultAdapters()` 加：

```js
'cloud-knowledge': createCloudKnowledgeAdapter({
  python: process.env.PYTHON_BIN || 'python3',
  script: process.env.CLOUD_KNOWLEDGE_CLI || <project-cloud-knowledge/scripts/project_cloud_knowledge.py>,
  env: process.env,
}),
```

### 4. 新增 adapter

`scripts/enterprise/adapters/cloud-knowledge.mjs`，实现 `search` 与 `materialize` 两个方法（V1 不实现 `collectResource` / `resumeResource`，dispatcher 会自动回落到 `unsupported_capability`）。

adapter 必须拥有以下唯一责任函数，避免各阶段自行拼接路径或错误：`validateCloudRemotePath`、`isAuthorizedCloudPath`、`cloudCandidateFromRecord`、`projectCloudResumeCandidate`、`safeDownloadTarget`、`classifyCloudFailure`。所有函数均 fail-closed；缺少授权集、候选关键字段、合法路径或可识别响应时抛出明确错误，不以空数组或默认值代替。

两个方法的分工照 [ima.mjs](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/adapters/ima.mjs)：

- `search`：调 `search-file`，写候选 inventory（状态 `pending`）+ `sourceMetadata.metadataOnly=true`，**不下载**。
- `materialize`：`readResumeCandidates` 取出选中候选 → **预筛** → 逐条 `download` → 转换 → 写 bundle（`metadataOnly: false`）。

`search` 的 CLI 调用按 `directoryPath` 分组后必须保留输入分组顺序执行或并发后按该顺序归并；每个命中条目都先通过 `validateCloudRemotePath` 和授权集检查。`materialize` 必须从候选的 `resourceId`/`filePath` 生成 download 参数，不能使用用户命令行重新传入的资源或路径。

**预筛必须放在 adapter 的 `materialize` 里，且在 `createArtifactWriter` 之前。** 位置不是风格问题：

| 放这儿 | 后果 |
|---|---|
| dispatcher | 做不到。`parseMaterializeRequest` 只解析命令行，手上没有候选元数据 |
| `createArtifactWriter` 之后 | 能用（抛异常落进 ima 式 catch → `abort()` → 会话保留），但白拿一次会话锁，且 `abort()` 的前置状态判断多一层不必要的耦合 |
| `readResumeCandidates` 之后、`createArtifactWriter` 之前 | **推荐**。候选只需 `sessionDir` 就能读，此时抛出既不建 writer 也不取锁，会话零改动 |

注意这与 ima 的语句顺序相反——ima 是先 `createArtifactWriter`（[868 行](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/adapters/ima.mjs#L868)）再 `readResumeCandidates`（[870 行](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/adapters/ima.mjs#L870)），因为它的 `copyResumeArtifacts` 需要 writer。云盘要把「读候选 + 预筛」这段提到建 writer 之前，剩下的复制与下载再照 ima。

错误形态照 `resume.mjs` 既有做法：**直接 `throw new Error(...)`，不写 bundle、不返回 outcome**。这与 `--item-ids` 传了非候选 id 时的行为（[resume.mjs:61-63](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/shared/resume.mjs#L61-L63) 抛 `one or more --item-ids are not candidates in the resume session` / `only pending metadata-only candidates can be materialized`）同一形态——都是入参不合法，不是采集失败，所以**不受「终态失败必须写完整 bundle」策略约束**。异常信息要列出被拒条目的 `itemId` 与原因（格式/超限）并给出实际值，让用户直接知道改选哪几条。

复用 `shared/` 下全部现成件：`artifact-writer`、`cli-runner`、`status-model`、`retry`、`secret-sanitizer`、`resume`。

### 错误、分组和排序契约

云盘 CLI 的错误处理必须区分“调用失败”和“成功响应中的部分资源失败”。当前 CLI 输出没有逐资源 failure 字段，因此 V1 将一次分组调用定义为 all-or-nothing：调用返回非零、无效 JSON 或 `ok:false` 时，整组记为失败；成功响应中的空结果是成功，不代表失败。若后续 CLI 增加逐资源 outcome，只有在字段包含 `resourceId`、`status`、`reasonCode`、`reason` 且通过 schema 校验后，才允许恢复逐资源失败报告。

多分组结果必须按以下确定性规则合并：先按调用分组的 `directoryPath` 字典序排序（`/` 最后），组内保留后端返回顺序；若响应提供数值 `score`，整体按 score 降序、`resourceId` 升序、`filePath` 升序、`itemId` 升序排序；没有 score 时按 `directoryPath`、`resourceId`、`filePath`、`itemId` 排序。最后才执行全局 `limit` 截断。adapter 必须记录 `groupsRequested`、`groupsSucceeded`、`groupsFailed`、`rawMatches`、`uniqueMatches`、`returnedMatches` 和 `limitReached`，并保证并发完成顺序不会影响输出。

所有可持久化错误都经过 `classifyCloudFailure`：对外只允许 `AUTH_REQUIRED`、`INVALID_RESPONSE`、`SOURCE_FAILED` 三种 terminal reasonCode；条目级允许固定前缀 `UNSUPPORTED_FORMAT:`、`SOURCE_TOO_LARGE:`、`SOURCE_NOT_AUTHORIZED_BY_DISCOVERY:`、`SOURCE_DOWNLOAD_FAILED:`、`SOURCE_CONVERSION_FAILED:`。reason 只包含截断后的非敏感摘要、HTTP 状态和阶段，不保存完整 stdout/stderr、后端 response body、命令行参数或环境变量。错误分类器必须先移除 Bearer、token、cookie、authorization 等值，再截断到固定长度；原始诊断文件也只能保存经 `secret-sanitizer` 处理的结构化字段。

`status-model.mjs` 的 `SOURCE_IDENTITY` 加一项：

```js
'cloud-knowledge': {
  connector: 'cloud-knowledge',
  source: 'cloud-knowledge',
  backend: 'project-cloud-knowledge',
  sourceSkill: 'project-cloud-knowledge',
},
```

`source` 必须**逐字等于** `--source` 的取值与 `sourceScope` 的枚举值（都是 `cloud-knowledge`）：`assertEnterpriseScope` 直接拿 `--source` 比 `task.sourceScope`，[artifact-writer.mjs:973](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/shared/artifact-writer.mjs#L973) 与 [collection-state.mjs:786](../../middleware/openclaw/skills/knowledge-collection/scripts/collection-state.mjs#L786) 又都靠 `MAP[source] || source` 回落。三者同名是「不必改两张映射表」的前提，别为求好看给 identity 换名。

`backend` / `sourceSkill` 填技能名而非 CLI 二进制名，**是有意偏离**既有约定（dingtalk→`dws`、ima→`bycli` 都填二进制名）：云盘没有专用二进制，入口是技能自带的 Python 脚本，填 `python3` 无法区分来源。**这两个值一旦有数据就不能再改**——`sourceSkill` 进 `sourceSkill + sourceUrl` 唯一键，改名会让历史条目与新条目互不去重。定了就锁死。

### 5. 文档

- 新增 `references/sources/cloud-knowledge.md`，格式对齐 `ima.md`。
- `SKILL.md` 意图路由表加一行：用户给出云盘地址 / `cloudResourceId` → `sourceScope` 加 `cloud-knowledge`。
- `references/manifest.json` 登记新参考文件。

## 硬约束

**失败条目必须留在 inventory。** 见「数量语义」。丢弃失败条目会让会话从 `partial` 变 `complete`，静默少交付。

**会话锁不用自己实现。** [artifact-writer.mjs:834](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/shared/artifact-writer.mjs#L834) 的 `createArtifactWriter` 自己 `acquireSessionLock`，并在失败路径释放。走 `createArtifactWriter` 就有锁，adapter 不要另造一套。

**`--session-id` 只给写命令。** `search-file` 与 `download` 都不在 [SESSION_AWARE_COMMANDS](../../middleware/openclaw/skills/project-cloud-knowledge/scripts/project_cloud_knowledge.py#L25) 里，argparse 会当未知参数拒绝。采集阶段一律不传。

**采集期间不允许根 Agent 直连 Python CLI。** 所有云盘调用经 adapter，否则产物不落 contract、状态不进 `session.json`，`deliveryComplete` 判定失真。与「网页只能走 `acquire-web`」同一条铁律。

**不绕过 CLI。** CLI 返回 `{ok:false,error}` 时修正输入或环境，不改调后端接口。

**凭据零泄漏。** 认证数据不得进入命令行参数、快照、`session.json` 或日志。沿用 `secret-sanitizer` 与 dispatcher 的 `SENSITIVE_KEY` 拦截。

**路径原样保留。** 云盘内绝对路径（`/`、`/产品资料`、`/产品资料/a.md`）不做重写或拼接。

## 验收

1. 单资源 + 主题词 → 检索命中、下载、`sanitized/items/` 出现可读非空 Markdown、`deliveryComplete=true`。
2. 多资源（≥2 个不同 `resourceId`，其中一个带子目录）→ 目录收窄生效，跨库结果合并，`fileSignature` 相同的文件归入同一重复组。
3. 授权集外的 `resourceId` 或路径 → `SOURCE_NOT_AUTHORIZED_BY_DISCOVERY`。两阶段各有一条用例：stub CLI 在 `search` 阶段返回越界路径 → 该条目不进候选、计入覆盖缺口；手改 `session.json` 候选路径后调 `materialize` → 该条目 `failed` + 对应 `reason` 前缀，其余条目照常物化。
3b. 授权 `/运维`、stub 返回 `/运维备份/x.md` → 判越界（按段比较，非 `startsWith`）。
4. 一个目录分组调用失败、另一个分组调用成功 → 成功 bundle，失败分组出现在覆盖缺口；同一分组内的多个 resourceId 按 all-or-nothing 处理。
5. 全部资源失败 → `collection.status=failed`，bundle 完整。
6. 空结果 → 成功且条目数 0，无伪造记录。
7. `.pdf` / `.docx` 命中 → 经转换写入，粒度 `full-text`。
8. 非白名单格式 → 不进入发现；强制注入时物化 `failed` + `UNSUPPORTED_FORMAT`。
9. `requiredContentGranularity=full-text` 且存在 `unknown` 条目 → `deliveryComplete=false`，`publish` 被拒。
10. `--limit 5` 命中 5 条、其中 2 条下载失败 → inventory 仍 5 条（3 `materialized` + 2 `failed`），`collection.status=partial`，`deliveryComplete=false`，覆盖缺口写明「请求 5、命中 5、成功物化 3」。
11. `--session-dir` 与 `--output-dir` 不同 → dispatcher 拒绝。
12. 子调用 `--query` 与父会话主题不一致 → 拒绝（query 漂移防护）。
13. 云盘条目登记 `full-text` 且无 `fullTextEvidence` → 登记成功，不报错。
14. `search --metadata-only` 后 `materialize --item-ids` → 成功；候选条目状态为 `pending`，`sourceMetadata.metadataOnly=true`。
15. `enterprise search --source cloud-knowledge --metadata-only false` → 在调用 adapter 前明确拒绝；云盘不允许生成非 metadata-only 会话。
16. `materialize --item-ids` 传入非候选 id 或已物化条目 → 拒绝（`resume.mjs` 既有校验）。
17. 多资源分组调用合并后条目数 > `--limit` → 截断到 `limit`。
18. 检索出 10 条候选、只选 3 条物化 → `materialize` bundle inventory 恰为 3 条，会话 `complete`，`publish` 通过；剩余 7 条 `pending` 不进 bundle。
19. 认证失效 → bundle 带 `discoverySucceeded:false` + 空 inventory 写出，推导状态 `failed`，outcome 返回 `auth_required` 且平铺 `reasonCode='AUTH_REQUIRED'`；`raw/metadata.json` 的 `sourceMetadata.terminal` 三字段齐备；不出现 `override contradicts inventory` 异常；`reason` 里不含任何凭据字样。
20. `canonicalItems` 条数恒等于 `materialized` 条目数；`pending` / `failed` 条目不出现在 canonicalItems。
21. 跨 `resourceId` 同 `fileSignature` 的两个文件 → 两条 inventory 记录，URI 各含自身 `resourceId`，不撞 `sourceSkill + sourceUrl` 唯一键；重新 load 后仍共享同一 `duplicateGroupKey`，canonicalItems 仍保持两条。
22. metadata-only 检索阶段的 bundle → `canonicalItems: []`，全部条目 `pending`，会话 `complete`（`metadataOnly=true` 走 [status-model.mjs:71](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/shared/status-model.mjs#L71) 分支）。
23. `init --cloud-discovery-scope` 后**重新读取** `session.json`，`task.cloudDiscoveryScope` 仍完整存在——这条专门守 sanitizer 删键，必须是读回校验而非写入校验。
24. bundle 写入中途被打断（`publicationStatus` 停在 `uncommitted`）→ `status` / `publish` 抛「bundle 未提交完成」（[session.mjs:294](../../middleware/openclaw/skills/knowledge-collection/scripts/session.mjs#L294)）；再跑一次 `enterprise search` 或 `materialize` 则**自愈**：[artifact-writer.mjs:333](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise/shared/artifact-writer.mjs#L333) 的 `recoverInterruptedBundle` 在 `loadSession` 之前从备份恢复。两种行为都要有用例——不要把「命令报错」当成会话已损坏。
25. `enterprise-collection.mjs command-schema` 输出里，`search.properties.source.enum` 与 `materialize.properties.source.enum` 都含 `cloud-knowledge`，且 `search-all.properties.sources.default` **不含**它。这条守的是声明层：缺 `materialize` 那项不会报错，只会让 Agent 永不发起第二步。schema 的 `search` 命令增加 source-specific 说明：云盘省略 `--metadata-only` 时由 dispatcher 强制 true，显式 false 不合法；实现测试必须覆盖省略参数和显式 true 两条成功路径。
26. `sourceScope` 不含 `cloud-knowledge` 时传 `--cloud-discovery-scope` → `init` 报错，不静默接受。
27. `enterprise search --source cloud-knowledge --file-types md` → dispatcher 拒绝（`SEARCH_OPTIONS` 空 Map），格式白名单不可从命令行放宽；显式 `--metadata-only false` 同样被拒绝。
28. `enterprise search --query` 与 `init --query` 不一致 → 拒绝，报 query 漂移。仅首尾空白被 trim 归一；**大小写差异算不一致**（判据是 trim 后的严格 `!==`，不折叠大小写）。
29. 检索零命中 → `search-file-<hash>.json` 仍落盘为合法非空 JSON，bundle 写出成功（条目数 0）。这条守的是 `rawArtifacts` 的非空文件校验，不落盘会抛 `must point to a non-empty regular file`。
30. metadata-only 阶段候选条目的 `rawArtifacts` 只含检索响应，不含 `download/` 下路径；`materialize` 后选中条目的 `rawArtifacts` 追加下载物且文件确实存在。
31. 写出 failed bundle 后在**同一会话目录**再调 `enterprise search` 或 `materialize` → 抛 `output root must not already exist unless it is an empty initialized collection session`；换新 `init` 目录后同样参数成功。这条守的是「failed 不可原地重试」，与用例 24 的 `uncommitted` 自愈成对，不要写成同一个期望。
32. 条目级失败（格式不支持 / 超限 / 越界）→ `materialization.reason` 带对应前缀，而 `sourceMetadata.terminal` **不出现**（或 `reasonCode` 不取这三个前缀）。这条守的是两层原因不串味。
33. `raw/metadata.json` 落在 `raw/` 根级，不存在 `raw/cloud-knowledge/` 目录——与其余五个 adapter 的路径约定一致。
34. 两步流跑完后 `raw/metadata.json` 仍是检索阶段那份（含 `operation:'search'` 与 `metadataOnly:true`），未被 `materialize` 覆盖。
35. `materialize` 过程中抛非终态异常（stub CLI 在下载中途抛）→ `abort()` 后异常透出，会话仍停在检索阶段的 `collected` + `committed`，**同一目录**重跑 `materialize` 成功。这条与用例 31 配对，守的是 `abort` 与 failed bundle 结果不同；实现若把认证失效改走 `abort()` 就会让用例 19 挂掉。
36. 选 3 篇、1 成 2 败 → `partial` / `task.status='collected'`，`publish` 被拒；选 2 篇、全败 → `failed` / `task.status='failed'`，任何后续命令被拒。两种提示语都含「需重新发起检索」与逐条失败原因，都**不得**提示「重试上一条命令」。
37. **`materialize` 一次性**：第一次成功物化后再调 `materialize`（无论换不换 `--item-ids`、无论第一次是 `complete` 还是 `partial`）→ 抛 `resume session is not a metadata-only cloud-knowledge discovery`。三种第一次结果各一条断言。这条守的是「未选中候选在首次物化后不可再取」，实现若试图保留检索期 `metadata.json` 来绕过，会破坏 `resume.mjs` 的一次性语义。
38. 物化前预筛：`--item-ids` 含非白名单格式或 `fileSize` 超 50 MiB 的候选 → 在发起下载**之前**抛异常，异常信息含被拒 `itemId` 与实际值；会话保持在 `collected` + `committed`（不写 bundle、不置 `failed`），同目录改选后重跑 `materialize` 成功。这条守的是唯一防线；缺了它用例 36 的代价就会真实发生。
39. 候选条目回读校验：`search --metadata-only` 后从 `sanitized/metadata.json` 读回任一候选，再经 `readResumeCandidates` 读回，`fileType` / `fileSize` / `filePath` / `resourceId` / `fileSignature` 五个字段齐备。这条守的是 `inventoryItem` 显式字面量和恢复 projection 漏字段——漏了不报错，只会让用例 38 无从实现。
40. query 漂移检查在单源路径上覆盖云盘：`enterprise search --source cloud-knowledge` 且 `--query` 与父会话不一致 → 被拒（守 [463 行](../../middleware/openclaw/skills/knowledge-collection/scripts/enterprise-collection.mjs#L463) 的调用点放开）。
41. `enterprise search-all` 不传 `--sources` 时默认只含现有四个来源；显式 `--sources cloud-knowledge`（单独或与其他来源混合）→ **在解析阶段明确报错**，提示改用单源 `enterprise search`，且不创建子会话、不调用 adapter、不写 aggregate bundle。
42. 远端 `filePath` 含 `..`、反斜杠、NUL、空段或授权前缀边界相邻路径 → search 与 materialize 均拒绝；后端返回恶意原文件名 → CLI 输出始终位于 `raw/download/<itemId>/`，外部目录不被创建。
43. `sourceMetadata`、条目 reason、诊断文件和 outcome 中注入 Bearer/token/cookie/authorization 或超长后端响应 → 只保留脱敏、截断后的固定字段，不出现凭据或完整响应。
44. 物化成功或失败后重新执行 collection-state 的 load/inspect/export-views → 云盘 signature/provisional 重复组规则保持，跨资源同签名条目不被重新拆组，且每个 materialized 条目仍有独立 canonical item。

单元测试对齐既有形态：`adapters/cloud-knowledge.test.mjs` + `dispatcher.test.mjs` 增量用例，全部用 stub CLI，不打真实后端。

## 后续（不在 V1）

- `metadata-search`：无主题词、纯条件枚举场景。
- 开放更多 DSL 形态（时间窗、自定义元数据）。
- `search`（切片检索）作为命中定位诊断，仅用于报告，不作交付物。
- `collectResource`：单个云盘文件 URL 直采。
- `resumeResource`：metadata-only 会话的恢复物化。
- **硬数量保证**：若要让「给我 5 篇」成为交付闸门，需为云盘条目补出 `promotionId` / `verificationReceipt` / `fullTextEvidence` / `verifiedTopicStatus` 四件套，等于在企业路径重建一遍 `public-collect` 的探针状态机。代价远超 V1，V1 明确不做。
