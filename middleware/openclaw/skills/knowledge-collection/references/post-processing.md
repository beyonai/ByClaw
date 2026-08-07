# Post-processing

本流程与具体执行器无关。来源执行器只负责采集；采集编排器 `knowledge-collection` 统一负责持久化、预览、选择、状态和收尾。

## 持久化与预览

采集开始后自动持久化到：

`/by/.sessions/<sessionId>/<collectionRunName>/<timestamp>/`

若该位置不可写，则回退到当前工作区的 `.by-sessions/<sessionId>/<collectionRunName>/<timestamp>/`。新 metadata
写入 `storage.fallback`；只读兼容旧 `storageFallback`。

完整文章清单全部写入 `sanitized/metadata.json`，但最多预存 10 个正文到 `sanitized/items/`。`collection-result.json.items`
只列出当前实际存在的已物化正文，可为空数组。向用户返回已有正文的可点击预览文件链接，并明确展示完整、`partial`、
缺失正文或失败状态；预览不得掩盖缺失正文。

## 后处理选择

每次后处理运行只能执行一种操作，不得自动串联入库、知识整理或外部消费。

- 用户已明确要求入库、知识整理或显式外部消费时，直接进入对应流程，不再询问默认三选一。
- 用户只要求采集时，采集完成或达到可预览的 `partial` 状态后，只询问一次：`入库 / 知识整理 / 跳过`。
- 用户以调用其他接口或执行其他任务替代三选一回答时，进入外部消费，不再追问。
- 入库与知识整理在同一次运行中互斥；会话仍保留时，用户后续明确发起的新操作创建新的后处理运行。
- 完整范围全部成功并清理会话后，本批次为终态；后续若要执行其他操作，必须重新采集。

若网站执行器返回 `adapterCandidate`，只把它作为完成摘要中的非阻塞建议，不得追加第二个选择问题。用户后续明确要求
保存 Adapter 时，再委派 `bycli` 执行。

### 统一正文来源

入库、知识整理和外部消费默认只使用选中条目的 `sanitized/items/*.md`。缺失时，根据 inventory 的恢复描述交给原始执行器：

1. 优先使用关联 `rawArtifacts` 重新转换、净化。
2. raw 不完整或没有正文时，通过同一原始执行器按 `sourceItemId` 或 `sourceUrl` 补采并净化。
3. 不得切换执行器、改变用户筛选，也不得回退使用 `markdown/*.md` 作为下游正文。
4. 成功后使用 `mark-materialized` 登记文件；仍失败则记录原因、跳过该文章并告知用户。

已有 materialization 的路径错误、文件缺失或状态与路径矛盾时，不删除任何所指文件；脚本把该文章安全降级为 `pending`、
移出 canonical view 并要求原始执行器重新物化。成功 run 不得建立在该无效物化状态上。

采集 100 篇但只预存 10 篇时，若用户选择全部，必须在下游操作前按以上流程尝试物化其余 90 篇。

- 入库：展示目标、条目和产物范围并取得入库确认，再调用知识库能力。
- 知识整理：将选中的净化正文及用户要求交给 `knowledge-organizer`。
- 跳过：保留本次会话产物并结束。选择跳过时不创建 ingest、organize 或 external run，不调用 cleanup，
  不删除任何会话产物，并结束默认三选一流程。

### 外部消费

明确使用采集文件调用其他接口或执行其他任务属于外部消费。仅打开、读取或预览不属于外部消费，也不触发清理。
外部任务全部成功后视为本次运行成功；失败或结果不明确时保留对应工作副本。部分成功时只删除成功文章的工作副本。
进入外部消费后，不再询问 `入库 / 知识整理 / 跳过`。部分成功会保留会话以便续跑；完整成功清理会话后，该批次终止，后续操作必须重新采集。

## 逐篇状态

每个选中条目记录 `success`、`failed`、`pending` 或 `unknown`：

- 入库在该文章上传成功且 build 请求被接受后记为 success，不等待异步索引完成。
- 知识整理在该文章成功写入 ODS 且完成对应 ADS 整理后记为 success；全局 build 单独记录为运行级步骤。
- 外部消费只有在结果能明确映射到 `itemId` 时才能记为 success；批次失败且无法拆分时记为 unknown。
- 运行级必要步骤失败时，run 不得标记为 success。

只选择部分文章时，未选文章在会话层面仍为 pending。只有覆盖完整 inventory 且全部成功，或用户明确放弃未选文章时，
才能清理整个会话。

## 状态脚本与续跑

状态与清理必须通过 `scripts/knowledge-collection-post-processing.mjs`，不得由 Agent 手工修改 JSON 或猜测关联文件：

```text
node scripts/knowledge-collection-post-processing.mjs inspect --session-dir <dir>
node scripts/knowledge-collection-post-processing.mjs mark-materialized --session-dir <dir> --item-json-file <file>
node scripts/knowledge-collection-post-processing.mjs record-run --session-dir <dir> --run-json-file <file>
node scripts/knowledge-collection-post-processing.mjs cleanup --session-dir <dir> --run-id <id>
node scripts/knowledge-collection-post-processing.mjs unlock-stale --session-dir <dir>
node scripts/knowledge-collection-post-processing.mjs set-retention --session-dir <dir> --keep true|false
```

`mark-materialized` 与 `record-run` 的一次性输入文件必须放在会话 `.post-processing-inputs/` 中，并使用
`"schemaVersion": "1.0"`。文件必须是普通 JSON，不能是符号链接。命令成功持久化正式状态后删除对应输入文件；
命令失败时保留输入文件并返回其路径。唯一正式状态仍是 `sanitized/metadata.json`，Agent 不得直接修改它。

`set-retention` 在会话锁内更新 `retention.userRequested`，`--keep` 只能是 `true` 或 `false`；用于用户在采集完成后
要求保留或允许默认清理。`retention.auditRequired` 仍只能由审计保留策略控制。

`mark-materialized` 输入：

```json
{
  "schemaVersion": "1.0",
  "itemId": "stable-item-id",
  "markdownPath": "markdown/stable-item-id.md",
  "sanitizedPath": "sanitized/items/stable-item-id.md",
  "canonicalItem": {
    "title": "Article title",
    "url": "https://example.com/article",
    "author": "",
    "publishTime": "",
    "markdown": "sanitized/items/stable-item-id.md",
    "fileName": "sanitized/items/stable-item-id.md"
  }
}
```

`record-run` 输入必须包含 `runId`、`operation`、`target`、`selection`、`status`、`sessionStatus`、
`globalStage` 和与 selection 一一对应的 `items`。`selection` 包含 `mode`、`itemIds`、
`discardUnselected` 与 `discardUnselectedConfirmed`；只有用户明确确认放弃未选文章时，后两项才可同时为 true。
`selection.mode` 只能是 `all` 或 `items`：`all` 必须覆盖完整 inventory，`items` 表示显式子集，包括仅失败项续跑；
两个 discard 字段必须始终为布尔值。

`sessionStatus` 固定为 `success`、`partial`、`failed` 或 `unknown`。脚本重新计算并校验 `sessionStatus`：完整 inventory
成功或未选项已明确放弃时为 success；完整范围明确失败时为 failed；完整范围无法确认时为 unknown；子集、pending 或混合结果
为 partial。采集编排器提交的值与计算结果不一致时，`record-run` 拒绝写入并保留输入文件。

固定 target 结构为：

```json
{"kind": "knowledge-base", "id": "resource-id", "path": "/confirmed-directory"}
{"kind": "knowledge-organization", "id": "organization-run-key"}
{"kind": "external", "id": "stable-task-key"}
```

`globalStage` 使用 `{name, required, status, reason}`；status 为 `not-required`、`pending`、`success`、
`failed` 或 `unknown`。入库 build 已逐篇记录，因此没有额外全局步骤；知识整理全局 build 为必要步骤；外部消费
只有存在必要批次终结步骤时才设为 required。详细字段也可运行脚本 `help` 查看。

旧 organize run 的字符串 globalStage 采用保守迁移：`success`/`build-success` 映射为 success，
`failed`/`build-failed` 映射为 failed，`pending`、`unknown` 保持同名；只有 `build`、缺失值和未知值都迁移为 unknown，
保留逐篇成功结果并只要求重试全局 build。非 organize 操作迁移为 not-required，不得凭字符串推断知识整理已成功。

再次处理同一批次时，且会话尚未因完整成功被清理，先用 `inspect` 按相同 operation + target 查找最近的部分运行：

- 只要匹配 run 的 `status` 或 `sessionStatus` 不是 `success`，或选择范围是未覆盖完整 inventory 的成功子集，
  就必须让用户确认“全部文章重新执行”或“仅失败/待处理文章”。
- `failedItemIds` 同时包含 run 中的失败/待处理/未知项，以及未被本次子集选中的 inventory 项。
- 仅失败项不重复 success；全部重做时，已删除正文也按 raw 优先、原执行器补采其次重新物化。
- `inspect` 通过 `requiresGlobalStageRetry` 标识必要全局步骤失败、pending 或 unknown。选择仅失败项且逐篇均已成功时，
  只重试全局步骤，不重新执行成功文章；同时存在失败文章时，处理失败文章后再重试必要全局步骤。
- operation 或 target 不同则旧状态不能复用，完整 inventory 成为新 run 的待处理范围。
- 新 run 追加到历史；同一 run 的逐篇执行和 cleanupStatus 可原子更新。
- 已有 run 的 operation、target 与 selection 不可改变；范围或目标变化必须创建新 run。
- 同一 `sourceSkill + sourceUrl` 的文章进入新 run 后，以最新操作为准；旧 run 中 `not-started`、`pending`、`failed`、
  `skipped-retention` 等未完成清理状态都改为 `superseded`，由最新 run 统一决定当前文件清理。

## 清理

- 完整范围全部成功：默认清理整个临时会话目录；清理后该批次终止，不能再基于原会话创建新 run。
- 部分成功或只选择部分文章：只删除成功文章的工作副本，保留共享 `raw/`、metadata、失败/待处理/未知文章和未选文章。
- 全部失败或 unknown：不删除文章工作副本。
- 失败或跳过时保留恢复所需会话产物。
- `retention.auditRequired=true`（只读兼容 `audit_required=true`）或用户要求保留时，不执行任何默认清理。

工作副本只指 inventory 明确记录的 `materialization.markdownPath` 与 `sanitizedPath`。脚本使用会话锁、根目录路径校验、
写前 `cleanupStatus: pending` 和幂等删除；成功后置为 completed，删除失败置为 failed，保留策略生效时置为 skipped-retention。
`cleanupStatus: completed` 或 `superseded` 再次 cleanup 时直接返回，不读取或删除文章当前路径。

同一文章重新物化但文件名变化时，先提交新路径，并把旧工作副本写入 `pendingArtifactCleanup`。旧文件删除成功后移出数组；
删除失败或进程中断时保留记录，下一次 `inspect` 或重新物化继续清理。journal 只接受安全工作副本路径，永不删除 `raw/`，
也不得删除当前 `markdownPath` 或 `sanitizedPath`。

会话锁是 JSON 普通文件，记录 `pid`、`createdAt`、随机 `ownerId` 和当前 command。已有锁的 pid 仍存活时拒绝并发操作；
PID 已不存在时可以自动安全回收 stale lock。锁损坏或无法判断时不自动删除，可使用 `unlock-stale` 诊断和回收；该命令
同样必须确认原 PID 已不存在，不能仅凭锁龄抢占仍存活的进程。

锁内容写入失败时，脚本关闭本次文件描述符，并且只在 inode 仍与本次独占创建结果一致时回滚空锁；锁已被替换或无法确认时
安全失败，不删除其他 owner 的锁。stale-lock 回收会在重命名前后再次检查锁内容；若期间锁被替换，则放弃回收并报告冲突。
