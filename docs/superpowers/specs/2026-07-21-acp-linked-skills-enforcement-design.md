# ACP Linked Skills 强制加载与使用设计

## 背景

`call_acp_agent` 已将完整 `metadata.md` 作为下游 ACP client 的业务规则说明书，并在读取 query 前执行 fail-closed bootstrap。`metadata.md` 中的 `Linked Skills` 当前属于通用业务规则的一部分，但缺少逐项、机器可验证的强制加载协议，也没有明确要求任务执行阶段对每个 skill 给出使用证据或不适用理由。

本设计面向当前下游客户端 Claude Code 和 Codex，同时保持协议可被其他 ACP client 实现。

## 目标

当任务存在 Linked Skills 时：

1. READY 前必须完整读取每一个 Linked Skill 的 `SKILL.md`。
2. 任一必需 skill 无法定位、读取、完整性校验或理解时，bootstrap 必须为 `BLOCKED`，不得读取 query。
3. READY 后必须逐项判断 skill 是否适用于当前任务。
4. 适用的 skill 必须实际执行；不适用的 skill 必须记录与当前任务相关的明确理由。
5. 最终结果必须提供逐项状态和证据，禁止静默跳过。

没有 Linked Skills 时，维持现有 metadata-first bootstrap 行为。

## 非目标

- 不修改 Linked Skills 的存储来源或 Redis registry 数据结构。
- 不要求本次实现改造远端 ACP worker 为真正的双阶段网络握手。
- 不根据固定的 `metadata.md` Markdown 标题解析规则；完整 metadata 仍然是通用业务规则说明书。
- 不保证模型内部认知过程可由 adapter 独立证明。当前 one-shot 协议通过不可变 manifest、强制指令、receipt 和最终证据提供最强可观察约束。

## 方案选择

### 方案 A：仅加强提示词

在现有 client instructions 和 delegation content 中加入“必须使用 Linked Skills”。改动最小，但无法可靠发现漏读、路径错误或部分 skill 被静默跳过。

### 方案 B：不可变 manifest + contract + 执行证据（采用）

为每次 bootstrap 生成 `linked-skills-manifest.json`，由 contract 绑定其路径、数量、字节数和 SHA-256。客户端必须按 manifest 逐项加载，并在 bootstrap receipt 与最终结果中报告状态和证据。

该方案兼容现有 one-shot 调用，同时提供确定的 skill 清单、完整性校验和 fail-closed 行为。

### 方案 C：真正双阶段任务释放

服务端等待下游返回 READY 后再提供 query。约束最强，但需要修改远端 worker、消息协议、状态机和超时恢复机制，不纳入本次范围。

## 运行目录与产物

每次调用继续使用独立的不可变目录：

```text
<session_dir>/runs/<bootstrap_id>/
  metadata.md
  query.md
  plan-bundle.json
  bootstrap-contract.json
  bootstrap-receipt.json
  linked-skills-manifest.json
  clients/<client>.md
```

`linked-skills-manifest.json` 始终生成。没有 Linked Skills 时，其 `skills` 为空且 `required` 为 `false`。

## Linked Skills manifest

manifest 使用版本化结构：

```json
{
  "version": 1,
  "bootstrapId": "...",
  "policy": "read-all-use-applicable",
  "required": true,
  "count": 2,
  "skills": [
    {
      "id": "skill-id",
      "name": "skill-name",
      "agentIds": ["agent-id"],
      "skillPath": "/absolute/skill/path",
      "skillDocPath": "/absolute/skill/path/SKILL.md",
      "sha256": "...",
      "bytes": 1234,
      "readMode": "complete-to-eof"
    }
  ]
}
```

每一项必须具有稳定 ID、可展示名称、归属 agent 和 `SKILL.md` 绝对路径。adapter 在 dispatch 前读取每个 `SKILL.md` 并记录字节数与 SHA-256；缺失、空文件或不可读均产生 `MetadataBootstrapError`。

同一个 skill 被多个 agent 关联时，manifest 按 skill ID 去重，同时保留全部 `agentIds`，避免丢失归属信息。

## Contract 扩展

`bootstrap-contract.json` 新增 `linkedSkills`：

```json
{
  "linkedSkills": {
    "manifestPath": "<run_dir>/linked-skills-manifest.json",
    "required": true,
    "count": 2,
    "sha256": "...",
    "bytes": 2345,
    "readMode": "complete-to-eof",
    "policy": "read-all-use-applicable"
  }
}
```

dispatch 前校验：

- manifest 位于当前 bootstrap `runDir` 内。
- manifest 文件存在、非空且是合法 JSON。
- contract 中的字节数、SHA-256、数量、bootstrap ID 与 manifest 一致。
- manifest 中每个 `SKILL.md` 存在、非空，且字节数和 SHA-256 与实际文件一致。
- 当前 plan 的 bootstrap ID、runDir、contract path、plan bundle path 和 manifest path 相互绑定，拒绝跨 run 替换。

## Bootstrap 与任务执行状态

### READY 前

客户端必须：

1. 完整读取并校验 `metadata.md`。
2. 完整读取并校验 `linked-skills-manifest.json`。
3. 按 manifest 顺序完整读取所有 `SKILL.md` 到 EOF。
4. 记录每个 skill 的实际路径、字节数、SHA-256 和加载状态。
5. 只有所有 skill 均为 `LOADED` 时才能写 READY receipt。

任一项失败时写 `BLOCKED`，不得读取 `query.md` 或包含原始 input 的 `plan-bundle.json`。

### READY 后

客户端读取 query，并为每个 skill 生成且最终保留以下状态之一：

- `APPLIED`：skill 适用于当前任务，已按其工作流实际执行。
- `NOT_APPLICABLE`：skill 与当前任务不适用，附具体理由。

`LOADED` 只是 bootstrap 中间状态，不是任务完成状态。存在 Linked Skills 时，最终结果包含任何 `LOADED`、缺失状态或无理由的 `NOT_APPLICABLE`，均视为未满足业务约束。

## Claude Code 与 Codex 行为

### Claude Code

- 原生 Skill 能力可识别时，使用原生 Skill 调用执行。
- 无法按名称识别时，从 manifest 指定的绝对 `skillDocPath` 完整读取并严格执行。
- 不得因为 skill 未安装到 Claude Code 默认目录而跳过。

### Codex

- 从 manifest 指定的绝对 `skillDocPath` 完整读取 `SKILL.md`。
- 按 skill 内的引用解析规则加载必要资源并执行工作流。
- 不得仅复述 skill 内容来代替实际使用。

两个客户端都必须遵循相同 manifest、contract、receipt 和最终证据语义；客户端专属指令只描述加载机制，不改变业务约束。

## Receipt 与最终证据

`bootstrap-receipt.json` 的 Linked Skills 部分至少包含：

```json
{
  "linkedSkills": {
    "manifestSha256": "...",
    "expectedCount": 2,
    "loadedCount": 2,
    "skills": [
      {
        "id": "skill-id",
        "status": "LOADED",
        "path": "/absolute/path/SKILL.md",
        "sha256": "..."
      }
    ]
  }
}
```

最终业务回复必须包含逐项执行清单：skill ID、名称、`APPLIED` 或 `NOT_APPLICABLE`、执行证据或不适用理由。执行证据可以是遵循的关键步骤、工具调用、生成产物或验证命令，但不能只写“已使用”。

## 错误处理

adapter 在 dispatch 前发现 manifest、contract 或 skill 文件问题时，返回：

```json
{
  "success": false,
  "error_code": "ACP_METADATA_BOOTSTRAP_INVALID"
}
```

远端 executor 调用次数必须为零。下游在 bootstrap 阶段发现问题时写 BLOCKED receipt，并停止访问 query。

## 测试策略

测试必须覆盖：

1. 多个 Linked Skills 全部进入 manifest，去重后保留完整 agent 归属。
2. manifest 与 contract 的路径、数量、字节数和 SHA-256 一致。
3. Claude Code 和 Codex 指令均要求全部读取、适用则执行、不适用则说明理由。
4. delegation content 在 query access 前包含 manifest 门禁，且 READY 前禁止读取 plan bundle。
5. skill 文件缺失、为空、篡改或路径不合法时 fail-closed，executor 不被调用。
6. 跨 run 替换 manifest 或 contract 被拒绝。
7. 最终证据协议不接受停留在 `LOADED` 状态。
8. 无 Linked Skills 时 manifest 为空，原有 metadata-first 流程继续通过。

## 兼容性与后续演进

新增字段通过 manifest 和 bootstrap contract 的协议版本管理。未来其他 ACP client 只需实现相同状态机，不需要 adapter 识别新的 metadata 标题。

若后续升级为真正双阶段 worker handshake，可复用本设计的 manifest、contract 和 receipt，仅将 query 的释放从提示约束升级为服务端状态约束。
