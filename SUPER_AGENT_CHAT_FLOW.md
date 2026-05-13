# 超级助手对话（superAgentChat）一条消息的完整生命周期

> 入口：`byclaw-fe` 的 `QueryInputChat` → `useChat` → `useSseSender` → `POST /byaiService/chat/superAgentChat`
> 终点：`byclaw-be` 的 `ChatChannelController.postChat` → `WebChannelService` → `AssistantChatService.chat` → `ScriptService.execute` → `RouteService.route` → Gateway SDK → Python Worker → Redis Stream → 写回 SSE
>
> 本文从前端"用户敲下回车"的那一刻开始，逐层跟到后端把首词写出去，再回到前端把消息渲染成 UI。每个分叉点都列出来。

---

## 0. 总览（一图胜千言）

```
┌────────────────────────────────────────────────────────────────────────────┐
│                              byclaw-fe (浏览器)                            │
│                                                                            │
│  RichInput ──► QueryInputChat ──► onSendQuery ──► onSend (ChatLayoutComp)  │
│                                                       │                    │
│                                                       ▼                    │
│                                                 useChat.sendQuery          │
│                                                       │                    │
│                                createMessage(query)   │   createMessage(answer 占位)
│                                                       ▼                    │
│                                                 useSend.send               │
│                                                       │                    │
│                                                       ▼                    │
│                                          SendHelper.send (SSE)             │
│                                                       │                    │
│                                                       ▼                    │
│              fetchEventSource → POST /byaiService/chat/superAgentChat      │
└────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         │  HMAC 签名 + token + lang 头部
                                         ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                              byclaw-be (Spring Boot 3, Java 21)            │
│                                                                            │
│  ChatChannelController.postChat (POST /chat/superAgentChat)                │
│      │ @ChatCallLimit (并发/频率拦截)                                      │
│      │ CompletionsUtils.setResHeader(SSE)                                  │
│      ▼                                                                     │
│  ChannelServiceFactory.getService(accessTerminal)                          │
│      │   "Web" → WebChannelService                                         │
│      │   "App" → AppChannelService                                         │
│      │   "DingDing" → DingtalkChannelService                               │
│      ▼                                                                     │
│  WebChannelService.chat → AssistantChatService.chat                        │
│      │ - applyDefaultPersonalAssistant (无 agentId 时挂默认数字员工)        │
│      │ - handleSessionLogic (无 sessionId 创建 / 否则校验群成员)            │
│      │ - 写 createSession / 处理固化记忆 (FIXMEMORY 提前 return)            │
│      ▼                                                                     │
│  ScriptService.execute (extends AbstractChatProcess, 模板方法)             │
│      ├── prepareParams: 生成 askMsg/answerMsg id, initialization 事件       │
│      ├── handleGatewayMode → RouteService.route                            │
│      │     ├── INTERFACE 集成 → InterfaceRouteService.route                │
│      │     ├── A2A 集成      → A2aRouteService.route                       │
│      │     └── 默认走 Gateway SDK + Redis Stream                           │
│      ├── storeMessage: 持久化 + 写 appStreamResponse                       │
│      └── afterProcess (token 统计、推荐问题、多端广播等)                   │
└────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         │ Gateway SDK gatewayClient.sendMessage()
                                         ▼
┌────────────────────────────────────────────────────────────────────────────┐
│         byclaw-data / byclaw-qa / byclaw-exe 中的 Worker (Python / OpenClaw) │
│                                                                            │
│  by-framework: run_worker(WorkerCls, worker_id, redis_*, consumer_group)   │
│      │ XREADGROUP 拉取 byai_gateway:worker:{worker_agent_type}:cmd_stream  │
│      ▼                                                                     │
│  WorkerCls.process_command(command, context)                               │
│      ├─ AskAgentCommand   → 新一轮对话                                     │
│      └─ ResumeCommand     → 恢复 ask_user 之后的图执行                     │
│      │                                                                     │
│      │  byclaw-data → DataCloudWorker：langgraph + datacloud_analysis      │
│      │  byclaw-qa   → InstantSearchWorker：by-qa InstantSearchEngine + 知识库
│      │  byclaw-exe  → OpenClaw Gateway + byai-channel webhook (用户沙箱)   │
│      ▼                                                                     │
│  context.emit_chunk(StreamChunkEvent, event_type=ANSWER_DELTA/...)         │
│      │ XADD 到 byai_gateway:session:{sid}:data_stream                      │
│      ▼                                                                     │
│  context.flush_to_history (走 BE /open/api 回写历史) + ask_user/complex_ask │
└────────────────────────────────────────────────────────────────────────────┘
                                         │
                              Redis Stream: byai_gateway:session:{sid}:data_stream
                                         │
                                         ▼
            SessionStreamManager + RedisStreamMessageListener (BE 内)
                                         │
                                         │ JSONObject 投入 ctx.gatewayEventQueue
                                         ▼
              请求线程 (Tomcat http-nio-*) 在 RouteService.route 的
              while 循环里 poll(5min) → 写到原 HttpServletResponse 的 SSE 流
                                         │
                                         ▼
                                浏览器 fetchEventSource onmessage
                                         │
                                         ▼
                       SendHelper 按 event 分流 → useChat callback
                                         │
                       sessionInfoHandler / messageIdHandler / textHandler …
                                         ▼
                                MessageList 渲染气泡 / 思考过程 / 推荐问题 / 卡片
```

---

## 1. 前端起点：用户敲下回车

### 1.1 富文本输入与 `superAgentMode` 开关

`byclaw-fe/src/components/QueryInput/Chat/index.tsx`

`QueryInputChat` 继承自 `QueryInputBase`（`src/components/QueryInput/queryInputBase.tsx`），底部工具栏渲染了一个**超级助手**按钮：

```tsx
// QueryInput/Chat/index.tsx:311-322
<Button
  onClick={() => this.setState((prev) => ({ ...prev, superAgentMode: !prev.superAgentMode }))}
  ...
>
  {getIntl().formatMessage({ id: 'queryInput.superAgent' })}
</Button>
```

- 打开后整个输入框的 `agentId` 强制传 `'-1'`、`agentType` 强制传 `''`，并屏蔽 `@`/`#` 提及（见 `chechCannotAt`）。这就是"超级助手"语义：让后端按 `agentId == -1` 走通用调度而不是绑定到某个具体数字员工。

### 1.2 组装发送 payload

`QueryInputChat.getSendPayload`（`Chat/index.tsx:101-188`）从 state/props 拼出：

```ts
{
  queryQuestion: 用户输入,
  payload: {
    deepThink, enterpriseInformation, connectNet,
    files: [...],
    extParams: { files: [...], chatType?: 'MCP_CHAT' /* 当带文件时 */ },
    mode,                       // base/expert/searchQuery/smartOffice
    agentType: superAgentMode ? '' : myAgentType,
    agentId:   superAgentMode ? '-1' : agentId,
    ...chatSettings,           // dataCloud / functionCloud / memory
  },
  msgOpt: { queryMsg: { imageList, fileList } },
  resourceList: this.state.resourceList,
}
```

**支线**：

- 带文件：`fileList` 必须 `status === 'done'`，否则 `throw` 中断；同时把 `chatType` 设为 `MCP_CHAT`（问数链路）。
- 仅文本：跳过文件分支。
- 同时勾选了"联网搜索"按钮（`onSwitchOnlineSearch`）：会触发 `EventEmitter.emit('queryInput-set-schema', ...)` 把 `agentId` 切到联网搜索数字员工，再走一次 `setStateBySchema`。

### 1.3 触发外层 `onSend`

`QueryInputBase.finallySendQuery` 调 `props.onSend(data)`（`queryInputBase.tsx:292-299`）。`onSend` 由 `ChatLayoutComp`（`src/components/ChatLayoutComp/index.tsx:183-208`）注入：

```tsx
const onSend = useCallback(async (param, isRetry) => {
  if (disabledInput) return;
  if (!isRetry) Object.assign(param, { payload: { ...param.payload, ...tempParamsRef.current } });
  try {
    const res = await sendQuery(param);
    if (res) { setIsBottom?.(true); requestIdleCallback(() => messageListCompRef.current?.toBottom()); }
  } catch (e) {
    if (e instanceof Promise) e.finally(() => onSendRef.current?.(param, true));
  }
}, [disabledInput, sendQuery, setIsBottom]);
```

- `tempParamsRef.current = sendExtraParams`（来自 `props`），用来支持外层注入额外 payload（移动端、嵌入式聊天等场景）。
- 抛出的是 `Promise` 时表示需要先做"重载历史 → 自动重试"（见 `useChat.checkSessionStateBeforeSendQuery` 抛 `reloadLatestMessageList()`）。

---

## 2. `useChat`：编排消息对象 + SSE 回调流水线

`byclaw-fe/src/hooks/useChat/index.ts:107-433`

`sendQuery(sendProps, conf)` 是关键函数，做了 9 件事：

1. **登录 / 留资校验**：未登录 → 弹登录框；未留资 → 弹留资弹窗。
2. **并发上限**：`sseRequestManager.canStartNewRequest()`；超限直接拒绝。
3. **会话状态校验**：`checkSessionStateBeforeSendQuery` —— 若分页区间末页 > 1，先抛 `reloadLatestMessageList()`，调用方 catch 后会重试。
4. **`RESUME` 续答分支**：当 `payload.actionType === 'RESUME'` 时，跳过"末条消息正在 Query/Answer 就拒绝发送"的兜底，允许追问继续走底部输入框路径。
5. **`inheritQryMsgId` 分支**：基于历史消息重发时，从消息列表里恢复上一次的 `agentType`、`resourceList`、`fileList`、`extParams`。
6. **建占位消息**：
   - `newQueryMsg = createMessage({ fromBeyond: false, messageState: Done, ... })`
   - `newAnswerMsg = createMessage({ fromBeyond: true, messageState: Query, queryMsgId, agentId, ... })`
   - 把 `newAnswerMsg.msgId` 写进 `extParams.clientId` 并塞回 `newQueryMsg`，方便后续根据 `clientId` 反查/取消。
7. **构造 `flowHandler`（核心！）**：用 `lodash.flow` 串起七个 handler，每个 SSE 帧依次喂进去，每个 handler 处理一种维度：

   | handler | 来源 | 职责 |
   |---|---|---|
   | `sessionInfoHandler` | `createSession` 事件 | 写 `sessionId` + `sessionExts`（dispatch 到 `session/saveExtParamsBySessionId`），把新 sessionId 同步到 globalContext |
   | `messageIdHandler` | 任意带 `messageId` 的帧 | 写 `newAnswerMsg.messageId` + `metadata`，并在 `initMessage` 时清理已有内容 |
   | `queryMessageIdHandler` | 任意带 `queryMessageId` 的帧 | 写 `newQueryMsg.messageId` |
   | `rewriteQuestionHandler` | `contentType=rewriteQuestion` | 标记 `newAnswerMsg.shouldDelete=true`（最后阶段删除占位 answer） |
   | `textHandler` | `answerStart/Delta/End` & `reasoningLogStart/Delta/End` 中的"text 类" | 把增量内容拼到 `messageList` 或 `thinkList` 末尾元素的 `substance` |
   | `messageHandler` | 其他 contentType | 追加新结构化项；遇到 `appStreamResponse` 写 `resourceFrom` + `relatedQuestions`；遇到 `error` 写 `messageState=Error` |
   | `resComIdsHandler` | `resComComplete` | 写 `newAnswerMsg.resComIds`（动态卡片资源 id 列表） |

8. **调用 `useSend.send`**（参考第 3 节），注入 callback。
9. **登记到 `sseRequestManager`**（按 sessionId+msgId 维度），然后：
   - `promise.then` 收尾：`messageState = Done`、删 `cancelSSE`、写库；
   - `promise.catch`：`messageState = Error`；
   - 给 `newAnswerMsg.cancelSSE` 挂 `debounce(stopChat)`：取消时 POST `/byaiService/chat/stopChat`。

---

## 3. `useSend` + `SendHelper`：与 `/superAgentChat` 建立 SSE

### 3.1 `useSend`

`byclaw-fe/src/hooks/useSseSender/useSend.ts`

- 默认实例化 `SendHelper`（`new SendHelper(chatUrl)`）。
- 当数字员工属于 OpenClaw 类型（`isOpenClawAgent(agentInfo)`）时切换到 `OpenclawSendHelper`，URL/帧格式不同。
- `send(text, payload, opts)` 内部把 `chatContent: DOMPurify.sanitize(text)`、`relModelId: -1`、`accessTerminal: 'Web'`、`sessionId/chatId` 等基础字段补齐再下发。

### 3.2 `SendHelper`

`byclaw-fe/src/hooks/useSseSender/sendHelper.ts`

- **默认 url**：`'/byaiService/chat/superAgentChat'`（也是本文件的命名来源）。
- **超时**：20 分钟（`REQ_TIMEOUT = 1200000`）；`sendingMap` 按 msgId 跟踪 `AbortController + timer`，可单条取消。
- **请求头**：`Content-Type/json`、`language` (locale)、`accessTerminal: 'Web'`、`tokenKey/ssotokenKey` 三种 token；再追加 HMAC 签名（`generateSignature('POST', body)`，盐 `{#@*A12^c0+}`，输出 `x-signature-nonce / x-signature-timestamp / x-signature-value`，`utils/signature.ts`）。
- **传输**：`@fortaine/fetch-event-source`，`openWhenHidden: true`（页面切到后台不断流），`onopen` 中 401/403 → `globalLogout()`。
- **`onmessage` 事件分发**：

   | event | 处理 |
   |---|---|
   | `moduleStatus` | 直接忽略 |
   | `createSession` | 透传 res（含 sessionId/sessionName/sessionExts），交给 `sessionInfoHandler` |
   | `initMessage` / `initialization` | 透传 res |
   | `answerStart` / `answerDelta` / `answerEnd` | `answerDeltaHandler(res, eventName)` 把 `choices[0].delta.content` 装成 `{ message: { contentType, content: { substance, orderId, parentOrderId }, status } }` |
   | `reasoningLogStart` / `reasoningLogDelta` / `reasoningLogEnd` | 同上但 `contentType = thinkText` |
   | `resComComplete` | `set(payload, 'resComIds', res)` —— 卡片资源 id 列表 |
   | `appStreamResponse` | 写 `messageId/queryMessageId`，并把 `relatedResources / relatedQuestions` 包成 `appStreamResponse` 类型 message。**收到后 `resolve({})` 结束 promise** |
   | `error` | 包成 `SSEMessageType.error` payload，**reject(`SSEERROR`)** |

- **回调**：每个非空 `payload` 都触发 `params.callback?.(payload, msg)` —— 也就是 `useChat` 注入的那条流水线。

### 3.3 `util.ts` 帧格式归一化

`byclaw-fe/src/hooks/useSseSender/util.ts` 里 `sseTypeHandlerMap` 给不同 `contentType`（`text` / `thinkText` / `form` / `approvalForm` / `botCard` / `thinkTaskUserInput` / `application` / `slientHandler` / `thinkRewriteQuestion`）配了不同 `handler`，确保所有帧最终都展平成 `{ message: { contentType, content, status, agentId, objectType, ... } }` 的统一结构，让 `useHandler` 可以无差别消费。

---

## 4. 后端入口：`ChatChannelController.postChat`

`byclaw-be/src/main/java/com/iwhalecloud/byai/gateway/channels/controller/ChatChannelController.java`

```java
@ChatCallLimit
@PostMapping("/superAgentChat")
public void postChat(@RequestBody AssistantChatDto dto, HttpServletResponse response) {
    if (CurrentUserHolder.getAssistantId() == null || CurrentUserHolder.getCurrentUserName() == null)
        throw new BdpRuntimeException(I18nUtil.get("assistant.chat.assistant.is.null"));

    CompletionsUtils.setResHeader(response, true);                  // SSE 响应头
    OutputStream outputStream = response.getOutputStream();

    String accessTerminal = dto.getAccessTerminal();                // Web / App / DingDing
    ChannelService channelService = ChannelServiceFactory.getService(accessTerminal);
    if (!channelService.validateRequest(dto))
        throw new BdpRuntimeException(I18nUtil.get("assistant.chat.request.invalid"));
    channelService.chat(dto, outputStream);
}
```

切面：
- `@ChatCallLimit` → `ChatCallLimitAspect`（`state.aspect`）调用 `ChatCallLimitService` 做调用频率/并发上限。
- `CurrentUserHolder` 由全局过滤器在请求进来时基于 `tokenKey` / `ssotokenKey` 解析（`common/login`）；签名/i18n 由 `state/common/filter/GlobalI18nFilter` 等处理。

工厂注册了三种 `ChannelService`（`ChannelServiceFactory`）：

- `WEB → WebChannelService`
- `APP → AppChannelService`
- `DingDing → DingtalkChannelService`（钉钉机器人有自己的 stream/Card 流程，见 `gateway/channels/service/dingtalk/stream`）

前端 `SendHelper` 总是带 `accessTerminal: 'Web'`，故 superAgent 走 **`WebChannelService`**。

---

## 5. `WebChannelService.chat` → `AssistantChatService.chat`

`byclaw-be/.../gateway/channels/service/web/WebChannelService.java` 仅作转发。

`byclaw-be/.../state/domain/chat/service/AssistantChatService.java:120` 是真正的"前置编排"：

1. **OpenTelemetry**：把 `sessionId` 与 `chatContent` 打点到当前 span，开启 langfuse trace。
2. **频道扩展**：`AssistantAccessChannel.fromAccessTerminal(accessTerminal).ifPresent(ch -> ch.ensureChannelTypeInExtension(dto))`。
3. **固化记忆分支**：`extParams.taskType == FIXMEMORY` → 走 `handleFixMemory`，直接根据已有 `resComId` 复制一份 task 卡片，写一遍 `createSession/initialization/answerDelta/[DONE]/answerEnd/resComComplete/appStreamResponse`，然后 `return`。**不进 Gateway**。
4. **默认个人助理**：`applyDefaultPersonalAssistant(dto)` —— 如果用户没传 `agentId` 且数据库里挂了"当前用户默认数字员工"（`SuasSuperassistApplicationService.resolveCurrentUserDefaultDigitalEmployeeId`），就把 `agentId` 设成它，`agentType` 默认 `PERSONAL_QA_AGENT`。
5. **会话归属**：
   - 若 `sessionId == null` → `createGroupChatSession(dto)`：分配 `newSessionId`，把当前用户和（如果有）数字员工写进 `byai_session_member`，立即写 SSE 事件 `createSession`，然后把 `newSessionId` 回写到 dto 与 dto.session。
   - 否则 `checkUserMembershipInGroup`：先读 `dto.sessionType`，没有就 feign `sessionService.findById` 拿 `sessionType`；只有群聊 (`HS_AS`) 才校验当前用户在 `byai_session_member`，不在群里抛 `chat.user.not.in.group`，前端会收到 `error` 事件 + 友好提示"你不在当前群聊..."。
6. **超级助手特例**：

   ```java
   if (dto.getAgentId() != null && dto.getAgentId() == -1L) {
       dto.setAgentId(null);   // 告诉下游"我是 main"，让 Gateway 路由到默认 main worker
   }
   ```

   这就是前端 `superAgentMode` 时传 `'-1'` 的对端语义。
7. **进入模板方法**：`scriptService.executeAssistantChat(outputStream, dto, firstTextStartTime)` → `AbstractChatProcess.execute`。
8. **异常分流**：
   - `BdpRuntimeException` → `handleBdpRuntimeException`：写 `error` 事件，特殊处理"被移出群聊"。
   - `Exception` → `handleGeneralException`：写 `error` 事件并 rethrow。
   - `finally cleanupResources`：仅当 `outputStream instanceof ServletOutputStream` 时关闭（WebSocket/Netty 由调用方管生命周期）。

---

## 6. `ScriptService.execute`：模板方法的四个钩子

`byclaw-be/.../state/domain/chat/service/AbstractChatProcess.java:30`

```java
public void execute(OutputStream res, AssistantChatDto dto, long firstTextStartTime) {
    ChatProcessContext context = new ChatProcessContext(res, dto);
    context.setFirstTextStartTime(firstTextStartTime);
    try {
        prepareParams(context);
        handleGatewayMode(context);     // ScriptService 重写为 routeService.route(ctx)
        storeMessage(context);
        afterProcess(context);
    } catch (Exception e) {
        context.setException(e);
        handleException(context);
    }
}
```

### 6.1 `prepareParams`

`ScriptService.prepareParams`（`ScriptService.java:118-190`）：

- 生成 `userMessageId / modelAnswerMessageId / taskId`（`SequenceService.nextVal()`，雪花 id）。
- `taskOperateType` 分支：
  - `UPDATE / RERUN / FEEDBACK` → 不创建新 task，从 `messageFactory.generateUpdateTaskHistory(ctx)` 复用历史。
  - `EXECUTE` → 在 `addMenTask(ctx)` 中创建 men_task 父任务（前端把卡片 `resComId` 通过 extParams 带回来）。
  - 其他 → 普通新会话；`taskId` 优先用 `extParams.beyondTaskId`（待办列表点入），否则取序列。
- `messageFactory.generateAskMessage(...)` 创建 `askMsg`（用户输入消息实体）。
- `broadcastUserMessage(ctx)`：通过 `multiDeviceBroadcastService` 把 `userMessage` 推给同一用户其他在线设备（WebSocket）。
- `initEvent(ctx)`：写 SSE `initialization` 帧——`{ messageId: modelAnswerMessageId, queryMessageId: userMessageId, metadata: {...} }`。`metadata` 由 `getMetadataByassistantChatDto` 生成，包含：
  - `role: agent-{agentId}-{userId}`
  - `agentId`, `mode`
  - 如果 `resourceList.size==1` 且不是搜问/智办，再加 `resourceId/resourceName/resourceType`，是数字员工再加 `agentType`
- `broadcastInitEvent(ctx)`：把 `initialization` 多端广播。
- `saveUserContent(ctx)`：把用户输入写入 `message_hot`（`memoryMessageService.save(USER_INPUT)`）。
- `paramService.getParams(ctx)`：拼出发给 Python Gateway 的参数（见 6.2）。

### 6.2 `ParamService.getParams`

`byclaw-be/.../state/domain/chat/service/ParamService.java:115`

返回 Map 大致是：

```jsonc
{
  "resource_list":      [...],                // 前端 # 引用过来的资源
  "agent_id":           dto.agentId,          // 可能为 null（main 模式）
  "ext_params":         dto.extParams,
  "worker_agent_type":  ssResource?.workerAgentType ?? "byclaw_exe",
  "agent_list":         [AgentResourceChatInfoDto, ...],   // 所有可调度数字员工
  "agent_code/name/type": 当前 agent 的元数据（如果有）,
  "files":              dto.files,
}
```

`agent_list` 来自 `ssSuperassistSubAgentService.getResourceAgent` 与 `getChatAgentResourceInfo`，并被两道过滤：

- `filterUnAuthAgentResources`：去掉用户没权限的资源；
- `filterUnChoosedResource`：从 `chatContent` 里抽取 `{{DIG_EMPLOYEE_xxx#AGENT_yyy}}` 这种占位符，只保留被 @ 选中的数字员工与其技能。

`worker_agent_type` 决定 Gateway 把消息投到哪个 worker；常规 `byclaw_exe` 对应 `byclaw-exe`/`byclaw-data`/`byclaw-qa` 等模块在 by-framework Gateway 上的 worker。

### 6.3 `handleGatewayMode` → `RouteService.route`

`byclaw-be/.../gateway/route/RouteService.java:129`

#### 6.3.1 三个分支

```java
if (isIntegrationTypeInterface(ctx)) { interfaceRouteService.route(ctx); return; }
if (isIntegrationTypeA2A(ctx))       { a2aRouteService.route(ctx);       return; }
// 默认 Gateway SDK + Redis Stream
```

- **INTERFACE 接入**：`agent_list` 中有 `createType=FROM_THIRD && integrationType=INTERFACE` → `InterfaceRouteService` 直接 HTTP 调用第三方 SSE，把响应转写回 outputStream。
- **A2A 接入**：`integrationType=A2A` → `A2aRouteService`，标准 Agent-to-Agent 协议。
- **默认**：进入下面的 Gateway SDK 流程。

#### 6.3.2 主链路（默认）

1. `ctx.loginInfo = CurrentUserHolder.getLoginInfo()`，没有 `userCode` 直接 return（不发请求）。
2. **目标 worker 解析**：`targetAgentTypeResolver.resolve(...)` 根据 `agentId/sourceAgentType/userCode` 决定最终的 `targetAgentType`（包括用户私有沙箱 worker 等情况）。
3. **资源占位符替换**：`replaceResourcePlaceholders(content, resourceList)` 把 `{{DIG_EMPLOYEE_xxx}}` 还原成 `@资源名`，让 worker 看到的是自然语言而不是 ID。
4. **建队列 + 监听**：

   ```java
   ctx.gatewayEventQueue = new LinkedBlockingQueue<>();
   outputStreamManager.putContext(sessionId, ctx);
   sessionStreamManager.startSessionListener(sessionId, ctx);  // 必须先于 sendMessage 启监听
   ```

   `SessionStreamManager.startSessionListener`：
   - 给 stream key `byai_gateway:session:{sid}:data_stream` 创建消费者组 `byai_conversation_service_group`。
   - 取 prototype `RedisStreamMessageListener`，启动 `StreamMessageListenerContainer`，从 `lastConsumed` 开始消费。
   - 同一 session 重新启动时先 stop 旧容器。

5. **发消息**：`sendMessageWithWorkerRetry(...)` 调 `gatewayClient.sendMessage(targetAgentType, sessionId, content, userCode, userName, actionType, "-1", answerMessageId, traceId, params, metadata)`：
   - `traceId = userMessageId + "_" + answerMessageId`，全链路追踪 + 区分历史批次。
   - `metadata` 注入语言、`Beyond-Token`（JWT）、`request_headers`、`channelExtension`（钉钉群 id 等）。
   - 失败 + 是用户沙箱 + 错误码 `ERR_WORKER_NOT_ONLINE / ERR_AGENT_TYPE_UNAVAILABLE` → `sandboxService.ensureSandboxReady` 然后重试一次。

6. **请求线程消费 + 即时推流**：

   ```java
   while (true) {
       JSONObject dataJson = ctx.gatewayEventQueue.poll(5, TimeUnit.MINUTES);
       if (dataJson == null) throw new BdpRuntimeException("Gateway 响应超时");

       String eventType = dataJson.getString("event_type");
       String receivedTraceId = dataJson.getString("trace_id");
       boolean isCurrentTrace = traceId.equals(receivedTraceId);

       if (!isCurrentTrace) {
           // 历史批次：只 accumulateEvent 入库，不写客户端
           ...
           continue;
       }
       if ("error".equals(eventType)) { 写 error 帧, ctx.gatewayError = true, break; }
       String eventData = buildEventData(ctx, dataJson, metadata);   // 拼 sessionId/metadata
       pythonSseService.getContentFromPythonStreamV3(lineJson.toJSONString(), ctx.res,
                                                    ctx.messageContext, ctx.getAgentIds(), ctx);
       if ("appStreamResponse".equals(eventType)) { ctx.messageContext.setComplete(true); break; }
   }
   sessionStreamManager.stopSessionListener(sessionId);
   ```

   关键设计：**所有 `outputStream.write` 都发生在 Tomcat 的 http-nio 请求线程里**，避免 Redis listener 线程直接写 NIO 流时不能实时 flush 的问题。监听线程只把 JSON 投到 `gatewayEventQueue`。

7. **跨 worker 思考链转译**：`source_agent_type != targetAgentType` 时——
   - 它发的 `appStreamResponse` 直接丢弃（不能让从 worker 提前结束主流）。
   - 它发的 `answerDelta` 改成 `reasoningLogDelta`，前端把它渲染成"思考过程"。

8. **历史批次 (`traceId` 不一致)**：可能是同会话上一次还没完结的批次串过来，调 `pythonSseService.accumulateEvent(line, historyMsgCtx)` 累积；遇到该批次自己的 `appStreamResponse / error` 就 `storeHistoryBatch(...)` 把它独立入库（构造一份 `BeanUtils.copyProperties` 出来的 `AssistantChatDto`，避免污染当前 ctx）。

#### 6.3.3 `RedisStreamMessageListener.onMessage`

```java
String sessionId = dataJson.getString("session_id");
ChatProcessContext ctx = outputStreamManager.getContext(sessionId);
if (ctx == null || ctx.gatewayEventQueue == null) return;
ctx.gatewayEventQueue.offer(dataJson);
multiDeviceBroadcastService.broadcastRawEvent(userId, sessionId, dataJson, senderChannel);
```

- prototype scope，每个 session 一个独立 listener。
- 写完队列额外做"多端广播"：把同一帧推到该用户其他 WebSocket 连接（`MultiDeviceBroadcastService`，依赖 `senderChannel` 排除发起端）。

### 6.4 `pythonSseService.getContentFromPythonStreamV3`

`byclaw-be/.../state/domain/chat/service/PythonSseService.java:107`

负责把 Python/Worker 那边的事件**写到前端 SSE 流**并**就地累积到 `messageContext`**：

| event | 前端写出 | 副作用 |
|---|---|---|
| `answerDelta` | 同名 | `messageContext.recordAnswerText/Stream/Struct(value)`；首词时写 `firstTextEndTime` |
| `answerStart` | 同名 | — |
| `answerEnd` | 先 `answerDelta=[DONE]` 再 `answerEnd` | — |
| `moduleStatus` | 同名 | — |
| `reasoningLogStart/Delta/End` | 同名 | `recordInferLog` |
| `error` | 抛 `PythonRuntimeException` | — |
| `taskStop` | 不直接写 | `recordCallLog` |
| `appStreamResponse` | 不在这里写（在 storeMessage 里写） | `recordChatRelatedResource` |
| `taskCreate` | — | `addOrUpdateMenSubTask("add")` 入库子任务 |
| `stepComplete` | — | `addOrUpdateMenSubTask("update")` |
| `tokenCount` | — | `handleTokenCount` 写 `tokenStatsMap` |

每帧最后还会跑 `buildAgentIdsAndDatasetIds` 与 `appendRelatedQuestions`，把过程中出现的 `agentId / datasetId / relatedQuestions` 收集到 ctx。

### 6.5 `storeMessage`

`ScriptService.storeMessage`（`ScriptService.java:258`）：

- 如果之前 `gatewayError == true`：只持久化 (`resolveMemory`)，不再写 `appStreamResponse`（前端已经收到 error 了）。
- 否则：
  1. `chatResponse = resolveMemory(ctx, dto, sessionId, messageContext, resMsg)` —— 把 answer 写进 `message_hot`，索引建立，把推荐问题/资源/资源组件 id 一起塞进 `ChatResponse`。
  2. `CompletionsUtils.responseWrite(ctx.res, "appStreamResponse", JSON.toJSONString(chatResponse), sessionId)` —— **真正告诉前端"这一轮结束了"** 的事件。
  3. `broadcastAppStreamResponse(ctx)` 多端广播。

### 6.6 `afterProcess`（`ScriptService.afterProcess`）

打 token 统计、写 trace 出口、必要时刷新数字员工评分等（与流不强相关）。

### 6.7 异常路径

`handleException`（`ScriptService.handleException`）：
- 解包 `PythonRuntimeException` → 写 `error` 事件携带 `message + traceback`。
- 记录失败 trace、释放队列等。

---

## 7. 后端到前端：SSE 帧流回 `SendHelper.onmessage`

`fetchEventSource` 收到的 chunk 进入 `SendHelper.onmessage`（见 §3.2）。每帧产生一个 `payload` 对象，回调 `useChat` 的 callback：

```ts
callback: (sseRes, sseMsg) => {
  if (!sseRes || isEmpty(sseRes)) return;
  flowHandler({ sseRes, sseMsg, newQueryMsg, newAnswerMsg });
  if (!onlyQuery) newQueryMsg = updateMessage(newQueryMsg);
  newAnswerMsg = updateMessage(newAnswerMsg);
}
```

`flowHandler` 是七个 handler 的 `flow`，第 2 节已列。每帧处理完都 `updateMessage(newAnswerMsg)`（`useMessage` 内部走 dva `messageStore` model 派发更新），React 视图随之刷新。

时间线（典型一次问答）：

```
T0  POST /chat/superAgentChat (含 HMAC + token + body)
T1  ← createSession         {sessionId, sessionName, sessionExts}
T2  ← initialization        {messageId, queryMessageId, metadata}
T3  ← answerStart           ...
T4  ← reasoningLogStart/Delta/End  // 思考过程 (可选, 透传 worker 的 answerDelta)
T5  ← answerDelta * N       // 增量 token，前端逐字拼接
T6  ← answerDelta [DONE]
T7  ← answerEnd
T8  ← resComComplete        // 卡片资源 id（如有）
T9  ← appStreamResponse     // 包含 messageId/relatedResources/relatedQuestions
T10  fetch 流结束            // SendHelper resolve；useChat .then 写 messageState=Done
```

任何阶段也可能：

- `error` → SendHelper `reject('_SSE_ERROR_')` → `useChat` `.catch` 把 `messageState` 置为 `Error`。
- 用户点击停止 → `newAnswerMsg.cancelSSE()` → `abortController.abort()` + POST `/byaiService/chat/stopChat`。
- 401/403 → `globalLogout()` 跳登录页。

---

## 8. 渲染：把消息流变成气泡

`MessageList`（`byclaw-fe/src/components/MessageList/`）订阅 `messageList`，根据每条消息的 `messageList`（正常输出）+ `thinkList`（思考过程）+ `resourceFrom`（来源引用）+ `relatedQuestions`（推荐问题）+ `resComIds`（卡片）渲染：

- `text / thinkText` → markdown 流式气泡
- `form / approvalForm / botCard / thinkTaskUserInput / application / slientHandler` → 各自定制组件
- `appStreamResponse` 不渲染但用于 `resourceFrom`+`relatedQuestions` 的展示
- `error` → 错误气泡，附带 `traceback`（开发态）

气泡上的"复制 / 重答 / 转发"等动作来自 `useEventEmitterHooks`，重答时构造 `inheritQryMsgId` 的 `ISendProps` 走第二轮 `sendQuery`。

---

## 9. 重要支线一览

| 场景 | 前端触发条件 | 后端分流点 |
|---|---|---|
| 超级助手模式 | `superAgentMode=true` → `agentId='-1'`, `agentType=''` | `AssistantChatService.chat` 检测到 `agentId == -1L` → `setAgentId(null)`，让 Gateway 走 main worker |
| 默认个人助理 | 无 `agentId` 透出 | `applyDefaultPersonalAssistant` 自动绑当前用户的默认数字员工 |
| 群聊 | sessionType=`hs_as` | `checkUserMembershipInGroup` 校验成员；不在群 → `error` "你不在当前群聊..." |
| 创建新会话 | `sessionId == null` | `createGroupChatSession` + 立即 SSE `createSession` |
| 文件问数 | `fileList` 非空，`extParams.chatType='MCP_CHAT'` | 走 worker 内的 MCP 链路（`byclaw-data` 的 `byclaw_data.mcp` 等） |
| 联网搜索 | `connectNet=true` 且勾选了 networkSearch 数字员工 | 通过 `agentId` 切到联网搜索 agent，走默认 Gateway |
| 智办 / 搜问 | `mode=smartOffice` / `searchQuery` | `metadata.resourceId` 不写入；触发 worker 的智办或搜问规划 |
| 接口集成数字员工 | agent `integrationType=INTERFACE` | `RouteService.route` → `InterfaceRouteService` 直接 HTTP 转发第三方 SSE |
| A2A 集成数字员工 | agent `integrationType=A2A` | `RouteService.route` → `A2aRouteService` |
| OpenClaw 数字员工 | `isOpenClawAgent(agentInfo)` | 前端切到 `OpenclawSendHelper`（不同 url/帧格式） |
| 固化记忆 | `extParams.taskType=FIXMEMORY` | `AssistantChatService.handleFixMemory`，**完全不进 Gateway**，直接拿历史卡片复一份 |
| 任务 EXECUTE/UPDATE/RERUN/FEEDBACK | `taskOperateType` | `prepareParams` 对应分支：复用 `taskHistoryMessages`、提前生成 `modelAnswerMessageId`、`UPDATE` 时写 `initMessage` 清空旧内容 |
| RESUME 续答 | `payload.actionType='RESUME'` | 跳过"末条 Query/Answer 即拒绝"的兜底；后端走默认链路 |
| 重发 (inheritQryMsgId) | `useChat.sendQuery` 中 inheritQryMsgId 命中 | 沿用历史 agentType / resourceList / fileList |
| 取消 / 停止 | `newAnswerMsg.cancelSSE()` | abort fetch + `POST /chat/stopChat` |
| 多端同步 | 同账号多设备 | `MultiDeviceBroadcastService.broadcastRawEvent` 在 `RedisStreamMessageListener` 与各关键节点处把帧推到其他 WS 设备 |
| 历史批次穿插 | `traceId != 当前 traceId` | `RouteService.route` 的非 current trace 分支：仅 accumulate + storeHistoryBatch，不写客户端 |
| Worker 路由（DataCloud） | `ss_resource.workerAgentType=byclaw_data` | BE `XADD` 命令到 DataCloud cmd_stream → `byclaw-data/DataCloudWorker` 跑 langgraph，触发澄清时 `complex_ask_user` |
| Worker 路由（即时问答） | `ss_resource.workerAgentType=BYCLAW_QA` | `byclaw-qa/InstantSearchWorker` 拉 MinIO 配置 → `InstantSearchEngine` 流式检索 → 报告落 BE `/conversation/writeTxt` |
| Worker 路由（用户沙箱） | 默认 / `BYCLAW_EXE` 派生 | `TargetAgentTypeResolver` 改写为 `<base>:<userCode>`，`SandboxService.ensureSandboxReady` 拉起 OpenClaw，命令通过 `byclaw-exe/byai-channel` webhook 进入 |
| 数据表卡片 | DataCloud worker `_emit_6001` | `content_type=6001` → 前端 `botCard / data_table_json` 渲染 |
| 澄清打断 | DataCloud worker `InterruptEvent.PARADIGM_CLARIFICATION` | `complex_ask_user(paradigmList)` → 前端 `thinkTaskUserInput` → 用户提交后下一轮 `ResumeCommand` |

---

## 10. 关键文件速查

前端：

| 路径 | 角色 |
|---|---|
| `byclaw-fe/src/components/QueryInput/Chat/index.tsx` | superAgent 按钮、payload 拼装 |
| `byclaw-fe/src/components/QueryInput/queryInputBase.tsx` | 富文本输入、文件、STT、`finallySendQuery → onSend` |
| `byclaw-fe/src/components/ChatLayoutComp/index.tsx` | `onSend` → `useChat.sendQuery`、滚动到底、消息列表渲染 |
| `byclaw-fe/src/hooks/useChat/index.ts` | 占位消息 + flow 流水线 + 取消/重发/sseRequestManager |
| `byclaw-fe/src/hooks/useChat/useHandler.ts` | 七个 SSE handler |
| `byclaw-fe/src/hooks/useSseSender/useSend.ts` | OpenClaw / 默认 SendHelper 切换 |
| `byclaw-fe/src/hooks/useSseSender/sendHelper.ts` | fetchEventSource + 事件分发 |
| `byclaw-fe/src/hooks/useSseSender/util.ts` | 帧格式归一化 |
| `byclaw-fe/src/utils/signature.ts` | HMAC 签名 |
| `byclaw-fe/src/service/workSpace.ts` | 一次性 `superAgentChat(tags)` POST 工具（非主链路） |

后端：

| 路径 | 角色 |
|---|---|
| `gateway/channels/controller/ChatChannelController.java` | `POST /chat/superAgentChat` 入口 |
| `gateway/channels/service/ChannelServiceFactory.java` | 渠道分发（Web/App/Dingtalk） |
| `gateway/channels/service/web/WebChannelService.java` | Web 渠道实现 |
| `state/domain/chat/service/AssistantChatService.java` | 会话 + 默认助理 + 异常 + 模板入口 |
| `state/domain/chat/service/AbstractChatProcess.java` | 模板方法骨架 |
| `state/domain/chat/service/ScriptService.java` | `prepareParams / storeMessage / afterProcess` |
| `state/domain/chat/service/ParamService.java` | 组装下发给 worker 的 params |
| `gateway/route/RouteService.java` | Gateway SDK 主路由 + 队列消费 + 历史批次 |
| `gateway/route/InterfaceRouteService.java` | 第三方 INTERFACE 集成路由 |
| `gateway/route/A2aRouteService.java` | A2A 协议路由 |
| `state/domain/chat/service/SessionStreamManager.java` | 按 session 起 / 停 Redis Stream listener |
| `state/domain/ws/handler/RedisStreamMessageListener.java` | 把 Redis Stream 帧投到 `gatewayEventQueue` + 多端广播 |
| `state/domain/chat/service/PythonSseService.java` | 帧 → SSE / 累积 messageContext |
| `state/infrastructure/common/constants/SseResponseEventEnum.java` | 全部事件常量 |
| `state/aspect/ChatCallLimitAspect.java` | `@ChatCallLimit` 限流 |

算法侧 Worker（Python / OpenClaw）：

| 路径 | 角色 |
|---|---|
| `byclaw-data/src/byclaw_data/main.py` | DataCloud worker 启动入口（重试 + .env 装载） |
| `byclaw-data/src/byclaw_data/worker.py` | `DataCloudWorker.process_command` + `_consume_agent_events` 翻译 OntologyAgent → SSE |
| `byclaw-data/src/byclaw_data/runtime.py` | 环境变量归一化（DB/REDIS/LLM → DATACLOUD_*/DC_*） |
| `byclaw-data/src/byclaw_data/plugins/` | `InitDataCloudDigitalEmployeePlugin` / `RecommendedQuestionsPlugin` |
| `byclaw-data/src/byclaw_data/mcp/main.py` | MCP HTTP 入口（`/api/v1/mcp` + REST 查询，旁路） |
| `byclaw-qa/worker.py` | `InstantSearchWorker.process_command`（节点标题翻译 + 报告落盘 + 检索过滤） |
| `byclaw-qa/api.py` | 知识库管理 API（`importByResourceId / fileToMarkdownIndexByResourceId / searchByResourceId`） |
| `byclaw-qa/start.sh` | `api` / `worker` 两种启动模式 + 环境变量映射 |
| `byclaw-qa/redis_agent_config.py` / `minio_agent_config.py` | 数字员工配置 schema + MinIO 加载 |
| `byclaw-exe/extensions/byai-channel/` | OpenClaw `byai-channel` 插件，webhook + callbackUrl 流式 |
| `byclaw-exe/extensions/baiying-enhance/` | 把百应数字员工挂到 OpenClaw main agent 下 |
| `byclaw-exe/extensions/byclaw-sqlite/` | OpenClaw 工具：本地 SQLite 执行（`/byclaw-sqlite/sqlExecute`） |
| `byclaw-exe/skills/baiying/` | 百应技能集（cookie 代理 / weather / 意图 prompt …） |
| `byclaw-exe/template/openclaw.json` | OpenClaw 启动配置模板（models / agents / channels / plugins） |

---

## 11. 算法侧 Worker：消息进入 Redis 之后的世界（byclaw-data / byclaw-qa / byclaw-exe）

前面 §6 把后端的 `RouteService.route` 讲到 `gatewayClient.sendMessage(...)` 就停下了，本节从那一刻继续往下追：消息怎么被 Python worker 拿到、怎么生成回答、怎么把帧写回到 BE 监听的那个 Redis Stream。三个模块共享同一套 `by-framework` Gateway 协议，但承担的"数字员工类型"不同。

### 11.1 by-framework Gateway 协议（三个模块的公共底座）

`byclaw-data / byclaw-qa` 都依赖一个上游包 `by-framework`（PyPI / 内部仓库），它定义了：

- **Worker 进程模型**：`run_worker(WorkerClass, worker_id, redis_*, consumer_group, ...)`。每个 worker 启动后向 Redis 注册自己（`worker_id` + `agent_types`）并 `XREADGROUP` 一个**入站命令流**。
- **命令流（入站）**：BE 的 `gatewayClient.sendMessage(targetAgentType, sessionId, content, userCode, ...)` 实际是把命令 `XADD` 到 `byai_gateway:worker:{targetAgentType}:cmd_stream`（具体 key 由 SDK 决定），命令体携带 `header`（含 `session_id / message_id / parent_message_id / metadata`）+ `extra_payload`（含 `agent_id / agent_code / agent_name / agent_type / agent_list / files / call_kb_ids / call_object_ids / ext_params / resource_list / worker_agent_type` 等等，这些字段就是 §6.2 `ParamService.getParams` 拼出来的那个 Map）。
- **命令类型**：
  - `AskAgentCommand` —— 新一轮对话
  - `ResumeCommand` —— 之前 worker 发了 `AskUserEvent` 暂停了图（澄清/审批/反馈），用户回答后续这个 thread
- **响应流（出站）**：worker 通过 `context.emit_chunk(StreamChunkEvent, event_type=..., content_type=...)` 把每一帧 `XADD` 到 `byai_gateway:session:{sessionId}:data_stream`，BE 的 `SessionStreamManager` 监听的就是这个 key。每帧都带 `session_id / event_type / data / trace_id / source_agent_type / metadata`，对应 §6.3 `RouteService.route` 那个 `while` 循环里读出来的字段。
- **事件类型枚举**（`by_framework.core.protocol.event_type.EventType`）几乎和 BE 的 `SseResponseEventEnum` 一一对应：`ANSWER_START / ANSWER_DELTA / ANSWER_END / REASONING_LOG_START / REASONING_LOG_DELTA / REASONING_LOG_END / APP_STREAM_RESPONSE / ERROR / TASK_CREATE / STEP_COMPLETE / TOKEN_COUNT / RES_COM_COMPLETE …`。所以前端 SSE handler 看到的字符串，正是 worker 端 `EventType.XXX.value` 写过来的。
- **`AgentContext` / `agent_runtime_state`**：贯穿一次会话的上下文，提供 `emit_chunk / ask_user / complex_ask_user / flush_to_history / session_id / user_code / redis ...`。

> 一句话：`by-framework` 把 Redis Stream 包成了「输入命令 → 输出事件流」的对称管道；BE 是命令的生产者 + 事件的消费者，worker 是命令的消费者 + 事件的生产者。

### 11.2 Worker 路由：BE 是怎么挑到具体 worker 的？

回看 §6.2 `ParamService.getParams`：

```java
SsResource ssResource = ssResourceService.findById(dto.getAgentId());
params.put("worker_agent_type",
    ssResource == null ? WorkerAgentType.BYCLAW_EXE.getCode() : ssResource.getWorkerAgentType());
```

- 数字员工在 `ss_resource` 表里有一列 `worker_agent_type`，决定了它由哪个 worker 实现：
  - `byclaw_data` → `byclaw-data/DataCloudWorker`（数据问数 / DataCloud 体系）
  - `BYCLAW_QA` → `byclaw-qa/InstantSearchWorker`（即时问答 / 知识库 RAG）
  - 默认 / 找不到 ssResource → `WorkerAgentType.BYCLAW_EXE`（OpenClaw 沙箱，对应 `byclaw-exe`）
- 用户私有沙箱场景下，`TargetAgentTypeResolver.resolve(...)`（`byclaw-be` 内）还会把目标改写成 `<base>:<userCode>` 形式，这就是为什么 `RouteService.sendMessageWithWorkerRetry` 拿到 `ERR_WORKER_NOT_ONLINE / ERR_AGENT_TYPE_UNAVAILABLE` 时会 `sandboxService.ensureSandboxReady(userCode, agentId, targetAgentType)` 然后再重试一次。
- 超级助手模式（前端 `agentId='-1'` → BE `setAgentId(null)`）跳过 `ss_resource` 查询，走 BYCLAW_EXE 默认值 → 命中 main worker。

### 11.3 `byclaw-data`：DataCloudWorker（数据问数 / 本体）

入口：`byclaw-data/src/byclaw_data/main.py:101`，`byclaw-data/src/byclaw_data/worker.py:435`。

```
uv run python -m byclaw_data.main
   │
   ├─ load .env (项目根 / byclaw-data 内)
   ├─ runtime.normalize_runtime_environment()      # DB_*, REDIS_*, LLM_* → DATACLOUD_* / DC_*
   ├─ WorkerConfig.from_environ()                  # worker_id="datacloud", redis_*, llm_*, model_name
   ├─ from byclaw_data.worker import DataCloudWorker
   ├─ from byclaw_data.plugins.worker_plugins.init_agent_conf import InitDataCloudDigitalEmployeePlugin
   ├─ from byclaw_data.plugins.recommended_question_plugins import RecommendedQuestionsPlugin
   └─ run_worker(
         worker_class=DataCloudWorker,
         plugin_list=[InitDataCloudDigitalEmployeePlugin(), RecommendedQuestionsPlugin()],
         history_backend=ByClawHistoryBackend(base_url=BE_DOMAINNAME_URL),
         **cfg.run_worker_kwargs())                # 失败 7 次自动重启（worker_id 锁过期窗口 ≈ 70s）
```

- **环境归一化**（`runtime.py`）：把根目录 `.env` 里的 `DB_* / REDIS_* / LLM_* / EMBEDDING_*` 映射成 `DATACLOUD_*`，再派生 `DC_LLM_API_KEY / DC_LLM_BASE_URL / DC_LLM_MODEL / DC_API_BASE_URL / OPENAI_API_KEY / OPENAI_BASE_URL`。同时确保 `BE_DOMAINNAME_URL` 与 `DATACLOUD_API_BASE_URL` 有默认值（基于 `HOST` + 端口拼接），让 worker 知道怎么回调 BE 写历史 / 取文件。
- **历史后端**：`ByClawHistoryBackend(base_url=BE_DOMAINNAME_URL)`（来自 `by_framework_history_byclaw`）—— `context.flush_to_history` 实际是 HTTP 调 BE 的 `/byaiService/open/api/...` 写消息表，不是 worker 自己 insert。
- **Plugins**：
  - `InitDataCloudDigitalEmployeePlugin` —— 启动时把 DataCloud 数字员工配置写到 worker 缓存。
  - `RecommendedQuestionsPlugin` —— 出口侧拦截，回答完成时附上推荐问题（最终被 `_consume_agent_events` 写到 `APP_STREAM_RESPONSE.metadata.relatedResources`）。

`DataCloudWorker.process_command(command, context)`（`worker.py:766` 起）的核心流程：

1. **重建模型环境**：`build_llm_config(None)` / `build_embedding_config(None)`。某些字段是从 Redis 拉的（`model_environment.py`），保证多 worker 同步使用最新的 LLM 配置。
2. **解析 agent**：从 `extra_payload`（BE 注入的 `agent_id / agent_name`）+ `header.metadata` 里挑 agent，命中"动态 agent 路径"（`call_object_ids` / `call_view_ids` 非空）时跳过 AgentConfig 查找直接组 mounted_objects。
3. **构图**：`create_agent(...)`（来自 `datacloud_analysis`）拼出 langgraph 图；`langgraph.checkpoint` 负责中断 / 恢复。
4. **跑图 + 翻译事件**：`_consume_agent_events(event_iter, context, reco_task)`（`worker.py:276`）把 `datacloud_analysis.ontology_agent` 的内部事件翻译成 Gateway SSE：

   | OntologyAgent Event | emit_chunk → BE 收到的 event_type / contentType |
   |---|---|
   | `ThinkingEvent` | `REASONING_LOG_START` + `think_text` |
   | `StepEvent` | `REASONING_LOG_START` + `think_text`（步骤标题） |
   | `AnswerEvent.content` | `ANSWER_DELTA` + `text`（增量正文） |
   | 回答末尾 | `flush_to_history()` + `APP_STREAM_RESPONSE` + metadata.`relatedResources` |
   | `InterruptEvent.AGENT_DELEGATE_WAIT` | 先 `APP_STREAM_RESPONSE`，再 return `{"status":"waiting"}` 让 by-framework 暂停 |
   | `InterruptEvent.PARADIGM_CLARIFICATION` | `context.complex_ask_user(AskUserEvent(prompt, paradigmList))` —— 触发前端 `thinkTaskUserInput` 类型卡片 |
   | 其他 `InterruptEvent` | `context.ask_user(...)` |
   | `ErrorEvent` | `ANSWER_DELTA` + 错误文本 |

5. **数据表场景**：`_emit_6001(payload)` 用 `content_type=6001 (data_table_json)` 写一段结构化 JSON 帧，前端按 `botCard / botMessageCard` 渲染。
6. **MCP 入口**：`byclaw_data/mcp/main.py` 是另一个进程（FastAPI on `/api/v1/mcp`），由 `byclaw-data/start.sh --service-only` 启动。它不消费 Gateway 命令流，给 BE / 工具链提供按需 HTTP 查询入口（详见 §12）。

### 11.4 `byclaw-qa`：InstantSearchWorker（即时问答 / 知识库 RAG）

入口：`byclaw-qa/worker.py:399`，类 `InstantSearchWorker(worker_mod.GatewayWorker)`。

```
./start.sh worker
  └─ uv run python worker.py
       └─ run_worker(InstantSearchWorker,
                     worker_id=BYAI_WORKER_ID, redis_host/port/db/...)
                                # agent_types = ["BYCLAW_QA"]
```

- `start.sh` 先把根 `.env` 的公共变量翻译成 `by-qa` 真正读的变量名（`BYCLAW_QA_*` → 内部名），同时补好 MinIO（FILE_STORAGE_MINIO_*）、`BE_DOMAINNAME` 等。`api` 模式跑 `uvicorn api:app`，对应 `byclaw-qa/api.py` —— **知识库管理面**（`/api/v1/knowledgeItems/importByResourceId` 等），不在对话主链路上。

`InstantSearchWorker.process_command(command, context)`（`worker.py:187`）：

1. **拒绝条件**：没有 `agent_id` 或者数字员工 MinIO 配置不存在 / 没有可用知识库 / `call_kb_ids` 中有不存在的编码 → 写一帧 `ANSWER_DELTA` 提示文本，直接 return。
2. **查找数字员工配置**：`load_agent_config_from_minio(_minio, str(agent_id))` 从 MinIO 拉 `RESOURCE_DIG_EMPLOYEE_{agent_id}.json`（README 里写的"Redis"是历史说法，新版已经迁到 MinIO）；再 `convert_agent_config_to_engine_config` 转成 `InstantSearchEngine` 需要的 config。
3. **过滤知识库**：BE 通过 `extra_payload.call_kb_ids` 指定本轮调用的知识库子集，缺一个就报错"知识库编码不存在"。
4. **跑引擎**：

   ```python
   async with InstantSearchEngine(config=config) as engine:
       async with aclosing(engine.stream_search(input_data)) as stream:
           async for event in stream:
               # 翻译为 SSE
   ```

   事件 → SSE 翻译表：

   | InstantSearch event | emit_chunk |
   |---|---|
   | `NODE_START`（DECOMPOSER / SEARCH / SINGLE_HOP / MULTI_HOP / FINAL_ANSWER ...） | `REASONING_LOG_DELTA` + `think_title`（顶层）/ 普通 think（子节点）；标题来自 `convert_node_name_to_title` |
   | `search_result_chunks` | 累积到 `chunks: list[str]` 用于检索来源回填 |
   | 角色 = `aggregator / subanswer_aggregator` 的内容 | `ANSWER_DELTA` + `text`（最终答案增量） |
   | 其他普通节点的内容 | `REASONING_LOG_DELTA` + 默认 think |
   | `ERROR` | break，把错误塞回 `final_answer_parts` 后单独写一帧 `[搜问运行异常] ...` |

5. **报告落盘**：跑完后用 `LLMService.generate(...)` 让 LLM 起一个简短中文文件名（`generate_report_filename`），通过 BE 的 `/byaiService/open/api/v1/conversation/writeTxt` 把 markdown 报告写进会话文件，然后追写一帧 `ANSWER_DELTA` 提示"报告已保存到：/qa/{filename}.md"或失败提示。
6. **服务发现**：上传走 `by_framework.core.discovery.DiscoveryClient` + `DiscoveryHttpClient`（带 `RetryConfig` 502/503/504 重试），目标 `service_name=BE_DOMAINNAME`，所以 BE 部署节点变化时不需要改 worker 配置。

> 注意：本 worker 不写 `APP_STREAM_RESPONSE` 收尾事件 —— 它依赖 by-framework 在 `process_command` return 后帮它合成。所以前端最后那个 `appStreamResponse` 是框架层、不是 worker 业务代码自己 emit 的。

### 11.5 `byclaw-exe`：OpenClaw + byai-channel（沙箱 / 个人助理）

`byclaw-exe` **没有 by-framework worker**，承担的是另一种集成：跑一个 [OpenClaw](https://openclaw.ai) gateway，把它接到 byclaw 体系，对应 `WorkerAgentType.BYCLAW_EXE`。

目录结构：

```
byclaw-exe/
├── extensions/
│   ├── baiying-enhance/      # OpenClaw 插件：把 baiying 数字员工挂到 OpenClaw 的 main agent 下
│   ├── byai-channel/         # OpenClaw channel 插件：通过 webhook 接收 BE 的请求并流式返回
│   └── byclaw-sqlite/        # OpenClaw 工具：SQL 执行 (HTTP /byclaw-sqlite/sqlExecute)
├── skills/
│   ├── baiying/              # 百应数字员工技能（含 cookie 代理 / weather / 意图 prompt）
│   └── github-weekly-commit-collector/
└── template/openclaw.json    # 打包出来的 OpenClaw 启动配置模板
```

主链路靠 `byai-channel` 插件支撑（`extensions/byai-channel/openclaw.plugin.json`）：

- 它在 OpenClaw gateway 上挂一个 webhook（默认 `/webhook/byai-channel`），接收形如：

  ```http
  POST /webhook/byai-channel
  Authorization: Bearer <gateway-token>

  { "requestId": ..., "sessionId": ..., "userId": ..., "message": ..., "callbackUrl": ... }
  ```

- 把 `message` 当作给 main agent 的输入，OpenClaw 跑完后**通过 `callbackUrl` 把流式输出推回**调用方。`streamEnabled / streamMode (delta|final) / forceReasoningStream` 控制是 SSE 增量还是一次性结果。
- BE 侧的接入逻辑：当数字员工的 `agentHomeUrl` 指向一个 OpenClaw gateway（`isOpenClawAgent(agentInfo)` 命中），前端会切到 `OpenclawSendHelper`（`byclaw-fe/src/hooks/useSseSender/openclaw/sendHelper.ts`）走 WebSocket，**完全绕开 `/superAgentChat`**。这是 §1.2 / §3.1 已经提过的"OpenClaw 数字员工"分支落到这里。
- 对于"普通用户的私有沙箱"路径，`TargetAgentTypeResolver` 命中用户沙箱后，`SandboxService.ensureSandboxReady(userCode, agentId, targetAgentType)` 会拉起对应用户的 OpenClaw 实例（容器化），消息照常通过 by-framework Gateway 投递；OpenClaw 这边由 `byai-channel` 插件把命令流转成 webhook 请求执行。

`template/openclaw.json` 是这套环境的标准配置：

- `models.providers.iwhalecloud` —— OpenAI 兼容接口的 LLM provider（环境变量替换 `${MODEL_*}`）
- `agents.list` 默认有一个 `main` agent；`baiying-enhance` 插件会从 `/root/.openclaw/extensions/by/agents` 读子 agent 配置并以 `main` 为父 agent 合并进来（`mainParentAgentId: "main"`）
- `channels.byai-channel` 启用流式 + `webhookPath`
- `plugins.entries.byclaw-sqlite` 配 `dbPath / httpPath / maxRows / allowWrite` —— 给 sandbox 提供本地 SQL 工具

`skills/baiying/` 是百应数字员工的技能合集（cookie 管理、意图 prompt、能力图谱、resources 列表等），由 OpenClaw 在 main agent 下加载执行。

### 11.6 回流路径：worker emit_chunk → 浏览器气泡

把所有线串起来，一帧 worker 输出走完的全程是：

```
worker process (DataCloudWorker / InstantSearchWorker / OpenClaw via byai-channel)
  context.emit_chunk(StreamChunkEvent(content=..., metadata=...),
                     event_type=ANSWER_DELTA / REASONING_LOG_DELTA / APP_STREAM_RESPONSE / ...,
                     content_type=text / think_text / 6001 / ...)
        │
        │ by-framework 把它包成 {session_id, event_type, data, trace_id, source_agent_type, metadata}
        ▼
  Redis  XADD byai_gateway:session:{sessionId}:data_stream
        │
        ▼
  byclaw-be SessionStreamManager 监听 → RedisStreamMessageListener.onMessage
        │ ctx.gatewayEventQueue.offer(json)  + multiDeviceBroadcastService.broadcastRawEvent
        ▼
  byclaw-be RouteService.route 的 while(true) 在 Tomcat 请求线程上 poll(5min)
        │ buildEventData() → pythonSseService.getContentFromPythonStreamV3()
        │       writes to ServletOutputStream (HttpServletResponse)
        ▼
  浏览器 fetchEventSource onmessage(eventName, data)
        │ SendHelper switch(event)
        ▼
  useChat callback → flowHandler [sessionInfoHandler … messageHandler]
        │
        ▼
  React 重渲染 → MessageList 显示新增 token / 思考过程 / 报告链接
```

**关键时间窗口/退出条件**：

- worker 必须在 BE 那 `5 分钟` 的 `poll` 之内推送任意一帧（即使是 reasoning），否则 BE 抛 "Gateway 响应超时" → 写 `error` → 关流。
- worker 推 `APP_STREAM_RESPONSE` 是终止信号，BE `RouteService` while 循环退出 → `storeMessage` 写库 + 自己再写一条 `appStreamResponse`（包含 messageId / relatedResources / relatedQuestions） → 前端的 `SendHelper` 收到后 `resolve({})`。
- worker 推 `ERROR` → BE 标记 `gatewayError`，`storeMessage` 不再写 `appStreamResponse`，前端 `SendHelper` `reject('_SSE_ERROR_')`，`useChat.catch` 把消息状态置 `Error`。
- worker 推 `AskUserEvent`（包括 `complex_ask_user` 的 paradigm 澄清）→ by-framework 把它转成对应的 `thinkTaskUserInput / approvalForm` 类型帧；前端 `messageHandler` 渲染成澄清/审批卡片，用户回填后下一次 `sendQuery` 携带 `actionType=RESUME` / `taskOperateType=FEEDBACK` 触发 `ResumeCommand` 进 worker 同一个图。

### 11.7 三个模块的协作小结

| 模块 | 进程 | by-framework 角色 | `worker_agent_type` | 主要业务能力 | 出站事件特点 |
|---|---|---|---|---|---|
| `byclaw-data` | `byclaw_data.main`（worker）+ `byclaw_data.mcp`（FastAPI） | `DataCloudWorker` + 历史 backend `ByClawHistoryBackend` | `byclaw_data` / DataCloud 派生码 | 数据问数 / 本体澄清 / langgraph 中断恢复 / data_table 卡片 | thinking / step / answer + complex ask；`6001` 数据表 |
| `byclaw-qa` | `worker.py` (worker) + `api.py` (uvicorn 知识库管理) | `InstantSearchWorker` | `BYCLAW_QA` | 即时问答 RAG / 多跳问题分解 / 报告落盘 | think_title 节点标题 + answer 增量 + 报告链接补一帧 |
| `byclaw-exe` | OpenClaw gateway（外部进程）+ byai-channel webhook | 不是 by-framework worker，由 SDK 在沙箱模式下转发 | `byclaw_exe`（默认）+ 用户沙箱派生（`<base>:<userCode>`） | 个人沙箱 / OpenClaw main agent / 百应技能 / 本地 SQL / GitHub 周报 | OpenClaw stream → channel → callbackUrl 回推 |

**入站口径上的差别**：

- `data` / `qa` 直接消费 Gateway Redis 命令流；
- `exe` 通过 OpenClaw `byai-channel` webhook 接收命令、用 `callbackUrl` 回流；BE 有两条不同的对接路径 —— OpenClaw 数字员工时前端直接走 WebSocket 不经过 `/superAgentChat`，普通用户沙箱时由 BE 端把 OpenClaw 当 worker 用。

**出站口径上的统一**：三者最终都把 SSE 风格的事件 / chunk 写到 BE 期望的位置（Redis Stream 或 callbackUrl），由 BE 转成同一组 `SseResponseEventEnum` 帧推回前端，所以 `byclaw-fe` 的 `SendHelper / useHandler` 不需要为不同 worker 写不同分支（除了已经处理的 OpenClaw 直连场景）。

---

## 12. 旁路与外围：MCP / 知识库管理 / 多端广播 / 文件上传

主链路之外，还有几条容易被忽略但确实参与"超级助手对话"的旁路：

### 12.1 `byclaw-data` MCP HTTP 入口

`byclaw-data/src/byclaw_data/mcp/main.py` 启动 FastAPI，挂在 `/api/v1/mcp` 等路径。它**不消费 Gateway 命令流**，提供：

- `MCP` 协议的工具调用接口（被 `worker_agent_type` 中其他 worker 通过 HTTP 调用，比如 main agent 想要查 DataCloud 数据时）
- REST 查询（DataCloud 数据 / 知识包等）
- `ByclawResultFileStorage`（结果文件落盘策略）：`DATACLOUD_RESULT_FILE_STORAGE_TYPE=local|api`，`api` 模式时通过 `BE_DOMAINNAME / DATACLOUD_RESULT_FILE_SERVICE_NAME` 推到 BE 的文件服务

所以"超级助手→main worker→需要查数据"的链路，会变成 worker 内部 HTTP 调 `byclaw-data/mcp` 而不是又起一轮 Redis 命令。

### 12.2 `byclaw-qa` 知识库管理 API

`byclaw-qa/api.py` 是给前端 / BE 的知识库管理面：

- `POST /api/v1/knowledgeItems/importByResourceId` 上传文档
- `POST /api/v1/fileToMarkdownIndexByResourceId` 触发文件转 markdown 并入索引（异步）
- `POST /api/v1/knowledgeItems/searchByResourceId` 检索

它做的事情是把 BE 用的 `resourceId` 翻译成 by-qa 内部的 `knCode`（从 MinIO 上的 `KG_DOC_{resourceId}.json` 读 `resourceCode`），再委派给 `by_qa.knowledge_base` 的 service。这条链路在前端"管理后台 → 知识库"里被使用，主对话流程并不直接调用，但用户在对话里"#引用知识库"时，引用到的就是这里建好的索引。

### 12.3 多端广播：BE 同时把帧塞进 Redis Stream 和其他 WebSocket

§6.3.3 已经提到 `RedisStreamMessageListener.onMessage` 在 offer 队列后顺手 `multiDeviceBroadcastService.broadcastRawEvent(...)`。完整的广播触发点有四个：

| 触发点 | 帧类型 | 文件 |
|---|---|---|
| `prepareParams` 末尾 | `userMessage`（用户输入回显） | `ScriptService.broadcastUserMessage` |
| `initEvent` 末尾 | `initialization` | `ScriptService.broadcastInitEvent` |
| Redis listener 收到任意帧 | 原帧（answerDelta 等） | `RedisStreamMessageListener.onMessage` |
| `storeMessage` 末尾 | `appStreamResponse` | `ScriptService.broadcastAppStreamResponse` |

- `senderChannel` 字段用来排除发起请求的那个 WebSocket 自己（避免重复显示）。
- WebSocket 接入由 `state.domain.ws.handler.WebSocketHandler` 处理（Netty）。设备列表来自用户的多端登录会话。
- 这条旁路保证：用户在 PC 提的问题，手机 App / 移动 H5 的同会话页面也能实时看到 token 流，**完全不依赖前端自己拉**。

### 12.4 文件上传与 superAgent payload 的衔接

§1.2 提到 `fileList` 必须 `status === 'done'`，这是因为：

- `byclaw-fe` 的 `UploadFile` 组件先调 `/byaiService/open/api/v1/file/upload`（BE → MinIO）拿到 `fileId / fileUrl / filePath / fileSize`。
- BE 把文件元数据回给前端 (`item.queryFile`)，前端在 `getSendPayload` 里塞进 `payload.files / extParams.files`。
- 进入 worker 后，worker 拿 `extra_payload.files` 走对应的处理：
  - `byclaw-data` 在动态 agent 路径里把文件视作 mounted_object 一部分；
  - `byclaw-qa` 走的是知识库异步索引（`fileToMarkdownIndexByResourceId`），对话里 `#引用` 它而不是直接传文件；
  - `byclaw-exe` / OpenClaw 走 `OpenclawSendHelper.generateFilePrompt` 把文件信息编码进 prompt（前端就替换好了）。
- 在 `extParams.chatType === 'MCP_CHAT'` 时，main worker 会通过 §12.1 的 MCP 接口把文件转成结构化数据再问数。

---

## 13. 一句话版

> 前端把 `superAgentMode` 编码成 `agentId='-1'`，POST 一个签名过的 SSE 请求到 `/byaiService/chat/superAgentChat`；BE `ChatChannelController` 按 `accessTerminal` 分到 `WebChannelService`，再交给 `AssistantChatService` 处理会话 / 成员 / 默认助理，进 `ScriptService` 模板：先写 `createSession/initialization` 并入库用户消息，再由 `RouteService` 通过 `GatewayClient` 按 `worker_agent_type` 把命令 `XADD` 到 Redis（`byclaw-data` 的 `DataCloudWorker`、`byclaw-qa` 的 `InstantSearchWorker`、或挂在 `byclaw-exe/byai-channel` 的 OpenClaw 沙箱）；worker 用 `by-framework` 的 `context.emit_chunk` 把每一帧 `XADD` 回 `byai_gateway:session:{sid}:data_stream`，BE 的 `SessionStreamManager + RedisStreamMessageListener` 把帧投进 `gatewayEventQueue`，原请求线程在 `while(poll 5min)` 中消费并实时 flush 给前端；流末 `storeMessage` 写库 + 写 `appStreamResponse` 收尾。前端 `SendHelper` 按 event 分发，喂给 `useChat` 的七段 handler，最终把消息装进 `messageList / thinkList`，`MessageList` 渲染成实时打字的气泡。期间多端广播一路同步到同账号的其他设备，文件 / 知识库 / MCP 等旁路通过 BE 的 `/open/api` 与 `byclaw-data/mcp`、`byclaw-qa/api` 协同。
