# ACP Linked Skills 提示词强制约束设计

## 目标

本次只增强 `call_acp_agent` 下发给下游 ACP client 的提示词约束，不新增 manifest、不扩展 bootstrap contract，也不修改远端 ACP worker 协议。

当前下游客户端为 Claude Code 和 Codex。只要 `metadata.md` 中存在 Linked Skills，就必须遵守以下规则：

1. 在开始真实业务处理前，完整读取全部 Linked Skills 的 `SKILL.md`，不能只读取看起来相关的 skill。
2. 读取 query 后，适用于任务的 skill 必须实际使用并给出证据。
3. 不适用的 skill 可以不执行，但必须给出与当前任务相关的具体理由。
4. 不允许静默跳过，也不允许只声称“已使用”。
5. 任一 Linked Skill 无法读取时，按现有 fail-closed 规则写 `BLOCKED`，不得继续处理 query。

没有 Linked Skills 时，保持现有 metadata-first 行为。

## 修改范围

### metadata.md

在现有 `## Linked Skills` JSON 列表前加入明确的业务规则说明：

- 列表非空时必须完整读取每个 skill。
- 所有 skill 都必须在最终结果中具有 `APPLIED` 或 `NOT_APPLICABLE` 状态。
- `APPLIED` 必须包含执行证据。
- `NOT_APPLICABLE` 必须包含具体原因。

Linked Skills 列表仍由现有 planner 生成，不改变数据结构。

### ACP client 公共指令

在 `clients/{client}.md` 中加入统一执行顺序：

1. 完整读取 metadata。
2. 若 Linked Skills 非空，逐项读取全部 `SKILL.md` 到 EOF。
3. 所有 skill 均成功读取后才能完成 bootstrap READY。
4. READY 后读取 query，逐项判断并执行适用 skill。
5. 最终回复输出 skill 使用清单和证据。

### Claude Code

- 优先使用 Claude Code 原生 Skill 能力。
- 原生能力无法按名称识别时，必须回退到 metadata 中的绝对 `skillDocPath` 读取并执行。
- “未安装到默认 skills 目录”不能作为跳过理由。

### Codex

- 从 metadata 中的绝对 `skillDocPath` 完整读取 `SKILL.md`。
- 按 `SKILL.md` 的引用规则加载关联资源并执行工作流。
- 复述 skill 内容不等于实际使用。

### call_acp_agent delegation content

在 `<USER_QUERY_ACCESS>` 之前增加 Linked Skills 强制约束，使规则在 query 入口之前可见：

- 全部读取，不按相关性预筛选。
- 无法读取则 BLOCKED。
- 适用则 `APPLIED` 并给证据。
- 不适用则 `NOT_APPLICABLE` 并给具体理由。
- 最终结果不得遗漏任何 Linked Skill。

`buildTask` 同步加入同一规则，保证本地 sessions-spawn 和远端 call-agent 两条路径语义一致。

## 约束边界

这是提示词级业务约束。adapter 能保证约束文本与完整 `metadata.md` 一起在 query 入口之前下发，但不能独立证明模型内部确实读取或执行了 skill。

现有 metadata SHA-256、路径校验、READY/BLOCKED 和 query 隔离逻辑保持不变。

## 测试

测试覆盖：

1. `metadata.md` 的 Linked Skills 章节包含“全部读取、适用必用、不适用说明理由”。
2. Claude Code 指令包含原生 Skill 优先和绝对路径回退。
3. Codex 指令包含完整读取 `SKILL.md`、加载引用资源和禁止用复述代替执行。
4. call-agent content 在 `<USER_QUERY_ACCESS>` 前包含 Linked Skills 强制约束。
5. 最终状态要求同时包含 `APPLIED`、`NOT_APPLICABLE`、执行证据和具体理由。
6. 无 Linked Skills 时不要求伪造 skill 使用记录，原有流程继续通过。

## 不做的事项

- 不新增 `linked-skills-manifest.json`。
- 不新增或修改 bootstrap contract 字段。
- 不对 skill 文件增加新的 adapter 侧摘要或存在性校验。
- 不改远端 ACP worker、消息协议或双阶段状态机。
