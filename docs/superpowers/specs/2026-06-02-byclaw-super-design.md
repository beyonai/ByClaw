# 超级助手（byclaw-super）设计文档

- 状态：Draft
- 日期：2026-06-02
- 模块代号：byclaw-super
- 对外 agent_type：BYCLAW_SUPER

## 1. 背景与目标

超级助手是 ByClaw（鲸智百应）平台中一个独立运行的顶层 agent 服务。它通过 ReAct 模式理解用户输入，调度若干"数字员工"（远程子 agent，via by-framework Redis Stream 协议）和已挂载的 SKILL（参考 Anthropic Claude SKILL 规范）共同完成任务，最终整合结果回吐给用户。

它**不**挂载知识库、MCP、普通 Tool。新能力一律通过 `数字员工` 或 `SKILL + scripts` 的方式接入。

### 1.1 核心职责

1. 多用户、多会话独立运行；通过 by-framework GatewayWorker 协议对外服务。
2. 理解用户意图，按 ReAct 循环串行调度数字员工或 SKILL。
3. 中断 / 恢复：调用数字员工时复用 by-framework `call_agent` + `AGENT_DELEGATE_WAIT` 机制；
   超级助手自身的会话状态通过 LangGraph checkpoint 持久化到 opengauss。
4. 上下文管理：超阈值时自动一次性压缩历史。
5. 系统层与运行时配置可注入：授权数字员工、授权 SKILL、系统提示词补充、用户档案、时间 / 群 / 渠道。

### 1.2 不在范围

- 知识库 / 向量检索 / 长期记忆。
- 通用 Tool 接入框架（MCP、function-calling tool 商店等）。
- 多 agent 群聊、并行分发数字员工。
- BE 鉴权与权限管理（沿用现有 BE 体系，超级助手不本地鉴权）。

## 2. 技术选型与调研结论

### 2.1 框架

- **Python + LangGraph StateGraph**：与同仓 byclaw-data / byclaw-qa 一致；checkpoint / interrupt / resume 生态成熟。
- **opengauss** 作为 LangGraph checkpoint 存储；复用 `by_qa.qa.services.opengauss_checkpointer`（Apache-2.0）的实现，**移植到 byclaw-super 内部**而非 import by-qa，避免引入业务模块。
- **deepagents.middleware.skills.SkillsMiddleware**：提供 SKILL.md frontmatter 解析与 progressive disclosure 的 prompt 注入。
- **by-framework**：唯一对外协议；调度数字员工通过 `context.call_agent(target_agent_type=..., wait_for_reply=True, ...)`。

### 2.2 与开源 agent 框架的对齐

| 项目 | 是否参考 | 关键借鉴点 |
|---|---|---|
| LangGraph | 是 | StateGraph、ReAct、checkpointer、interrupt+Command(resume=...) |
| DeerFlow（字节 deer-flow） | 是 | thread 一等公民、progressive skill loading、Strict Tool-Call Recovery |
| OpenClaw | 是 | SKILL.md 目录布局作为磁盘协议 |
| Anthropic "Building effective agents" | 是 | Orchestrator-Workers 模式：超级助手 = orchestrator，数字员工 = workers |
| Hermes（NousResearch） | 否 | agent 自演化 SKILL 不适用于 ToB 审计场景 |
| AutoGen / CrewAI / Swarm | 否 | 群聊 / 模板化 / 去中心 hand-off 与本场景语义不符 |

### 2.3 拓扑方案选择

最终选择 **方案 A：单 ReAct 图，数字员工 + SKILL 暴露为工具**。Planner-Executor 与 Supervisor-Workers 在数字员工规模 < 10 时性价比低，等业务长起来再演进。

## 3. 系统架构与边界

```
                                ┌──────────────────────────────────────┐
   user / channel               │            byclaw-super              │
   ───────────────►   BE  ────► │  GatewayWorker(BYCLAW_SUPER)         │
                  by-framework  │  ┌────────────────────────────────┐  │
                  Redis Stream  │  │  process_command (Ask/Resume)  │  │
                                │  └──────┬─────────────────────────┘  │
                                │         ▼                            │
                                │  ┌────────────────────────────────┐  │
                                │  │  LangGraph ReAct StateGraph    │  │
                                │  │  inject_ctx → compact → agent  │  │
                                │  │       ▲                  │     │  │
                                │  │       └─── tools ◄───────┘     │  │
                                │  └──────┬─────────────────────────┘  │
                                │         │ checkpoint                 │
                                │         ▼                            │
                                │   opengauss (AsyncOpenGaussSaver)    │
                                └─────────┬────────────────────────────┘
                                          │ context.call_agent
                                          │ (by-framework, wait_for_reply=True)
                                          ▼
                            ┌─────────────────────────────────┐
                            │  byclaw-data / byclaw-qa / …    │
                            │  其他数字员工 worker            │
                            └─────────────────────────────────┘
```

### 3.1 模块职责

| 模块 | 职责 | 主要依赖 |
|---|---|---|
| `worker` | by-framework GatewayWorker 入口；翻译 AskAgent / Resume；处理 `AGENT_DELEGATE_WAIT` interrupt；流式回吐 SSE | by-framework, graph |
| `graph` | LangGraph StateGraph 构建；ReAct 循环；checkpointer 注入 | langgraph, tools, context |
| `state` | TypedDict 状态结构（messages、user_profile、authorized_*、compact_meta…） | — |
| `context_injection` | 把入参里的 user_profile / time / channel / group / 授权清单注入 system prompt（合并为单条 system message） | state, i18n |
| `compact_middleware` | AgentMiddleware 子类；每次 LLM 调用前动态检查阈值 + 一次性 LLM 摘要 + 悬空 tool_call 清理 | langchain.agents.middleware, llm, redis_model_config |
| `tools/digital_employee` | `call_digital_employee` LangGraph tool，仅产生 `AGENT_DELEGATE_WAIT` interrupt | by-framework |
| `tools/skill_runtime` | SkillsMiddleware 适配（MinioBackend）+ `read_file` + `bash` tool | deepagents, by-framework sandbox |
| `checkpoint` | opengauss saver（移植自 by-qa）+ factory | langgraph-checkpoint-postgres, psycopg |
| `redis_model_config` | 沿用 byclaw-qa 模式：从 Redis 取 LLM 配置（agent / summarizer 共用 provider） | redis |
| `config_loader` | 按 agent_id 从中间件拉取 SuperAssistantConfig（含授权、提示词、模型 ID 等），LRU + TTL 缓存 | discovery http client, minio |
| `i18n` | Msg 枚举 + zh_CN/en_US 消息表 + locale 归一化 + `set_lang/t` | — |

### 3.2 部署形态

- 独立 Python 进程，与 byclaw-data 同级（`byclaw-super/`）。
- 不与任何业务 BE / 数字员工源码耦合，对外只通过 by-framework 协议。
- 可水平扩展：多实例同 worker_id 由 by-framework 自带的 Redis 锁竞争。

## 4. LangGraph State 与节点拓扑

### 4.1 State

```python
class SuperState(TypedDict):
    # ── 由 by-framework 命令注入,每轮请求覆盖 ──
    request_id: str
    session_id: str
    user_code: str
    locale: str            # zh_CN / en_US
    agent_id: str          # 超级助手自身的 agent_id

    # ── 入参注入,inject_context 节点解析后写入 ──
    request_headers: dict  # 透传给数字员工的鉴权头(${VAR}占位)

    # ── 配置中心拉取(inject_context 节点写入,本轮只读)──
    authorized_employees: list[EmployeeMeta]
    authorized_skills: list[SkillRef]
    system_prompt_overrides: str | None
    user_profile: dict
    context_info: dict
    llm_config: LLMConfig          # {agent_model_id, summarizer_model_id?}
    compact_config: CompactConfig  # {threshold, keep_recent}

    # ── 对话与 ReAct 状态(持久化在 checkpoint 中)──
    messages: Annotated[list[BaseMessage], add_messages]
    compact_meta: CompactMeta      # {summary, last_compact_at, summary_tokens}
```

### 4.2 节点拓扑

```
       START
         │
         ▼
   ┌────────────────┐
   │ inject_context │  按 agent_id 调 config_loader 拉配置;
   │                │  set_lang(locale);
   │                │  把 user_profile / context_info /
   │                │  authorized_employees(meta) /
   │                │  上一轮 compact_meta.summary
   │                │  合并为单条 system message
   └──────┬─────────┘
          ▼
   ┌────────────────┐
   │     agent      │  LLM(messages, tools=[
   │     (LLM)      │    call_digital_employee,
   │                │    read_file, bash,
   │                │  ])
   │                │  外层装 SkillsMiddleware + CompactMiddleware
   │                │  CompactMiddleware.before_model:
   │                │    · ReAct 每轮 LLM 调用前都触发
   │                │    · 超阈值则压缩 messages 并写回 state
   │                │    · 同时清理悬空 tool_call
   └──────┬─────────┘
          │  ── tool_calls? ──┐
          │                   ▼
          │             ┌──────────┐
          │             │  tools   │  ToolNode 执行
          │             │          │  · call_digital_employee 内
          │             │          │    interrupt(AGENT_DELEGATE_WAIT)
          │             └────┬─────┘
          │                  │
          │                  ▼ (tool result 回 messages)
          │             back to agent
          ▼
       END (无 tool_calls 即视为最终答复)
```

### 4.3 关键约束

- 图结构静态。新数字员工 / 新 SKILL 不重建图，全部走 `state.authorized_*`。
- **同一时刻 messages 只允许一条 system message**（兼容不支持多 system 的 LLM 供应商）。
- 不实现 `finalize_answer` / `list_authorized_employees` 等冗余 tool（YAGNI）；终态由"无 tool_calls 的 AIMessage"自然识别。
- **上下文压缩走 middleware（before_model）而非独立节点**：ReAct 循环中途 messages 持续增长，节点级压缩只能在循环开头检查一次，循环中途超阈值会无法挽救；middleware 钩子每轮 LLM 调用前都会触发，能动态拦截。
- 悬空 tool_call 清理在 CompactMiddleware 中执行。

## 5. 数据流：一次完整请求的端到端流程

### 5.1 正常路径

```
1. BE/前端 → ByaiGatewayClient.send_message(
     target_agent_type="BYCLAW_SUPER",
     target_worker_id="byclaw-super-worker-N",
     session_id, content, user_code,
     extra_payload={"agent_id": "<super_assistant_agent_id>"},
     metadata={language, request_headers:{Beyond-Token:"${...}",...}})

2. by-framework Stream → byclaw-super GatewayWorker
3. process_command(AskAgentCommand, context):
   - thread_id = f"super_assistant:{user_code}:{session_id}"
   - 把 agent_id / session_id / user_code / locale / request_headers
     写入 SuperState 入参
   - graph.ainvoke(state,
       config={"configurable":{"thread_id":thread_id}})

4. LangGraph 节点流转:
   inject_context  → config_loader.load(agent_id) 拉 SuperAssistantConfig
                     → 写 authorized_employees / authorized_skills /
                       system_prompt_overrides / user_profile / context_info /
                       llm_config / compact_config
                     → set_lang(locale)
                     → 合并为一条 system message(含上一轮 compact_meta.summary)
   agent (LLM)     → 装 CompactMiddleware:
                       before_model 钩子在每次调用 LLM 前都执行,
                       超阈值则压缩 messages 并写回 state(见 §9)
                     → 装 SkillsMiddleware
                     → 生成 thought + tool_call(call_digital_employee/read_file/bash)
   tools           → 执行
   ↺ 回到 agent,直至无 tool_calls
   END

5. 全程 emit_chunk 回写主流(REASONING_LOG_DELTA / ANSWER_DELTA /
   APP_STREAM_RESPONSE),前端消费。
```

### 5.2 数字员工调用路径（异步委托）

调用数字员工时，超级助手本轮不等待结果，而是 `interrupt({reason_code:"AGENT_DELEGATE_WAIT", call_agent_kwargs:{...}})`。worker 检测到 interrupt 后调 `context.call_agent(**kwargs)` 实际派单，然后 return `{"status":"waiting"}` 静默挂起。

子员工运行期间所有 ask_user 由 by-framework 直接路由到前端，超级助手不感知；子员工完成后，by-framework 按 `metadata.resume_thread_id` 投递 ResumeCommand 回超级助手，`reply_data = 子员工最终结果`，graph 从 interrupt 处恢复并把结果作为 ToolMessage 注入。

### 5.3 config_loader

- 接口：`load(agent_id, *, request_headers) -> SuperAssistantConfig`
- 来源：参考 byclaw-qa 现有路径（DiscoveryHttpClient + minio）。
- 缓存：进程内 LRU + TTL（默认 60s），key = agent_id；中间件返回 4xx/5xx 时不写缓存、抛 ConfigurationError。

## 6. 中断与恢复

### 6.1 委托模型（沿用 byclaw-data）

```
       前端                 byclaw-super              数字员工
        │  AskAgent           │                          │
        │ ───────────────────▶│ thread=user_code:session│
        │                     │  graph 启动              │
        │                     │  ...inject_ctx/compact/  │
        │                     │     agent → tool:        │
        │                     │     call_digital_employee│
        │                     │       interrupt({        │
        │                     │         AGENT_DELEGATE_  │
        │                     │         WAIT,            │
        │                     │         call_agent_kwargs│
        │                     │       })                 │
        │                     │  ↓ checkpoint            │
        │                     │  worker 检测 reason_code │
        │                     │  调 context.call_agent ─▶│ 子员工独立运行
        │                     │  return waiting          │ (期间 ask_user
        │                     │                          │  框架直通用户)
        │                     │  ResumeCommand   ◀───────│ 子员工完成
        │                     │  (reply_data=child_result│ by-framework 按
        │                     │   resume_thread_id=...)  │ resume_thread_id
        │                     │  graph.invoke(           │ 路由回父 thread
        │                     │    Command(resume=...))  │
        │                     │  interrupt() 返回 child  │
        │                     │  → tool 把 child_result  │
        │                     │    转 ToolMessage        │
        │                     │  agent 节点继续 ↺        │
        │  最终答复 ◀──────────│                          │
```

### 6.2 实现要点

1. `call_digital_employee` tool 内**只调 interrupt，不调 call_agent**——LangGraph resume 会重跑节点入口代码，副作用必须放 worker 侧。
2. interrupt 携带的 `call_agent_kwargs.metadata` 必须含 `resume_thread_id = f"super_assistant:{user_code}:{session_id}"`、`resume_agent_type = "BYCLAW_SUPER"` 与 `parent_resume_target` 字段（与 byclaw-data 现有约定一致）。
3. worker._stream_graph 处理 `AGENT_DELEGATE_WAIT`：直接调 `context.call_agent(**kwargs)` + return waiting。
4. process_command(ResumeCommand)：以 `f"super_assistant:{user_code}:{session_id}"` 为 thread_id，`Command(resume=command.reply_data)` 恢复 graph。
5. 超级助手**不**自行发起 ask_user（它不会作为子 agent 被调用，无需）。SKILL 中如有"人工确认"语义，由 LLM 直接生成提问回复用户，下一轮请求继续 ReAct（与 Claude Code 一致）。
6. 悬空 tool_call 防御：在 CompactMiddleware.before_model 中处理（见 §9）。

## 7. 数字员工调用 Tool 设计

### 7.1 Tool 表

```python
[
  call_digital_employee(employee_code, query, payload?),
  read_file(path),
  bash(command, timeout?),
]
```

### 7.2 call_digital_employee

```python
def call_digital_employee(
    employee_code: str,
    query: str,
    payload: dict | None = None,
) -> str:
    employee = state.authorized_employees[employee_code]
    call_agent_kwargs = {
        "target_agent_type": employee.agent_type,
        "content": query,
        "wait_for_reply": True,
        "metadata": {
            "language": state.locale,
            "request_headers": state.request_headers,
            "resume_thread_id": f"super_assistant:{state.user_code}:{state.session_id}",
            "resume_agent_type": "BYCLAW_SUPER",
            "parent_resume_target": {
                "session_id": state.session_id,
                "agent_id": state.agent_id,
                "resume_via": "ResumeCommand.reply_data",
                "interrupt_reason": "AGENT_DELEGATE_WAIT",
            },
        },
        "payload": payload or {},
    }
    child_result = interrupt({
        "reason_code": "AGENT_DELEGATE_WAIT",
        "target_agent_type": employee.agent_type,
        "target_agent_name": employee.name,
        "delegate_content": query,
        "call_agent_kwargs": call_agent_kwargs,
    })
    return format_employee_result(child_result)
```

- `employee_code` 必须在 `state.authorized_employees`，否则 tool 直接返回错误，不打中间件。
- `payload` 透传子员工业务字段（如 byclaw-qa 需要的 `agent_id`），由配置中心维护 `extra_payload_template` 模板，超级助手 merge。
- `format_employee_result`：成功直接返回 final_text；失败前缀 `[employee-failed] reason`，由 agent LLM 自决重试 / 换员工。

## 8. SKILL 加载与 scripts 执行

### 8.1 复用 deepagents.middleware.skills.SkillsMiddleware

不自研 skill loader。`pip install deepagents`，把 `SkillsMiddleware` 装进超级助手的 graph，自带：

- SKILL.md frontmatter 解析（name / description / allowed-tools / metadata）+ 10MB 上限。
- 把 skill 列表（仅 name + description + 路径）渲染进 system prompt（progressive disclosure）。
- 不预读正文，由 LLM 调 `read_file` 自取。
- 零 Anthropic 锁定，依赖只有 pyyaml + langchain + langgraph，Apache-2.0。

### 8.2 我们要写的薄层

1. **MinioBackend**（适配 SkillsMiddleware `BackendProtocol`）
   - `list_skills()`: 返回 `state.authorized_skills` 中的元信息。
   - `read_skill_file(path)`: 从 minio 拉取文件。
   - 路径前缀：`{FILE_STORAGE_MINIO_MOUNT_PATH}/byclaw-{user_code}/by/{skill_resource_id}/`。

2. **read_file tool** —— LLM 读 SKILL.md 正文与 references。
   - 限定根目录在授权 SKILL 范围（防越权读）。

3. **bash tool** —— LLM 跑 scripts。
   - 沙箱用 by-framework `worker.sandbox.hook_sandbox`（byclaw-data 已用），active_workspace 提供 cwd 隔离。
   - 限制：超时（默认 60s，SKILL frontmatter `metadata.default_timeout` 可覆盖）；命令白名单 = `python|python3|bash|sh|node`；环境变量过滤；request_headers 中的 token 仅当 SKILL frontmatter `metadata.needs_request_headers: true` 时显式注入。
   - 输出：stdout + stderr + exit_code 拼为字符串，截断 8KB。

### 8.3 不做的事（YAGNI）

- 不做 `load_skill(name)` 显式工具——SkillsMiddleware 已通过 system prompt 暴露 skill 列表与路径。
- 不做 `run_script(skill_name, ...)` 包装——LLM 直接 bash 跑路径已在 SKILL.md 里。
- 不做语言级沙箱（PyPy / nsjail / firejail）。
- 不预扫所有 minio skill 目录——只读授权范围。

## 9. 上下文管理（CompactMiddleware）

### 9.1 为什么用 middleware 而不是节点

ReAct 循环中 messages 在 `agent → tools → agent → tools → ...` 之间持续增长。如果压缩做成图入口处的固定节点，只能在单轮请求开头检查一次：循环中途超阈值时本轮没机会再压缩，最终 LLM 调用因 context window 溢出失败。

LangChain `create_agent` 的 AgentMiddleware 提供 `before_model` 钩子，每次进 agent 节点（即每次调用 LLM）前都会触发，返回的 dict 通过 graph reducer 合入真实 state，由 checkpointer 持久化。这是处理"循环中途压缩"的正确切入点。

### 9.2 单 system 合并

`state.messages` 同一时刻**只有一条 system message**，由 inject_context 节点重建：

```
================ 角色 / 身份 ================
{system_prompt_overrides}

================ 用户档案 ================
{user_profile yaml}

================ 当前上下文 ================
- 时间: {context_info.now}
- 所在群: {context_info.group}
- 渠道: {context_info.channel}

================ 授权数字员工 ================
{employees as bullet list with name/desc/boundary}

================ 可用 SKILL ================
{SkillsMiddleware 渲染的 skill name+description+path 列表}

================ 历史摘要(如有) ================
{compact_meta.summary or "无"}

{LANGUAGE_INSTRUCTION}
```

各段标题通过 `t(Msg.SECTION_*)` 渲染，按 `state.locale` 切换 zh_CN / en_US。

### 9.3 CompactMiddleware

```python
class CompactMiddleware(AgentMiddleware):
    state_schema = ...  # 扩展 compact_meta 字段(如未由 SuperState 覆盖)

    def before_model(self, state, runtime) -> dict | None:
        threshold = state["compact_config"].threshold
        keep_recent = state["compact_config"].keep_recent
        messages = state["messages"]

        # 1. 悬空 tool_call 清理(每轮都做,成本极低)
        cleaned, dangling = strip_dangling_tool_calls(messages)

        # 2. 阈值判断
        if token_estimate(cleaned) <= threshold and not dangling:
            # 仅在确实清理过悬空 call 时才写回,避免无谓 reducer 触发
            return {"messages": cleaned} if cleaned is not messages else None

        # 3. 压缩
        old_part, recent_part = split_messages(cleaned, keep_recent)
        summarizer = redis_model_config.get_llm(state["llm_config"].summarizer_model_id
                                               or state["llm_config"].agent_model_id)
        summary = summarize(summarizer, old_part, dangling)

        new_compact_meta = {
            "last_compact_at": now(),
            "summary": summary,
            "summary_tokens": estimate(summary),
        }

        # 4. 写回 state(下一轮 inject_context 会把 summary 合并到 system)
        return {
            "messages": [system_of(messages)] + recent_part,  # 用 RemoveMessage 也可
            "compact_meta": new_compact_meta,
        }
```

要点：
- 装在 `create_agent(middleware=[SkillsMiddleware(...), CompactMiddleware(...)])`，外层先后顺序按 langchain 文档"outer wraps inner"约定，CompactMiddleware 放在 SkillsMiddleware 之后即可。
- `before_model` 返回的 dict 会被 graph reducer merge 到 state，并由 PostgresSaver 持久化；下一轮请求恢复 thread 时 `compact_meta.summary` 仍在。
- 摘要写入 `state.compact_meta.summary`，**不**直接追加进 messages 当 system；inject_context 节点在下一轮请求开头读取并合并到唯一一条 system 中（保持单 system 约束）。
- 单轮请求内 ReAct 循环可能多次触发：第一次压缩后 messages 缩小，后续轮次再增长到阈值时再次压缩，叠加压缩交给摘要 prompt 自身处理（让模型理解"这是对已有摘要的再压缩"）。

### 9.4 摘要 LLM 配置（沿用 byclaw-qa Redis 模式）

- byclaw-super 启动时初始化一份 `RedisModelConfigProvider(redis_client)`。
- agent 主 LLM 与摘要 LLM 都从 provider 取，按 modelId 区分。
- 中间件返回的 SuperAssistantConfig 增加 `llm.summarizer_model_id`（可选；缺省回退到 agent 主模型）。
- inject_context 节点解析后写到 `state.llm_config`。
- CompactMiddleware `before_model` 中 `provider.get_llm(state.llm_config.summarizer_model_id or state.llm_config.agent_model_id)` 取实例。

### 9.5 配置项

| 项 | 来源 | 默认 |
|---|---|---|
| AUTO_COMPACT_THRESHOLD | SuperAssistantConfig.compact.threshold | 100000 tokens |
| COMPACT_KEEP_RECENT | SuperAssistantConfig.compact.keep_recent | 8 |
| 摘要 LLM modelId | SuperAssistantConfig.llm.summarizer_model_id | 回退到 agent_model_id |

## 10. opengauss 持久化

### 10.1 移植 by-qa 的 OpenGauss Saver

不直接 import by-qa（依赖过重）。把 `by_qa.qa.services.opengauss_checkpointer.OpenGaussSaver / AsyncOpenGaussSaver` 与 `checkpointer_factory` 移植到 byclaw-super：

```
byclaw-super/src/byclaw_super/checkpoint/
  __init__.py
  opengauss_saver.py   # Adapted from by-qa (Apache-2.0)
  factory.py           # create_checkpointer_async / close_checkpointer_async
```

仅保留 opengauss 实现 + factory，不带 sqlite / memory 分支（测试需要时直用 langgraph 自带 InMemorySaver）。

### 10.2 启动接入

```python
async def start_heartbeat(self):
    self.checkpointer = await create_checkpointer_async(
        dsn=settings.opengauss_dsn,
        schema=settings.db_schema,
    )
    self.graph = builder.compile(checkpointer=self.checkpointer)
```

`thread_id = f"super_assistant:{user_code}:{session_id}"`。

### 10.3 不建独立 history 表

LangGraph saver 已经把整个 graph state（含 messages）作为 checkpoint 一部分写入 `checkpoints` 表，按 thread_id 完整恢复。**会话历史 = checkpoint 最新 state**，不重复落库。

前端展示用的会话流走 by-framework 标准链路（`emit_chunk` 顺带写到 by-framework 的 stream / 历史，由 by-framework 自身存储），不在本模块管。

### 10.4 配置与依赖

| 项 | 来源 |
|---|---|
| DB_HOST/PORT/USER/PASS/DATABASE/SCHEMA | 环境变量（.env / K8s Secret），与全仓 .env.example 一致 |
| checkpointer backend | 固定 opengauss |
| 依赖 | langgraph-checkpoint-postgres、psycopg[binary] |

启动期 opengauss 不可达 → fail fast 退出，by-framework worker 重启外壳兜底。

## 11. 错误处理

### 11.1 错误分类与策略

| 类别 | 触发场景 | 处理 | 用户可见行为 |
|---|---|---|---|
| 配置错误 | 中间件 4xx/5xx；agent_id 无效；授权配置缺字段 | inject_context 抛 `ConfigurationError`，graph 终止 | 「配置加载失败，请联系管理员」 |
| 数字员工调用失败 | 子员工 reply_data 含 status=FAILED | tool 返回 `[employee-failed] reason` 的 ToolMessage，agent 自决重试 / 换员工 / 直接答复 | LLM 自决；典型情况下说明哪个员工失败 |
| 数字员工取消 | 用户在子员工 ask_user 阶段取消 | reply_data status=CANCELLED → ToolMessage("用户取消了该子任务") | LLM 通常以"已取消"回复 |
| LLM 调用错误 | 主 agent / 摘要 LLM 网络 / 限流 / 超时 | 节点级 retry（最多 3 次，指数退避）；最终失败抛 `LLMError`，graph 终止 | 「服务繁忙，请稍后重试」 |
| 悬空 tool_call | 进程崩溃恢复后 messages 中存在无 ToolMessage 配对的 AIMessage.tool_calls | CompactMiddleware.before_model 清理 + 注入占位 ToolMessage | 透明，LLM 自然续 |
| opengauss 不可达 | 启动期 / 运行期连接失败 | 启动期 fail fast；运行期瞬时错误 retry 3 次后抛 `PersistenceError` | 「会话暂时不可用」 |
| SKILL 资源缺失 | minio 路径不存在 / SKILL.md 损坏 | SkillsMiddleware 跳过 + 记 warning；不阻断 graph | LLM 看不到该 skill |
| bash / read_file 错误 | 脚本超时 / exit_code 非零 / 路径越权 | tool 返回错误字符串，含 stderr 截断 | LLM 自决 |
| 图意外终止 | 节点异常未捕获 | 顶层 try/except → emit_chunk 错误 + APP_STREAM_RESPONSE 收尾 | 「处理失败：{reason}」 |
| 委托超时 | call_digital_employee interrupt 超过 30 分钟未收到 ResumeCommand | 后台监控扫 opengauss 长 interrupt thread，注入超时 reply_data | tool 返回"子员工响应超时" |

### 11.2 异常类型

```python
class ByclawSuperError(Exception): ...
class ConfigurationError(ByclawSuperError): ...
class LLMError(ByclawSuperError): ...
class PersistenceError(ByclawSuperError): ...
class SkillError(ByclawSuperError): ...
class EmployeeCallError(ByclawSuperError): ...
```

业务"失败"（数字员工说不出答案 / 用户取消 / SKILL 没有 scripts）**不是异常**——走 ToolMessage 文本路径让 LLM 自决。

### 11.3 与 by-framework 的协作

任何抛到 worker 顶层的异常 → `process_command` 捕获 → emit_chunk + APP_STREAM_RESPONSE 收尾 → return `{"status":"done","error":str(exc)}`，单会话错误不让 worker 进程退出（fail fast 仅限启动期资源）。

### 11.4 日志

- 沿用 `from by_framework.common.logger import logger`。
- 关键打点：`agent_id` / `thread_id` / `node` / `tool_call_id` / `request_id`。
- 错误日志带堆栈 + state 摘要（messages 长度、激活 skill、pending tool_call_id）；不打 token / 敏感字段。

### 11.5 不做的事

- 不实现自定义熔断 / 限流（worker 层已有，重复实现是 YAGNI）。
- 不做错误重试 LLM 自动改写。
- 不做 fallback 到本地缓存的中间件配置（启动失败比用过期配置更安全）。

## 12. 测试与多语言

### 12.1 测试策略

| 层 | 范围 | 工具 | 关键用例 |
|---|---|---|---|
| 单元 | 纯函数：token_estimate、摘要拼装、占位符替换、ToolMessage 格式化、悬空 tool_call 清理、frontmatter 解析适配层 | pytest + pytest-asyncio | 边界值、清理对位、frontmatter 失败兜底 |
| 节点 / middleware | LangGraph 节点：inject_context / agent / tools；以及 CompactMiddleware.before_model | pytest + 假 LLM（langchain-core FakeChatModel）+ 假中间件 | 节点输入输出 state 字段对齐；middleware 钩子触发时机；不依赖真实 LLM / 网络 / opengauss |
| 集成 | 整张 graph 跑一轮：AskAgent → N 次 tool → END | pytest + InMemorySaver + mock by-framework call_agent | ① 无委托直接答；② 委托一员工成功；③ 委托失败 LLM 重试；④ AGENT_DELEGATE_WAIT 后 ResumeCommand 恢复 |
| 对接 | byclaw-super worker ↔ by-framework Stream ↔ 伪员工 worker | docker-compose（redis + opengauss + byclaw-super + 最小 echo worker） | 端到端流式 + interrupt + resume |
| 回归 | 真实环境冒烟 | 部署联调环境 | 手工，不在 CI |

不写"对真实 LLM"的 e2e 测试（不稳定、贵）；用录制式 fixture 替代。不做性能 / 压测脚本入仓。

测试组织：

```
byclaw-super/tests/
  unit/
  nodes/
  integration/
    fixtures/
      fake_employees.py
      fake_skills/
  conftest.py
```

覆盖率目标：核心节点 + tool 实现 ≥ 70%。

### 12.2 多语言（i18n）

沿用 byclaw-qa 的 `i18n.py` 模式：Msg 枚举 + 消息表 + `set_lang(lang)` + `t(Msg.X)`。

```
byclaw-super/src/byclaw_super/i18n/
  __init__.py     # 暴露 set_lang / t / Msg
  messages.py     # Msg 枚举 + 多语言消息表(zh_CN / en_US)
```

覆盖范围（仅"系统层"文案）：

- system prompt 模板的固定段落标题。
- 错误兜底文案（§11 表的"用户可见行为"列）。
- ToolMessage 错误前缀（`[employee-failed]`、"用户取消了该子任务"、"先前调用未完成"）。
- 占位 ToolMessage（悬空清理用）。

LLM 输出不做翻译——通过 system prompt 末尾注入 `LANGUAGE_INSTRUCTION`（"Always respond in the same language as the user input"），沿用 byclaw-qa `DEFAULT_LANGUAGE_INSTRUCTION` 模式。

locale 来源：`command.header.metadata.language` → 归一化（zh-cn/zh_cn → zh_CN，en-us/en_us → en_US，其他 → 默认 zh_CN）→ `state.locale`。inject_context 节点入口调 `set_lang(state.locale)`。

支持语言起步：zh_CN（默认）+ en_US，其他回退到 zh_CN。

### 12.3 CI

- 现有 `.github/workflows/ci.yml` path-based 矩阵增加 `byclaw-super` 路径触发。
- 命令：`uv sync && uv run pytest -m "not integration"`（integration 标记跑在专用 docker-compose 环境）。
- ruff lint。
- 不引入 codecov。

### 12.4 文档

- `byclaw-super/README.md`：模块定位、启动方式、环境变量、与 by-framework 协议要点。
- `byclaw-super/docs/`：详细架构图、配置项表、SKILL 编写规范（参考 Claude SKILL）。
- 不重复 spec 内容；spec 落在 `docs/superpowers/specs/`。

## 13. 工程结构

```
byclaw-super/
  pyproject.toml
  Dockerfile
  start.sh
  README.md
  src/byclaw_super/
    __init__.py
    main.py                    # 入口,参考 byclaw-data/main.py
    settings.py                # pydantic-settings, 提供 build_opengauss_dsn 等
    worker.py                  # GatewayWorker(BYCLAW_SUPER); process_command 与 _stream_graph
    runtime.py                 # 启动期环境归一化(语言/日志/字符集)
    graph/
      __init__.py
      builder.py               # StateGraph 构建,装 SkillsMiddleware + CompactMiddleware
      state.py                 # SuperState / EmployeeMeta / SkillRef / CompactMeta...
      nodes/
        inject_context.py
      middleware/
        compact.py             # CompactMiddleware (before_model)
    tools/
      __init__.py
      digital_employee.py
      skill_runtime.py         # MinioBackend + read_file + bash
    config_loader/
      __init__.py
      loader.py                # 调中间件 + LRU/TTL 缓存
      models.py                # SuperAssistantConfig / EmployeeMeta / SkillRef
    redis_model_config.py      # 沿用 byclaw-qa 的 RedisModelConfigProvider 模式
    checkpoint/
      __init__.py
      opengauss_saver.py       # Adapted from by-qa (Apache-2.0)
      factory.py
    i18n/
      __init__.py
      messages.py
    exceptions.py
  tests/
    unit/
    nodes/
    integration/
```

## 14. 与现有仓的协作

### 14.1 不修改现有模块

byclaw-super 是新增顶层模块，不动 byclaw-fe / byclaw-be / byclaw-data / byclaw-qa 任何代码。

### 14.2 BE 侧需要的能力（外部依赖）

- 中间件 / minio 中提供 `SuperAssistantConfig`（按 agent_id 拉取），含授权数字员工清单、授权 SKILL 列表、system_prompt_overrides、user_profile、context_info、llm 配置、compact 配置。具体接口由 BE 维护，byclaw-super 只通过 DiscoveryHttpClient 调用。
- 数字员工的 worker 仍各自运行（byclaw-data / byclaw-qa 等不改）；by-framework `call_agent` 协议已支持 `wait_for_reply=True` 与父子 thread 路由。

### 14.3 commit 约定

新增模块 commit 走 `feat(super): ...` 等 scope（在 `.github/commit-convention.md` 中追加 `super` scope）。

## 15. 决策与遗留

### 15.1 已决策

- 框架：LangGraph + ReAct 单图。
- 中断：仅 `AGENT_DELEGATE_WAIT` 一种类型，复用 byclaw-data `_build_agent_delegate_tool` 的副作用隔离原则。
- thread_id：`f"super_assistant:{user_code}:{session_id}"`。
- 上下文管理：CompactMiddleware 通过 `before_model` 钩子在 ReAct 循环每轮 LLM 调用前动态压缩，单 system 合并，悬空 tool_call 清理。
- SKILL 加载：复用 deepagents.SkillsMiddleware + MinioBackend；scripts 用 bash tool 跑，by-framework 沙箱隔离。
- 持久化：移植 by-qa 的 OpenGauss Saver；不另建 history 表。
- i18n：zh_CN / en_US 起步，沿用 byclaw-qa 模式。
- 配置注入：入参只带 agent_id，超级助手内部按 agent_id 从中间件拉 SuperAssistantConfig。
- LLM 配置：沿用 byclaw-qa Redis 模式（RedisModelConfigProvider）。

### 15.2 遗留待落地

- `SuperAssistantConfig` 的具体 BE 接口路径、字段定义需要与 BE 团队对齐（建议复用现有 `queryDigEmployee*` 系列扩展，避免新增端点）。
- opengauss 上 LangGraph PostgresSaver DDL 兼容性需要联调环境实测；如有 SQL 方言不兼容，在 `opengauss_saver.py` 中按 by-qa 现有 patch 处理。
- 委托超时观察者的实现位置（byclaw-super 内 Cron / 独立 sidecar / by-framework 加能力）实施时再决定，本设计仅声明语义。
- 文档中的 LANGUAGE_INSTRUCTION 文案以 byclaw-qa 现有版本为准，i18n.messages 写入时直接迁移。


