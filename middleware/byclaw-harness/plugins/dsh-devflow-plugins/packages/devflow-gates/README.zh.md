# @zhchxiao123/dsh-devflow-gates

[English](README.md) | 中文

[`devflow/transition`](../devflow/README.zh.md) waterfall 上的命令门禁策略：配置了门禁的边在 journal 提交前经 `ctx.shell` 运行其门禁命令，失败的命令以携带有界输出摘要的拒绝理由否决移动。门禁命令完全存在于部署配置中——全局按边列表加按卡片 id 的覆盖——绝不在卡片的可写文件里，因此开发中的 agent 无法改写自己的门禁。

## 行为

对边 `from->to` 的一次尝试，守卫命令为存在时的 `cards[<卡片 id>][edge]`，否则 `edges[edge]`，否则无（无门禁的边原样委派）。命令经 `ctx.shell.resolve`/`run` 在卡片的工作区目录——attempt 所携 devflow root 的父目录——运行，因此 `pnpm run test` 这样的门禁检查的是这张卡所属的代码；该边的 `policies` 项可以提供自己的 timeout、工作目录，以及命令是否并发。顺序执行是默认值，第一个非零退出或被杀的命令即否决且不再运行后续命令；`parallel` 模式运行全部命令，并在否决里点名每个失败。否决携带 `gate command failed: <command> (exit N | killed): <stderr+stdout 摘要>`，按 `maxFailureOutputChars` 截断，并带上 `full output: <path>`。全绿门禁委派给其余 waterfall 监听器。

## 人工审批

列入 `approvals` 的边在其命令通过后额外要求一次一次性人工决定，经交互面（`ctx.approval`）应答——绝不经过模型对话，因为门禁的存在就是为了检查 agent。审批请求路由到发起 agent 的应答者（`attempt.by.session` 经 `ctx.agents` 解析）；获批的移动在其 journal 条目携带 `gate: { approvedBy: { kind: 'human' } }`，被拒绝或撤回的提问否决且无副作用。无可达应答者时——非 agent 发起者、未组合 approval 服务、或缝 fail-closed 的 `unavailable`——移动被否决且卡片停驻 `blocked`（`awaiting human approval for <edge>`，actor 为 `command devflow-gates`），使无人值守运行干净退出；人恢复卡片到被打断的阶段后重新尝试移动。

## 配置

```yaml
- id: devflow-gates
  name: '@zhchxiao123/dsh-devflow-gates'
  config:
    edges:
      'developing->reviewing': ['pnpm run test']
    cards:
      0042-retry-backoff:
        'developing->reviewing': ['pnpm run test -- packages/llm']
    policies:
      'developing->reviewing':
        timeoutMs: 900000
        parallel: true
    maxFailureOutputChars: 2000
```

| 键 | 默认值 | 含义 |
|---|---|---|
| `edges` | `{}` | 按 `from->to` 边的全局门禁命令。 |
| `cards` | `{}` | 按卡片覆盖，替换该边的全局列表。 |
| `approvals` | `[]` | 命令通过后还需一次性人工审批的边。 |
| `policies` | `{}` | 每条边的 `timeoutMs`、`workdir` 与 `parallel`。 |
| `maxFailureOutputChars` | `2000` | 否决理由中失败输出摘要的字符上限。 |

不是 `<from>-><to>` 形式或含未知位置名的边键使加载失败，`policies` 与 `edges` 一样；非正的 `timeoutMs` 也使加载失败。

**运行测试套件的边应设置 `timeoutMs`。** 执行器默认值适合一次检查，而 `developing->reviewing` 运行 `pnpm run test` 是多数部署首先配置的门禁；套件超出默认值时会被杀死，门禁会把自身预算不足报告成代码失败。

`parallel` 用顺序短路换一次往返：全部命令都会运行，否决点名每个失败。它适合 lint、类型检查、测试这类彼此独立的命令，不适合后一步依赖前一步通过的链条。

## 产物落在哪

无需配置。每一份产物都落在**正在流转的那张卡片自己的 devflow root** 下：

```
<devflow root>/
  reports/gates/{card}-{from}-{to}-r{rev}.log
```

落在 root **之内**而不是旁边，因为 [`dsh-devflow-fs-guard`](../devflow-fs-guard/README.zh.md) 按目录名保护 root —— 于是被本闸门判决的那个 agent 无法用自己的文件工具改写这份记录。一个 harness 服务多个项目时，各项目的产物留在各自项目里，没有互相覆盖的路径。

## Model Experience

None, as gate vetoes reach a model only through the devflow tools' rejection text; this plugin registers no prompt or schema.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **审批需要活跃的发起 agent** — approval 缝是 agent 作用域的，人或命令发起的移动在审批边上总是走停驻 blocked 路径；连 [`/devflow move`](../command-devflow/README.zh.md) 也经同一执行器、没有旁路，审批边只有携带可达审批应答者的 agent 才能跨过。
- **门禁结果不缓存也不增量执行** — 每次尝试都会完整重跑该边的命令，因此返工循环每一轮都要支付整套成本。复用结果需要知道命令依赖哪些输入，而本包没有这个概念。
- **完整失败输出写进文件，而不是卡片** — 日志是该卡片 devflow root 下的一个普通文件，因为门禁无法对正在被自己守卫的卡片登记 artifact：store 按卡片串行化，这道 waterfall 又运行在该 transition 内部，调用 `attachArtifact` 会互相等待。把输出放进卡片需要一个允许从自身 waterfall 内部写入的 seam。

## 必需的机械校验器

部署可以独立于 shell 命令和人工/模型批准，要求具名 validator。作用域由规范化的绝对 `.devflow` 根目录、可选卡片 id 和显式边构成。省略 `cards` 表示该根下全部卡片，空数组无效；快捷完成边也应纳入策略。

```yaml
requiredValidators:
  - root: /absolute/project/.devflow
    edges: [testing->done, reviewing->done, developing->done]
    validators: [midscene]
    timeoutMs: 300000
```

提供方通过 `ctx.get('devflowValidators')` 注册并在卸载时注销。每次尝试接收新的 `requestId`、store 解析出的转移身份、截止时间和 `AbortSignal`；必须执行新的检查并在取消时清理自有资源。成功返回 `{ allowed: true, runId, summary }`，失败返回不含凭证的 `{ allowed: false, reason }`。

提供方缺失、作用域无法解析、异常、空证据、超时或卸载均拒绝转移；迟到的结果不能放行。超时/卸载时报告清理尚未确认，提供方仍负责有界清理。下游批准期间更换提供方也会被拒绝。成功引用记录在现有 journal 的 `gate.checks` 中。

这些要求属于部署策略，不是 agent 可编辑的卡片字段。门禁插件必须启用；集成在显示必需验收可用前应检查引擎是否挂载。

shell 命令先于必需 validator 执行，避免构建在验收后改变工作区。成功结果可附带同进程 `revalidate()` 回调，在其余批准完成后、提交前复核，返回 false 或抛出异常均拒绝。Midscene 用它复核源码、suite 和部署回执，不重放浏览器动作，也不把可执行回调序列化到 journal。
