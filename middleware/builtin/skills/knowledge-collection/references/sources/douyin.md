# 抖音视频归档

适用于用户明确要求采集、保存或归档抖音作品视频及其可用官方字幕。网站执行器使用现成 `douyin` Adapter，采集编排器负责受控落盘、物化、登记和交付；不修改外部 byCLI 源码。

## 初始化与来源授权

遵循主 Skill 的 Session Root、唯一会话及交付路径规则。输入是分享文案时，先只提取其中用户实际提供的 HTTPS 抖音 URL，不预先打开短链、不猜作品 ID。支持短链、`/video/<id>`、`/note/<id>` 及 `/jingxuan?modal_id=<数字作品 ID>` 链接。首次 `init --direct-urls` 登记提取的原始 URL；`acquire-douyin --source-url` 必须沿用该已授权 URL，短链跳转与 `modal_id` 解析由 Adapter 在执行时处理，Agent 不手工替换为另一个 URL 或作品 ID。

采用 `public-internet`、`selected`、`requiredContentGranularity=any`，不传 `--workflow`，建立 operator 会话。该路径归档视频，不走 `public-collect` 文章全文、通用 `web`、`acquire-web` 或 `materialize-web`，不增加其他来源。

```bash
node /app/skills/knowledge-collection/scripts/knowledge-collection.mjs init \
  --session-dir <Session Root>/collections/<task-name> \
  --session-root <Session Root> \
  --query "<用户原始归档要求>" \
  --source-scope '["public-internet"]' \
  --materialization-target selected \
  --required-content-granularity any \
  --direct-urls '["<从用户分享文案提取的 URL>"]'
```

若用户已指定保存路径，按主 Skill 改用 `<Session Root>/.collection-runs/<run-id>/`，在同一次 `init` 中传 `--delivery-requested true --delivery-dir <用户保存路径>`。后续只操作内部会话；交付目录保持 opaque，不能提前检查或创建。

## 获取与物化

先加载 `bycli` Skill 并按实际安装的 `list` / structured help 核对 `douyin read` 和 `douyin download`。所有浏览器业务执行交给专用 Runner；根 Agent 不直接运行 Adapter 或手工重定向 stdout 到 raw。

```bash
node /app/skills/knowledge-collection/scripts/knowledge-collection.mjs acquire-douyin \
  --session-dir <dir> --item-id <id> --source-url <已授权 URL>

node /app/skills/knowledge-collection/scripts/knowledge-collection.mjs materialize-douyin \
  --session-dir <dir> --item-id <id> \
  --executor-result-file <acquire 返回的执行器结果路径>

node /app/skills/knowledge-collection/scripts/knowledge-collection.mjs collect \
  --session-dir <dir> --item-json-file <materialize 返回的 collectPayloadPath>

node /app/skills/knowledge-collection/scripts/knowledge-collection.mjs status --session-dir <dir>
```

示例中的 `<dir>` 使用初始化返回的绝对会话目录；相对目录必须按主 Skill 同时传 `--session-root <Session Root>`。只有执行器获取成功且物化器返回非空 `collectPayloadPath` 后才能 `collect`；不得手写或修改 raw、Markdown、元数据或 collect payload 替代该流程。

Runner 先对已授权 URL 调用 `bycli douyin download --metadata true` 保存视频及元数据，再用返回作品 ID 对应的规范 `video/<id>` URL 调用 `bycli douyin read` 获取同一作品的官方字幕，避免再次解析分享短链。原始执行证据与受控结果保存在 `raw/bycli/douyin/<id>/`，其中执行器回执为 `executor-result.json`。本入口只归档视频；图文、缺失视频地址、空文件或下载失败都必须按实际结果报告，不能用标题、封面或已保存元数据代替视频成功。

## 长视频与超时预算

Runner 默认向下载子进程设置 `BYCLI_BROWSER_COMMAND_TIMEOUT=300`（秒），读取字幕时默认为 60 秒；调用环境显式设置的正整数值会覆盖这两个默认值。外层进程预算分别至少为内层预算加 60 秒，并且下载不短于 300 秒、读取不短于 120 秒。因此默认下载外层为 360 秒，读取为 120 秒。

长视频可在首次采集前提高内层预算，例如在本 Skill 根目录运行：

```bash
BYCLI_BROWSER_COMMAND_TIMEOUT=900 node scripts/knowledge-collection.mjs acquire-douyin \
  --session-dir <dir> --item-id <id> --source-url <已授权原始 URL>
```

此例下载和读取的外层预算均自动至少为 960 秒。`KNOWLEDGE_COLLECTION_CLI_TIMEOUT_MS` 可显式设置外层预算（毫秒），必须为正整数且至少比内层预算多 60 秒；非法或过短配置会在执行前被拒绝。调用 Runner 的 Bash/执行工具还须为整次流程的预检、下载、读取和清理留出总时间，不能把某一个子步骤的预算当作整个流程上限。300 秒或更长预算均不保证某个文件大小的视频一定下载成功，实际结果以执行器回执和文件校验为准。

超时或中断后，业务结果可能不确定。保留原会话、状态与已有产物并报告原始结果；不得仅调高超时后自动重放，也不得换 item ID、URL 或输出目录绕过终态保护。普通超时不构成已完成登录验证的证据。

## 桥接与认证续采

`acquire-douyin` 独占一次 bridge 预检和本次执行预算；根 Agent 不先跑 bridge-bootstrap、doctor、daemon status，不套其他 Runner。桥接不可用时保留原会话并报告返回的诊断，不自行启动或重启浏览器、不另建会话绕过。

明确的认证、CAPTCHA、MFA 或人工验证返回后，保留原会话、Adapter TAB、状态和已保存证据并 STOP。只使用命令已返回的状态，不补查页面。只有用户明确表示已完成验证后，才对原命令添加 `--verification-confirmed true`：

```bash
node /app/skills/knowledge-collection/scripts/knowledge-collection.mjs acquire-douyin \
  --session-dir <原 dir> --item-id <原 id> --source-url <原 URL> \
  --verification-confirmed true
```

确认仅续采原暂停步骤，不重做桥接或已成功步骤；后续再次暂停需要用户新确认。“再试试”、普通超时或字幕缺失都不构成验证完成确认。终态、预算耗尽或状态损坏按实际结果停止，不删除状态、不换 item ID、URL 或目录绕过。

## 视频、官方字幕与交付边界

物化器生成 `markdown/items/<id>/index.md` 和 `sanitized/items/<id>/index.md`，以及各自的本地 `assets/`：视频 `<workId>.mp4`、`metadata.json`，有可用官方字幕时生成对应 `subtitle-01.json` / `.vtt` 等文件。字幕来自 `read` 规范化后的 `cues[].from/to/text`，JSON/VTT 是物化产物，不宣称下载保留了远端原始 SRT 字节。

当前 byCLI 最多读取前三条官方字幕轨道、每轨 1 MiB，支持解析 JSON/VTT/SRT。保留轨道语言、时间戳、来源与限制；不得把存在字幕等同于整段视频全文完整。`subtitleStatus=not-provided` 或 `unavailable` 时明确记录跳过与实际原因，视频仍可完成归档；不做 ASR、抽帧、OCR 或远程视频理解，不上传到另一个转录服务。

本路径 `contentGranularity` 固定为 `unknown`，不产生 `fullTextEvidence`，不计文章数量。标题、描述、评论、官方字幕和下载成功分别按实际证据报告；禁止把它们拼成未经验证的完整视频转录。视频及已物化字幕的资产路径和哈希进入受控登记，后续链接只指向实际存在的本地文件。

最后以 `status.collection.deliveryComplete` 判定服务器内部归档是否完成，并报告视频文件、字幕状态和覆盖限制。用户指定了保存路径且状态允许交付时，由根 Agent 执行既有 `publish --session-dir <dir> --delivery-handle <init 返回的 handle>`，以发布结果验证指定目录交付；视频、元数据和字幕作为已登记 assets 随 Markdown 交付，不手工复制到用户目录。`deliveryInput.files` 仍指向交付后的 Markdown，下游可通过其本地链接追溯附件；按主 Skill 在首次最终答复原样回显 `deliveryInput`。

服务器归档、指定目录发布、浏览器下载与预览是分别验证的结果。归档或 `publish` 成功不能证明网页下载或预览可用；没有实际浏览器验证时明确标注“网页下载/预览未验证”。大文件交付失败需沿用户实际访问的前端和后端链路定位；仅观察到 DSH `/api/file` 返回 413，不能断言它就是鲸智业务下载链路的根因。
