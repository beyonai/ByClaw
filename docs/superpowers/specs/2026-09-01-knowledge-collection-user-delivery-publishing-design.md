# Knowledge Collection 用户目录发布设计

## 背景

`knowledge-collection` 当前把一个初始化后的采集会话目录同时用作工作目录和交付目录。用户说“保存到当前会话下的
`00-collection/`”时，Agent 会把该路径直接传给 `--session-dir`，因此用户最终看到的不只是正文和图片，还包括：

- `.collection-inputs/`
- `raw/`
- `markdown/`
- `sanitized/`
- `session.json`
- `collection-result.json`

这些文件对采集追溯、状态恢复和 `status` 校验是必要的，但不属于用户所说的“最终采集文件”。要求用户在提示词中描述
`sanitized/items/`、交付校验和清理规则不符合自然使用方式，也会把内部实现细节暴露给用户。

此前的 `2026-08-24-decouple-knowledge-collection-downstream-actions-design.md` 已明确移除下游结果驱动的 `cleanup`、
`run` 和 retention 状态机。本设计不恢复这些能力，而是在采集终点增加一个受验证的用户目录发布步骤。

## 目标

1. 用户明确说“保存到某目录”时，把该目录解释为本次任务的最终交付位置，而不是采集会话根目录。
2. 用户只需使用自然语言，不需要知道 `sessionDir`、`sanitized/items/` 或“消费确认”。
3. 最终交付位置只包含已验证的 Markdown 和这些 Markdown 实际引用的本地资源。
4. 保持现有采集、研究、企业来源、crawl、inventory 和 `downstreamInput` 契约兼容；`status` 只增加可选的
   `deliveryInput`，不改变任何已有字段。
5. 不覆盖或删除用户目标目录中的未知既有内容。
6. 发布失败时不向用户目录暴露半成品，并允许同一采集会话安全重试。
7. 后续消费 Agent 能获得经过验证的实际发布目录和精确 Markdown 文件列表，不需要扫描目录或猜测路径。

## 非目标

- 不恢复知识入库、知识整理或外部消费的下游状态机。
- 不根据下游执行结果删除采集会话。
- 不改变 `by-knowledge-manager`、`knowledge-organizer` 或 `tech-article` 的输入契约。
- 不把远程图片下载、云盘上传或图片链接持久化引入发布阶段。
- 不清空 `/by/`、当前 Session Root 或任何已存在的共享目录。
- 不迁移或重新布局历史采集会话。
- 不要求用户为普通保存请求选择覆盖、合并或清理模式。

## 核心决策

### 1. 分离内部会话与用户交付位置

引入三个不同概念：

- `sessionDir`：采集内部权威状态目录，继续包含 `session.json`、`raw/`、`markdown/` 和 `sanitized/items/`。
- `requestedDeliveryDir`：从本次用户请求中解析出的保存位置。
- `actualDeliveryDir`：应用非空目录和冲突规则后，本次真正写入的独立交付目录。

当用户明确提供保存位置时，Agent 自动为本次任务生成内部会话目录：

```text
<Session Root>/.collection-runs/<run-id>/
```

例如：

```text
用户请求：采集一篇关于 DeepSeek 的文章，保存到当前会话下的 00-collection/

sessionDir:
/by/.sessions/20037048/.collection-runs/<run-id>/

requestedDeliveryDir:
/by/.sessions/20037048/00-collection/
```

`.collection-runs/` 是 Agent 的内部工作位置，不是用户交付目录。发布完成后仍保留内部会话，以维持来源追溯、失败恢复和
既有下游 Agent 的读取能力；其长期回收由会话级过期清理机制另行负责。

### 2. 仅在用户明确指定保存位置时发布

本设计不改变没有保存路径的现有请求。用户没有指定目录时，流程仍以 `status.downstreamInput` 作为采集交付，并返回已验证的
`sanitized/items/` 文件。

用户明确说“保存到”“放到”“写入”“输出到”某路径时，Agent 才在 `status` 校验成功后调用新的 `publish` 命令。

### 3. `publish` 是采集交付，不是下游消费

`publish` 只复制已经由 collection inventory 和实际文件共同验证的正文及其本地依赖，不执行入库、知识整理、外部 API、
业务构建或下游清理。因此它属于用户可见交付层，不重新引入已经删除的 downstream lifecycle。

### 4. 为发布副本提供稳定的消费输入

保留现有 `status.downstreamInput` 作为采集会话内部的权威正文输入，并新增版本化的 `deliveryInput`：

- `downstreamInput`：指向 `<sessionDir>/sanitized/items/`，供发布器、旧调用和未指定保存路径的流程使用。
- `deliveryInput`：指向 `actualDeliveryDir`，只在 `publish` 成功且发布文件复验通过后出现，供后续消费 Agent 使用。

两者不能互相覆盖。用户明确提供保存路径且发布成功时，后续消费必须优先使用 `deliveryInput.files`；用户没有提供保存路径时，
才继续使用 `downstreamInput.files`。

## 路径解析

### 相对路径

相对路径必须同时使用当前 Agent 上下文提供的 Session Root，并相对于该目录解析。`..` 或符号链接不得越出 Session Root。

```text
用户路径: 00-collection/
Session Root: /by/.sessions/20037048
requestedDeliveryDir: /by/.sessions/20037048/00-collection
```

### 绝对路径

绝对路径按用户提供的位置解析，不相对于 Session Root 改写。仍必须验证：

- 目标不是符号链接；
- 最近的现有祖先是普通目录；
- 发布进程对目标父目录具有必要权限；
- 目标不是文件或其他非目录对象；
- 目标不是文件系统根目录 `/`。

例如用户说“保存到 `/by/` 下”时，`/by/` 是请求的容器目录。因为它通常非空，最终会在其下创建本次任务的独立子目录，
而不是直接向 `/by/` 写入或清理其中内容。

## 非空目录与重名策略

发布使用以下固定规则，不向用户追问技术模式：

1. `requestedDeliveryDir` 不存在：将其创建为本次 `actualDeliveryDir`。
2. `requestedDeliveryDir` 已存在且为空：直接作为本次 `actualDeliveryDir`。
3. `requestedDeliveryDir` 已存在且非空：在其下创建
   `<task-slug>-collection-<short-run-id>/`，该子目录作为 `actualDeliveryDir`。
4. `requestedDeliveryDir` 是普通文件、符号链接或其他非目录对象：安全失败，不修改目标。
5. 发布器永不递归删除 `requestedDeliveryDir` 中的既有内容。

`task-slug` 从采集主题生成，去除路径分隔符、控制字符和不安全字符；为空时使用 `collection`。`short-run-id` 来自本次内部
run ID，保证同一父目录下不同采集任务不会竞争同一子目录。

同一批次中多个 Markdown 的目标 basename 相同时：

- 第一项保留原 basename；
- 后续项使用 `<stem>-<short-item-id>.md`；
- 每项的本地资源路径随目标 Markdown 名称确定性改写；
- 同一会话重试必须复用首次计算出的映射，不得生成新的文件名或目录。

## 发布命令

新增本地命令：

```text
knowledge-collection.mjs publish \
  --session-dir <initialized-session-dir> \
  --delivery-dir <user-requested-path> \
  [--session-root <current-session-root>]
```

`--session-dir` 继续使用现有采集会话路径规则。`--delivery-dir` 使用本设计的相对/绝对交付路径规则。命令不得接受覆盖、清空、
删除未知文件或跳过校验的参数。

命令成功返回：

```json
{
  "ok": true,
  "action": "publish",
  "delivery": {
    "schemaVersion": "1.0",
    "requestedDirectory": "/by",
    "actualDirectory": "/by/deepseek-collection-a31f92c4",
    "files": [
      "/by/deepseek-collection-a31f92c4/post-01.md"
    ],
    "assets": [
      "/by/deepseek-collection-a31f92c4/post-01-images/img_86c2de96.jpg"
    ]
  },
  "deliveryInput": {
    "schemaVersion": "1.0",
    "directory": "/by/deepseek-collection-a31f92c4",
    "files": [
      "/by/deepseek-collection-a31f92c4/post-01.md"
    ]
  }
}
```

`delivery.files` 和 `delivery.assets` 只列出实际存在、经过发布后复验的普通文件。最终 Agent 回复必须使用
`actualDirectory`，不能只返回用户最初提供的父目录。`deliveryInput.files` 只包含已发布 Markdown；图片和其他本地资源由这些
Markdown 的相对链接绑定，完整资源清单仍保留在 `delivery.assets`。

## 发布数据流

```text
用户目标和保存路径
  -> 生成内部 sessionDir
  -> init / discover / acquire / materialize / collect
  -> status
  -> 要求 collection.deliveryComplete=true
  -> 读取 status.downstreamInput.files
  -> 构建正文与本地资源发布计划
  -> 在目标父目录创建同文件系统临时 staging 目录
  -> 复制、改写链接、校验文件与哈希
  -> 原子发布到 actualDeliveryDir
  -> 记录发布状态和完整 delivery plan
  -> 返回 actualDeliveryDir、发布文件和 deliveryInput
  -> 父 Agent 把 deliveryInput 原样交给后续消费 Agent
```

`status.downstreamInput` 保持现有结构和含义：

```json
{
  "schemaVersion": "1.0",
  "directory": "<sessionDir>/sanitized/items",
  "files": ["<sessionDir>/sanitized/items/article.md"]
}
```

发布结果不回写 `collection-result.json.items[].fileName`，因为这些字段必须继续是相对于采集会话根目录的
`sanitized/items/` 路径。

发布成功后，`status` 增加可选的顶层 `deliveryInput`，其值与 `publish` 返回的 `deliveryInput` 一致。未发布、发布失败、目标发生
drift、内部正文在发布后发生变化或发布文件复验失败时，`status` 不得返回可消费的 `deliveryInput`，但原有 `downstreamInput`
仍照常返回，并在 `warnings` 中说明 delivery 不可用的原因。delivery 失效不得使整个 `status` 命令失败。

## 正文与本地资源规则

1. 正文只能来自 `status.downstreamInput.files`，不得从 `raw/`、`markdown/`、候选摘要或目录扫描补选。
2. 每个正文必须是可读、非空、非符号链接的 `.md` 普通文件。
3. 发布器解析 Markdown 和受支持的 HTML media 引用，只复制正文实际引用的本地资源。
4. 本地资源必须位于对应采集条目的 `sanitized/items/` 边界内，且路径的每一级都不能是符号链接。
5. 缺失资源、越界资源或远程资源引用会使本次发布在写入最终位置前失败；发布器不得编造路径或静默丢图。
6. Markdown 位于 `sanitized/items/` 根级且引用现有伴随目录时，在无冲突情况下保留该目录名，例如
   `post-01.md` 与 `post-01-images/`。
7. Markdown 使用文章目录布局 `<item>/index.md` 与 `<item>/assets/` 时，发布为根级 `<item>.md` 与
   `<item>-assets/`，并改写相对链接。
8. 多个正文引用同一会话内资源时，每个目标路径只复制一次，但所有 Markdown 必须拥有正确的相对引用。

发布后必须重新解析每个目标 Markdown，确认全部本地引用存在且仍位于 `actualDeliveryDir` 内。

## 状态、幂等与并发

在 `session.json` 增加可选的顶层 `delivery` 子树；不改变现有 `schemaVersion: "2.0"`，旧会话缺少该字段时仍按未发布处理。

```json
{
  "delivery": {
    "schemaVersion": "1.0",
    "status": "planned",
    "requestedDirectory": "/by",
    "actualDirectory": "/by/deepseek-collection-a31f92c4",
    "planHash": "sha256:...",
    "files": [
      {
        "source": "sanitized/items/post-01.md",
        "target": "post-01.md",
        "sha256": "..."
      }
    ],
    "assets": [
      {
        "source": "sanitized/items/post-01-images/img_86c2de96.jpg",
        "target": "post-01-images/img_86c2de96.jpg",
        "sha256": "..."
      }
    ],
    "publishedAt": null,
    "reason": null
  }
}
```

状态固定为 `planned`、`published`、`stale` 或 `failed`：

- 写入用户目录前先持久化完整计划和 `actualDirectory`。
- 成功发布并复验后原子更新为 `published`。
- 发布前失败记录为 `failed`，且不修改最终目录。
- 同一 plan 重试复用已有 `actualDirectory` 和目标映射。
- 已 `published` 且目标哈希一致时幂等返回成功。
- 已 `published` 但目标被外部修改时返回 drift 错误，不覆盖用户修改。
- 已 `published` 后，若当前 `downstreamInput.files` 集合或任一源文件哈希与计划不一致，将 delivery 标记为 `stale`，隐藏
  `deliveryInput`，但保留历史目标和哈希供诊断。
- `stale` delivery 重新发布时，只有现有目标仍与上一版发布哈希一致，才允许用新的 staging 原子替换本会话拥有的
  `actualDeliveryDir`；若目标已被外部修改，则按 drift 失败，不覆盖修改，也不自动改投另一个目录造成两份不明确交付。
- `deliveryInput` 只能从状态为 `published` 且正文、资源哈希复验一致的 delivery plan 派生，不作为独立可编辑状态保存。
- 同一 session 继续使用现有会话锁；目标父目录另外使用按规范化路径派生的发布锁，避免两个会话同时选择同一空目录。
- 发布进程异常留下 staging 目录时，后续重试只回收计划中记录且所有权匹配的 staging；不得按名称通配删除。

## 跨 Agent 交接与后续消费

Agent 不会因为文件位于同一会话空间而自动知道应消费哪个目录。闭环必须由稳定数据契约和根 Agent 的显式交接完成。

### 同一次用户请求内继续消费

当用户的请求同时包含采集、保存和后续处理时，根 Agent 按以下顺序编排：

```text
knowledge-collection publish
  -> 获得 publish.deliveryInput
  -> 创建或调用消费 Agent
  -> 在消费任务中原样传入 deliveryInput
  -> 消费 Agent 只读取 deliveryInput.files
```

例如本次实际发布到：

```json
{
  "schemaVersion": "1.0",
  "directory": "/by/.sessions/20037048/00-collection",
  "files": [
    "/by/.sessions/20037048/00-collection/post-01.md"
  ]
}
```

下游消费 Agent 因此能确定应从 `/by/.sessions/20037048/00-collection/post-01.md` 读取正文；图片通过 Markdown 中已经复验的
相对链接读取。它不得改用内部 `.collection-runs/.../sanitized/items/`，也不得扫描 `requestedDirectory` 自行选文件。

### 后续轮次或恢复后继续消费

根 Agent 保留本次 `sessionDir`。后续轮次需要继续消费时，先运行 `status --session-dir <sessionDir>`：

- 若返回有效 `deliveryInput`，将其原样交给消费 Agent；
- 若 delivery 已 drift、缺失或未发布，不得把旧路径当作有效输入，应先报告并重新发布或等待用户决定；
- 若本次请求从未提供保存路径，则使用原有 `downstreamInput`。

一个完全独立、既没有当前对话上下文、也没有收到 `deliveryInput` 或 `sessionDir` 的 Agent，不可能可靠知道先前保存位置。本设计
不依赖这种隐式发现，而是要求所有 Agent 间调用携带 `deliveryInput`；缺少该契约时，消费 Agent 必须停止并报告输入缺失，不能
遍历 `/by/` 或 Session Root 猜测文件。

### 消费后的生命周期

`deliveryInput` 只声明读取输入，不授权消费 Agent 删除、移动或改写发布文件。后续操作若需要删除交付副本，必须有用户明确意图
或对应下游技能的独立生命周期契约；消费结果不得回写 collection inventory。

## 原子性与失败处理

发布器先在 `actualDeliveryDir` 的父目录创建同文件系统 staging 目录。正文复制、资源复制、链接改写和完整复验全部在 staging
内完成。

- 最终目录不存在时，使用原子 rename 提交 staging。
- 最终目录为空时，持有发布锁并重新确认目录仍为空，再用可回滚的空目录替换提交。
- 最终目录在计划后变为非空时，不覆盖；重新选择独立子目录并持久化新计划后重试。
- staging 构建失败时删除本次明确拥有的 staging，保留内部采集会话。
- 提交后的状态持久化失败时，下一次调用根据已持久化 plan、目标文件和哈希恢复为 `published`。

以下情况必须在写入最终位置前失败：

- `collection.deliveryComplete` 不是 `true`；
- `downstreamInput.files` 为空，但用户请求的是正文交付；
- 正文或本地资源缺失、为空、类型错误或越界；
- 目标路径包含符号链接；
- 目标权限不足；
- 目标是 `/`；
- 同名映射无法确定性消解；
- Markdown 改写后仍含无效本地引用。

## Agent 编排规则

更新后的 Agent 流程为：

1. 从用户请求提取采集目标、来源范围、物化目标和可选保存路径。
2. 用户提供保存路径时，将其记为 `requestedDeliveryDir`，不得直接作为 `--session-dir`。
3. 在当前 Session Root 的 `.collection-runs/<run-id>/` 初始化唯一会话。
4. 按现有流程完成采集并运行 `status`。
5. `deliveryComplete=true` 时调用 `publish`；否则保留内部会话并报告实际缺口，不创建最终交付目录。
6. 在 `sessionDir` 中持久化可派生 `deliveryInput` 的 delivery plan；最终只向用户简要报告文章、来源和
   `actualDeliveryDir`，详细诊断只在失败或用户要求时展开。
7. 用户已经要求后续消费时，根 Agent 在采集阶段停止后，把 `deliveryInput` 原样交给独立消费 Agent；未要求后续消费时不主动
   启动其他技能。
8. `publish` 本身不调用知识入库、知识整理、外部消费或清理命令。

## 对现有逻辑的影响

### 保持不变

- `init`、`public-discover`、`materialize-wechat`、`collect`、`status`、`inspect`、`export-views` 和 crawl 命令的接口。
- 单一企业来源 `output-dir == parent-session-dir` 的原位发布规则。
- `search-all` 的 canonical session、inventory 和来源失败隔离。
- `collection-result.json`、`sanitized/metadata.json` 和 `status.downstreamInput` 的结构与路径边界；`status` 只增加可选
  `deliveryInput`。
- 历史会话读取与恢复。
- 没有显式保存路径的旧编排继续把内部会话的 `sanitized/items/` 或原始 `downstreamInput.files` 交给下游技能。

### 有意改变

- Agent 不再把用户明确指定的保存路径直接传给 `--session-dir`。
- 有保存路径的请求在 `status` 后增加 `publish` 阶段。
- 用户最终看到发布路径，而不是内部 `sanitized/items/` 路径。
- 非空目标目录不再导致采集 `init` 失败；它只影响最终 `actualDeliveryDir` 的选择。
- 显式保存后继续消费的编排改为传递 `deliveryInput.files`，不再传递内部 `downstreamInput.files`。
- `status` 成功发布后增加可选的顶层 `deliveryInput`，供后续轮次恢复准确交付路径。

### 成本

- 发布目录保存一份正文和本地资源副本，会增加磁盘占用和复制耗时。
- 内部会话仍需统一的过期回收策略；本设计不立即删除它。
- 新的 Markdown 路径改写、目标锁和恢复逻辑增加了测试面。
- `status` 在 delivery 已发布时需要校验发布计划与文件哈希，会增加与交付文件大小相关的只读 I/O。

## 代码与文档修改范围

- `middleware/openclaw/skills/knowledge-collection/SKILL.md`
  - 区分内部会话目录和用户交付目录。
  - 增加有显式保存路径时的 `publish` 编排规则。
  - 把“禁止旁路交付”收紧为“禁止 Agent 手工复制；只允许受测 `publish` 命令发布”。
- `middleware/openclaw/skills/knowledge-collection/references/collection-contract.md`
  - 增加可选 `delivery` 状态和发布后仍保持 canonical session 的规则。
- `middleware/openclaw/skills/knowledge-collection/references/delivery.md`
  - 区分内部 downstream handoff 与用户目录发布，并定义 `deliveryInput` 的跨 Agent 交接优先级。
- `middleware/openclaw/skills/knowledge-collection/scripts/publish-delivery.mjs`
  - 实现路径解析、发布计划、资源依赖、staging、原子提交、哈希复验、幂等和 drift 检测。
- `middleware/openclaw/skills/knowledge-collection/scripts/knowledge-collection.mjs`
  - 注册 `publish` help 和 machine-readable command schema。
- `middleware/openclaw/skills/knowledge-collection/scripts/command-router.mjs`
  - 接入本地 `publish` handler，并在 `status` 中追加经过复验的可选 `deliveryInput`。
- `middleware/openclaw/skills/knowledge-collection/scripts/collection-state.mjs`
  - 在 collect 或 materialization 改变已发布正文集合时，将对应 delivery 安全降级为 `stale`。
- `middleware/openclaw/skills/knowledge-collection/scripts/session.mjs`
  - 复用并扩展 sandbox path 校验，增加发布目标路径和锁路径辅助函数。
- `middleware/openclaw/tests/test_knowledge_collection_skill.py`
  - 更新技能边界和可发现性断言。
- 新增 `publish-delivery.test.mjs`，并更新统一 CLI 契约测试。

不修改企业 adapters、来源发现器和现有下游技能。

## 验证场景

实现必须使用临时目录和真实文件覆盖以下行为：

1. 相对交付路径基于可信 Session Root 解析。
2. 相对路径包含 `..` 或通过符号链接越界时拒绝。
3. 绝对叶子目录不存在时成功发布。
4. 绝对目录为空时成功发布到该目录本身。
5. `/by/` 或其他非空容器目录下创建独立任务子目录，不修改既有内容。
6. 目标为 `/`、普通文件或符号链接时拒绝。
7. 非空目标目录中的同名文件和文件夹保持不变。
8. 同一批次 basename 冲突时生成稳定 item 后缀并正确改写资源链接。
9. 根级 Markdown 与伴随图片目录保持有效相对结构。
10. `<item>/index.md + assets/` 布局正确发布为根级正文和 item 资源目录。
11. 缺失图片、远程图片、越界图片和符号链接图片在提交前失败。
12. `deliveryComplete=false` 或正文输入为空时不创建最终目录。
13. staging 中断不产生半成品；重试回收且只回收本次拥有的 staging。
14. 同一 session 重复发布返回同一目录和文件映射。
15. 发布后用户修改文件时检测 drift，不覆盖修改。
16. 两个 session 并发发布到同一空目录时最多一个使用该目录，另一个安全选择独立子目录。
17. 发布成功但状态落盘失败时，可根据 plan 和哈希恢复为 published。
18. `status.downstreamInput`、`collection-result.json` 和现有 enterprise/crawl/research 测试保持不变。
19. 旧会话没有 `delivery` 字段时可正常读取、status，并可在满足校验后首次发布。
20. CLI help、`command-schema`、技能说明和实现参数保持一致。
21. `publish.deliveryInput` 只包含实际发布的 Markdown 绝对路径，目录使用 `actualDeliveryDir` 而不是非空父目录
    `requestedDeliveryDir`。
22. 发布成功后的 `status.deliveryInput` 与 `publish.deliveryInput` 完全一致；未发布、失败或 drift 时不返回该字段。
23. 用户指定保存目录并要求继续处理时，Agent 交接规则明确要求传递 `deliveryInput`，不得传递内部 `downstreamInput`。
24. 后续轮次可通过已知 `sessionDir` 的 `status` 恢复同一个 `deliveryInput`。
25. 消费 Agent 只有 requested path、但没有 `deliveryInput.files` 时不得扫描目录猜测正文。
26. 消费 Agent 读取 Markdown 后能通过相对链接解析发布目录中的图片；不需要访问内部 sessionDir。
27. 发布后重新物化正文或改变 canonical 文件集合时，delivery 变为 `stale`，`status` 保留内部 `downstreamInput`、隐藏
    `deliveryInput` 并返回 warning。
28. delivery 目标发生 drift 时，`status` 本身仍成功返回 collection 状态和 warning；`publish` 重试拒绝覆盖外部修改。
29. stale delivery 的目标未发生 drift 时可原子替换并恢复同一路径；目标已修改时不创建第二个模糊交付目录。

## 验收标准

以下自然请求无需增加技术描述即可得到预期结果：

```text
采集一篇关于 DeepSeek 的文章，保存到当前会话下的 00-collection/。
```

当 `00-collection/` 不存在或为空时，最终目录只包含正文和其引用的本地资源。用户看不到采集工作文件；内部会话仍可通过
`status` 校验和恢复。

以下绝对路径请求同样成立：

```text
采集一篇关于 DeepSeek 的文章，保存到 /by/ 下。
```

当 `/by/` 已非空时，系统在其下创建独立的任务交付子目录，绝不清理或覆盖 `/by/` 的既有内容，并在最终回复中返回该实际目录。

以下同一请求中的后续消费也必须闭环：

```text
采集一篇关于 DeepSeek 的文章，保存到当前会话下的 00-collection/，然后基于采集结果生成摘要。
```

采集 Agent 发布成功后返回 `deliveryInput`，并在内部会话持久化可复验、可重新派生该对象的 delivery plan。根 Agent 将
`deliveryInput` 原样传给摘要 Agent；摘要 Agent 从
`deliveryInput.files` 中的 `/by/.sessions/20037048/00-collection/post-01.md` 读取正文，并通过该 Markdown 的相对链接访问图片。
任何 Agent 都不需要知道内部 `.collection-runs/<run-id>/` 路径，也不得通过扫描 `00-collection/` 猜测输入。
