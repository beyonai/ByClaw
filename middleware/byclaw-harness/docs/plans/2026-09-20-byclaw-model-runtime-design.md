# ByClaw 会话模型与 DSH/pi-ai 供应商适配设计 

## 文档状态

- 状态：设计稿，已按 2026-09-20 讨论结论修订
- 日期：2026-09-20
- 影响仓库：
  - `byclaw-harness`
  - `ByClaw/byclaw-exe/extensions/baiying-enhance`
  - `ByClaw/byclaw-be`
  - 必要时涉及 `ByClaw/byclaw-fe`
- 本文定义语义、数据流、运行时边界、迁移和验收方案，不包含实现修改。

## 1. 最终设计结论

本设计采用以下原则：

1. **模型型号永远不内置。**
   - 不维护 ByClaw 到 pi-ai 的模型型号映射表。
   - 不查找或复用 pi-ai 的内置模型清单。
   - 不按 `modelCode` 做模糊、精确或版本推断。
   - 每条模型都由 ByClaw 模型实例配置动态创建。

2. **内置的是供应商实现。**
   - 映射对象是 `providerName + modelProtocol`。
   - 映射结果是 pi-ai/OpenClaw 的供应商执行实现或 API serializer。
   - 优先继承 pi-ai 内置供应商的执行行为。
   - pi-ai 没有合适供应商实现时，才创建 ByClaw 自定义供应商实现。

3. **ByClaw 前后端是模型配置的唯一事实来源。**
   - 前端负责展示和提交供应商、协议、模型型号、URL、Token、Thinking 等配置。
   - 后端负责校验、归一化、保存、加密和同步 Redis。
   - `baiying-enhance` 与 `byclaw-integration` 不再维护业务模型目录，也不补充一套独立模型默认配置。

4. **运行时插件只是执行器。**
   - `baiying-enhance` 把同一份模型实例配置转换成 OpenClaw `ProviderBundle`。
   - `byclaw-integration` 把同一份模型实例配置转换成 pi-ai `Provider`、pi-ai `Model` 和 DSH `ModelSelection`。
   - 两者共享的是后端数据契约和字段语义，不是共享的供应商或模型业务目录。

5. **显示名称不参与任何运行时判断。**
   - `displayName` 只用于 UI、日志和 `model.name`。
   - `modelCode` 原样作为上游请求的 `model` 值。

6. **本次不修改既有模型选择和回退策略。**
   - `rel_model_id` 仍按现有会话模型选择流程参与当轮解析。
   - 成功解析出的模型实例按本文供应商适配方案执行。
   - 解析失败后的模板模型、默认模型、last-good 和静态 fallback 行为保持现状。
   - 是否把会话显式选择改成严格失败，作为后续独立议题评审。

## 2. 概念边界

### 2.1 pi-ai 内置供应商

pi-ai 内置供应商是已经实现好的供应商执行行为，例如：

- 请求序列化；
- 流式响应解析；
- Tool Call 处理；
- Reasoning/Thinking 字段处理；
- 错误标准化；
- API 特有兼容逻辑；
- 供应商默认鉴权方式；
- 官方默认 URL；
- pi-ai 自带模型列表。

例如 pi-ai 的 `deepseekProvider()` 本质上会创建：

```ts
createProvider({
  id: 'deepseek',
  name: 'DeepSeek',
  baseUrl: 'https://api.deepseek.com',
  auth: deepseekEnvironmentAuth,
  models: DEEPSEEK_MODELS,
  api: openAICompletionsApi(),
})
```

在 ByClaw 场景中，只复用其中的**执行行为**。以下内容由 ByClaw 模型实例覆盖或替换：

- provider ID；
- URL；
- Token；
- Headers；
- 模型列表；
- 模型名称；
- 模型型号；
- 上下文和最大输出；
- Thinking 配置。

### 2.2 ByClaw 自定义供应商

当 pi-ai 没有适合的内置供应商，或供应商的下列行为明显不同，ByClaw 才定义完整的自定义供应商：

- 鉴权机制；
- 请求协议；
- payload serializer；
- 流式响应协议；
- Tool Call 表达；
- 错误格式；
- Thinking 请求格式。

自定义供应商仍由 `providerName + modelProtocol` 精确选择，不能根据 URL 或模型名称猜测。

### 2.3 继承供应商并覆盖实例设置

这是 ByClaw 的主要使用方式：

```text
pi-ai 内置供应商执行行为
+ ByClaw 模型实例 URL
+ ByClaw 模型实例 Token/Headers
+ ByClaw 动态模型
+ ByClaw Thinking 配置
= 当前模型实例的 runtime provider
```

覆盖 URL、Token、模型型号或 Thinking 不等于创建一个新的业务供应商。业务供应商仍由 `providerName` 表示。

### 2.4 ByClaw 动态模型

所有模型都由 ByClaw 模型记录动态创建：

```text
pi-ai model.id             ← ByClaw modelCode
pi-ai model.name           ← ByClaw displayName
pi-ai model.baseUrl        ← ByClaw apiEndpoint
pi-ai model.contextWindow  ← ByClaw contextTokens
pi-ai model.maxTokens      ← ByClaw maxTokens
pi-ai model.input          ← ByClaw abilities
pi-ai model.reasoning      ← ByClaw reasoningConfig
```

即使 pi-ai 内置模型清单中恰好存在相同型号，也不使用该模型条目。这样模型配置始终由 ByClaw 前后端控制，不受 pi-ai 内置模型目录升级影响。

## 3. ByClaw 字段语义

| ByClaw 字段 | 语义 | DSH/pi-ai 用途 |
| --- | --- | --- |
| `id` / `modelId` | 模型实例 ID | 会话选择、Redis 精确读取、runtime provider 隔离 |
| `displayName` / `modelName` | 用户可见名称 | `model.name`、UI、日志，不参与匹配 |
| `providerName` | 供应商语义 | 选择供应商 adapter |
| `modelProtocol` | 供应商下的接口协议 | 选择 API serializer |
| `modelCode` / `modelNo` | 上游模型型号 | `model.id` 和请求体中的 `model` |
| `apiEndpoint` / `url` | 当前实例 URL | provider/model `baseUrl` |
| `apiToken` / `authToken` | 当前实例凭证 | 内存 credential，不写入日志或会话 |
| `headers` | 自定义鉴权或路由头 | provider/model headers |
| `contextTokens` | 上下文长度 | `model.contextWindow` |
| `maxTokens` | 最大输出长度 | `model.maxTokens` |
| `abilities` | 文本、多模态等能力 | `model.input` |
| `temperature`、`topP` 等 | 模型默认采样参数 | `model.samplingParams` 或请求默认参数 |
| `reasoningConfig` | Thinking 能力和映射 | 模型能力、会话档位和 payload |

### 3.1 显示名称

`displayName` 可以自由定义，例如：

```text
DeepSeek 极速版
黄升写作专用
生产环境主模型
```

它只进入：

- 模型管理界面；
- 会话模型选择器；
- pi-ai `model.name`；
- 非敏感日志和错误提示。

它不进入：

- 供应商选择；
- 协议选择；
- API 选择；
- 型号查找；
- Thinking 格式推断；
- runtime provider ID。

### 3.2 供应商与协议

`providerName` 是供应商语义，`modelProtocol` 是该供应商下的接口变体。

例如：

```text
providerName = DeepSeek
modelProtocol = OpenAI
```

含义是：

```text
DeepSeek 供应商语义
└── 使用 OpenAI Completions 协议执行
```

而不是把供应商改成 OpenAI。

如果配置为：

```text
providerName = DeepSeek
modelProtocol = Anthropic
```

则必须存在明确的 `DeepSeek + Anthropic` runtime adapter。没有就应由后端拒绝配置，运行时也必须再次拒绝，不能临时换用其他 serializer。

### 3.3 模型型号

`modelCode` 不用于查目录，直接进入动态模型：

```ts
const model = {
  id: record.modelCode,
  // ...
}
```

请求体最终使用：

```json
{
  "model": "deepseek-flash"
}
```

禁止：

- 把 `deepseek-flash` 映射为 `deepseek-v4-flash`；
- 在 pi-ai 模型列表中查相似型号；
- 根据显示名称后缀判断型号；
- 根据最新版模型自动替换型号。

## 4. 配置权威与职责划分

### 4.1 前端职责

前端负责：

- 展示后端允许的供应商选项；
- 展示后端允许的协议选项；
- 提交显示名称、型号、URL、Token、Headers；
- 提交上下文、输出和采样参数；
- 提交 Thinking 能力、默认档位、Supported Efforts、Effort Map、Budget 和 compatFormat；
- 在模型调试界面使用同一套配置生成调试请求。

前端不负责：

- 选择 pi-ai 模型；
- 推断 runtime provider；
- 根据型号猜供应商；
- 补运行时默认能力。

### 4.2 后端职责

后端是模型配置的唯一事实来源，负责：

- 校验字段完整性；
- 校验 `providerName + modelProtocol` 组合是否合法；
- 校验 Thinking 字段之间的一致性；
- 归一化枚举值；
- 加密 Token；
- 保存模型实例；
- 同步完整运行时配置到 Redis；
- 保存会话当前模型和 Thinking 档位；
- 在命令扩展参数中下发 `rel_model_id` 和 `thinkingLevel`。

后端不应依赖 runtime 插件去猜或修复业务配置。

### 4.3 baiying-enhance 职责

`baiying-enhance`：

- 读取后端同步的模型实例配置；
- 根据 `providerName + modelProtocol` 选择 OpenClaw adapter；
- 创建当前模型实例的 OpenClaw provider 配置；
- 使用 ByClaw 模型参数和 Thinking 配置；
- 应用 OpenClaw 特有的 provider hook 和 payload patch。

### 4.4 byclaw-integration 职责

`byclaw-integration`：

- 根据 `rel_model_id` 读取 Redis 模型实例；
- 根据 `providerName + modelProtocol` 选择 pi-ai 供应商 adapter；
- 基于 pi-ai 内置供应商行为或 ByClaw 自定义供应商行为创建 runtime provider；
- 根据 ByClaw 记录动态创建 pi-ai model；
- 根据本轮 `thinkingLevel` 创建 DSH `ModelSelection`；
- 在 Prompt 组装和 LLM 请求快照之前安装选择。

### 4.5 两个运行时之间共享什么

`baiying-enhance` 和 `byclaw-integration` 共享的是：

- 后端 Redis 数据结构；
- `providerName`、`modelProtocol` 等枚举语义；
- Thinking 字段语义；
- 同一组模型配置 fixture；
- 同一组契约测试期望。

它们不共享：

- 业务模型目录；
- 模型型号映射；
- 另一份供应商业务配置源；
- 独立于前后端的 Thinking 默认配置目录。

两个 runtime adapter 可以分别实现，因为 OpenClaw 和 pi-ai 目标类型不同；但它们对相同输入必须得出一致的业务语义。

## 5. pi-ai 内置供应商的使用方式

### 5.1 为什么不能直接注册内置 provider

以 `deepseekProvider()` 为例，直接注册会带来：

- 固定 provider ID `deepseek`，无法隔离多个 ByClaw 模型实例；
- 官方固定 URL，无法使用前端配置的 URL；
- 环境变量鉴权，无法使用 Redis 中的实例 Token；
- pi-ai 内置模型列表，无法表达所有 ByClaw 动态型号；
- 不同模型实例的 Headers、timeout、retry 无法隔离。

因此 ByClaw 不直接把内置 provider 原样注册到 DSH。

### 5.2 继承内置供应商执行行为

供应商 adapter 先创建 pi-ai 内置供应商：

```ts
const builtin = deepseekProvider()
```

然后把它的执行行为委托给一个新的实例级 provider：

```ts
const runtimeProvider = createProvider({
  id: 'byclaw-deepseek-m-20033843',
  name: 'DeepSeek 极速版',
  baseUrl: 'https://example.com/v1',
  headers: resolvedHeaders,
  auth: byClawCredentialAuth('20033843'),
  models: [dynamicModel],
  api: {
    stream: (...args) => builtin.stream(...args),
    streamSimple: (...args) => builtin.streamSimple(...args),
    ...(builtin.fetchDeferred
      ? { fetchDeferred: (...args) => builtin.fetchDeferred!(...args) }
      : {}),
    ...(builtin.cancelDeferred
      ? { cancelDeferred: (...args) => builtin.cancelDeferred!(...args) }
      : {}),
  },
})
```

这样复用：

- pi-ai 内置供应商的请求执行；
- 流式解析；
- Tool Call；
- 错误处理；
- 供应商/API 兼容行为。

同时替换：

- provider ID；
- URL；
- 鉴权；
- Headers；
- 模型列表。

### 5.3 动态模型

```ts
const dynamicModel: Model<Api> = {
  id: record.modelCode,
  name: record.modelName || record.modelCode,
  provider: runtimeProviderId,
  api: resolvedProviderAdapter.api,
  baseUrl: record.url,
  reasoning: resolvedReasoning.enabled,
  input: resolvedInput,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  },
  contextWindow: resolvedContextWindow,
  maxTokens: resolvedMaxTokens,
  samplingParams: resolvedSamplingParams,
  headers: resolvedModelHeaders,
  thinkingLevelMap: resolvedReasoning.thinkingLevelMap,
  compat: resolvedReasoning.compat,
}
```

这个 model 完全来自 ByClaw 配置，不从 `builtin.getModels()` 取任何型号或默认能力。

### 5.4 自定义供应商实现

如果没有可继承的 pi-ai 内置供应商，则供应商 adapter 直接提供 `ProviderStreams`：

```ts
const runtimeProvider = createProvider({
  id: runtimeProviderId,
  name: record.modelName,
  baseUrl: record.url,
  auth: byClawCredentialAuth(record.modelId),
  headers: resolvedHeaders,
  models: [dynamicModel],
  api: customProviderStreams,
})
```

自定义实现必须通过显式 `providerName + modelProtocol` 注册，不能按 URL 自动选择。

## 6. 供应商 adapter 映射

这里的 adapter 表是运行时技术映射，不是业务配置源，也不包含模型型号。

建议结构：

```ts
type ProviderAdapterKey = `${ByClawProviderName}:${ByClawModelProtocol}`

interface PiAiProviderAdapter {
  providerName: string
  modelProtocol: string
  api: Api

  createExecutionBehavior(): ProviderStreams

  validateConfig(config: NormalizedByClawModelConfig): void

  resolveReasoning(
    config: NormalizedByClawReasoningConfig,
  ): ResolvedPiAiReasoning
}
```

示例注册：

```ts
const providerAdapters = new Map<ProviderAdapterKey, PiAiProviderAdapter>([
  ['DeepSeek:OpenAI', deepSeekOpenAiAdapter],
  ['OpenAI:OpenAI', openAiCompletionsAdapter],
  ['OpenAI:OpenAI Responses', openAiResponsesAdapter],
  ['Anthropic:Anthropic', anthropicMessagesAdapter],
  ['OpenRouter:OpenAI', openRouterAdapter],
  ['Together:OpenAI', togetherAdapter],
  ['ZAI:OpenAI', zaiAdapter],
])
```

规则：

- 使用后端保存的标准 value 精确匹配；
- 不使用本地化 label；
- 不做大小写模糊匹配；
- 不把 `providerName` 当成 `modelProtocol` 的后备字符串；
- 未注册组合返回 `BYCLAW_PROVIDER_ADAPTER_NOT_FOUND`；
- 后端与 runtime 都需要校验组合，形成双重保护。

## 7. 完整数据流程

下面以一个 ByClaw DeepSeek 配置为例。

### 7.1 前端配置

```text
模型名称：DeepSeek 极速版
模型型号：deepseek-flash
供应商：DeepSeek
模型协议：OpenAI
URL：https://example.com/v1
Token：sk-xxx

Thinking：
  enabled：true
  capability：effort
  defaultLevel：high
  supportedEfforts：[high, max]
  effortMap：
    high → high
    max  → max
  compatFormat：deepseek
```

### 7.2 后端保存

后端保存并同步类似以下记录：

```json
{
  "instanceId": "20033843",
  "modelName": "DeepSeek 极速版",
  "modelCode": "deepseek-flash",
  "url": "https://example.com/v1",
  "authToken": "<encrypted>",
  "maxContentToken": 1000000,
  "status": 1,
  "instanceParam": {
    "providerName": "DeepSeek",
    "modelProtocol": "OpenAI",
    "headers": [],
    "maxTokens": 65536,
    "connectTimeoutSec": 32,
    "readTimeoutSec": 60,
    "maxRetries": 3,
    "retryIntervalSec": 1,
    "reasoningConfig": {
      "enabled": true,
      "capability": "effort",
      "defaultLevel": "high",
      "supportedEfforts": ["high", "max"],
      "effortMap": {
        "high": "high",
        "max": "max"
      },
      "compatFormat": "deepseek"
    }
  }
}
```

### 7.3 会话选择

用户在会话中选择该模型后，后端保存会话覆盖并向 Harness 下发：

```json
{
  "rel_model_id": "20033843",
  "rel_model_code": "deepseek-flash",
  "rel_model_name": "DeepSeek 极速版",
  "thinkingLevel": "high"
}
```

权威字段是 `rel_model_id`。名称和型号只用于展示与诊断，不能代替模型实例查找。

### 7.4 Harness 解析

```text
rel_model_id=20033843
    ↓
读取 Redis 模型实例
    ↓
providerName=DeepSeek
modelProtocol=OpenAI
    ↓
精确选择 DeepSeek:OpenAI adapter
    ↓
继承 pi-ai deepseekProvider 执行行为
    ↓
使用 ByClaw URL、Token、Headers 创建实例 provider
    ↓
使用 ByClaw modelCode 和能力创建动态 model
```

### 7.5 创建 runtime provider

```text
runtime provider ID = byclaw-deepseek-m-20033843
semantic provider   = DeepSeek
API                 = openai-completions
base URL            = https://example.com/v1
credential          = Redis 模型 20033843 的解密 Token
models              = 当前动态模型
```

### 7.6 创建动态 model

```text
model.id            = deepseek-flash
model.name          = DeepSeek 极速版
model.provider      = byclaw-deepseek-m-20033843
model.api           = openai-completions
model.baseUrl       = https://example.com/v1
model.contextWindow = 1000000
model.maxTokens     = 65536
model.reasoning     = true
```

### 7.7 安装 DSH ModelSelection

```ts
installModelSelection(agentContext, {
  current: {
    provider: 'byclaw-deepseek-m-20033843',
    model: 'deepseek-flash',
    reasoningEffort: 'high',
  },
  assembled: undefined,
})
```

安装必须发生在 Prompt 组装和 LLM 请求配置快照之前。

### 7.8 发出请求

pi-ai 内置 DeepSeek 执行行为根据动态 provider/model 发出概念上类似的请求：

```http
POST https://example.com/v1/chat/completions
Authorization: Bearer sk-xxx
Content-Type: application/json
```

```json
{
  "model": "deepseek-flash",
  "messages": [
    {
      "role": "user",
      "content": "今天写点什么"
    }
  ],
  "stream": true,
  "reasoning_effort": "high"
}
```

实际 Thinking 字段由供应商 adapter、协议和后端 Thinking 配置共同决定。

## 8. Thinking 映射

### 8.1 权威来源

Thinking 的业务配置来自 ByClaw 前后端：

- `enabled`
- `capability`
- `defaultLevel`
- `supportedEfforts`
- `effortMap`
- `compatFormat`
- `budgets`

runtime adapter 只负责：

- 校验当前框架是否能执行该配置；
- 转换为 pi-ai/OpenClaw 类型；
- 生成相应 payload；
- 在发出请求前拒绝不支持的组合。

runtime adapter 不维护另一套业务默认 Thinking 配置。

### 8.2 字段含义

| 字段 | 运行时含义 |
| --- | --- |
| `enabled=false` | 关闭 Thinking |
| `capability=unsupported` | 只允许 `off` |
| `capability=binary` | 只允许关闭/开启，开启的请求值由 adapter 生成 |
| `capability=effort` | 档位通过 `effortMap` 转换为上游值 |
| `capability=budget` | 档位通过 `budgets` 转换为 token budget |
| `capability=adaptive` | 使用供应商特有自适应模式 |
| `defaultLevel` | 会话没有显式选择时的默认档位 |
| `supportedEfforts` | 会话允许选择的严格白名单 |
| `effortMap` | ByClaw 档位到上游 wire value 的映射 |
| `compatFormat` | 当前供应商 adapter 使用的 Thinking payload 格式 |
| `budgets` | 档位到预算数值的映射 |

### 8.3 档位优先级

```text
本轮/会话显式 thinkingLevel
    > 模型实例 reasoningConfig.defaultLevel
    > off
```

没有运行时模型目录默认档位，也不从 pi-ai 内置模型条目读取默认档位。

### 8.4 Supported Efforts

- 非空数组是严格白名单；
- `off` 始终作为关闭选项处理；
- 空数组的业务含义必须由后端统一确定，建议归一化为明确列表，而不是让两个 runtime 各自解释；
- 会话选择不在白名单中的档位时，在网络调用前失败；
- 不自动夹取或降级到相邻档位。

### 8.5 Effort Map

```json
{
  "minimal": "high",
  "low": "high",
  "medium": "high",
  "high": "high",
  "xhigh": "max",
  "max": "max"
}
```

左侧是 ByClaw 标准档位，右侧是上游 wire value。

规则：

- 右侧值原样交给供应商 adapter；
- 不再次强制转换成 pi-ai 标准档位；
- `off` 必须真正关闭，不能映射到默认开启档位；
- 缺失映射的行为应由后端在保存时明确处理或拒绝，runtime 不猜测。

### 8.6 adaptive

pi-ai 0.85.1 的标准 `ModelThinkingLevel` 不包含 `adaptive`。因此：

- 后端允许 `adaptive` 时，必须同时明确供应商/协议如何表达；
- adapter 可把 `adaptive` 转换成供应商原生 payload；
- 如果当前 pi-ai adapter 无法表示，应在请求前返回明确错误；
- 不把 `adaptive` 静默转换为 `medium`、`high` 或其他档位。

### 8.7 compatFormat

`compatFormat` 来自后端配置，runtime adapter 负责执行和校验：

```text
DeepSeek:OpenAI + compatFormat=deepseek
    → 使用 DeepSeek Thinking payload 行为

Qwen:OpenAI + compatFormat=bailian
    → 使用百炼/Qwen 对应 payload 行为
```

禁止：

- 根据 URL 猜 compatFormat；
- 根据显示名称猜 compatFormat；
- 根据 modelCode 前缀猜 compatFormat。

## 9. 会话模型选择边界

本次改造只替换“模型实例如何物化成 DSH/pi-ai provider 和 model”，不修改现有模型选择优先级、失败处理和 fallback 策略。

### 9.1 当前会话模型输入

当本轮包含 `rel_model_id` 时：

```text
rel_model_id
    → 精确读取模型实例
    → 精确选择 provider adapter
    → 创建或取得 runtime profile
    → 安装 ModelSelection
```

以下情况会产生明确的模型解析错误，随后如何处理由现有模型选择和 fallback 策略决定：

- Redis 模型记录不存在；
- 模型已禁用；
- URL、Token 或 modelCode 缺失；
- `providerName + modelProtocol` 未注册；
- Thinking 配置无法执行；
- provider/profile 注册失败。

本设计暂不改变以下现有路径：

- 员工模板模型；
- 公共默认模型；
- last-good 模型；
- Cordis 静态 fallback；
- 其他具有相同 `modelCode` 的实例。

这些路径的顺序、触发条件和可见性应保持当前行为。后续如需将显式选择改为严格失败，应另起设计，不与供应商适配重构捆绑。

### 9.2 默认选择与 fallback

员工默认模型、ByClaw 公共默认模型、last-good 和部署 fallback 继续按当前产品及运行时规则工作。

本次唯一变化是：当这些路径最终选中一条 ByClaw 模型实例后，该实例也使用本文定义的供应商 adapter 和动态模型物化流程执行。

### 9.3 时序

```text
收到 ByClaw 命令
    → 解析 sessionId / rel_model_id / thinkingLevel
    → 读取并解析模型实例
    → 注册或取得 runtime profile
    → 安装 ModelSelectionRef.current
    → 组装 Prompt
    → 发起 LLM 请求
```

不能在 Prompt 已组装或请求配置已快照后再修改模型选择。

## 10. Redis 输入契约

建议后端输出归一化的模型实例结构，避免两个 runtime 分别解释数据库历史格式：

```ts
interface NormalizedByClawModelConfig {
  modelId: string
  displayName: string
  modelCode: string
  providerName: string
  modelProtocol: string
  enabled: boolean
  apiEndpoint: string
  encryptedAuthToken: string
  headers: Array<{ key: string; value: string }>
  contextTokens: number
  maxTokens: number
  abilities: string[]
  connectTimeoutSec: number
  readTimeoutSec: number
  maxRetries: number
  retryIntervalSec: number
  samplingParams: {
    temperature?: number
    topP?: number
    frequencyPenalty?: number
    presencePenalty?: number
  }
  reasoningConfig: NormalizedByClawReasoningConfig
}
```

若短期继续使用现有 Redis 字段，`baiying-enhance` 与 `byclaw-integration` 应使用相同 fixture 验证字段归一化结果一致。

## 11. 缓存和热更新

runtime profile 缓存键建议为：

```text
modelId + Redis payload hash
```

下列字段变化必须生成新 profile：

- providerName；
- modelProtocol；
- modelCode；
- URL；
- Token；
- Headers；
- contextTokens/maxTokens；
- abilities；
- timeout/retry；
- sampling parameters；
- reasoningConfig。

正在运行的请求继续使用不可变旧 profile；新请求使用新 profile。不得原地修改正在使用的 credential 或 provider 对象。

## 12. 安全边界

- Token 只在内存中解密和使用；
- Token 不进入 DSH `ModelSelection`；
- Token 不进入模型名称、provider ID、日志或会话持久化；
- 自定义 Headers 按敏感 Header 规则脱敏；
- runtime provider ID 只包含受控供应商 slug 和模型实例 ID；
- `extendParam` 不能覆盖 provider adapter 或注入任意 serializer；
- provider adapter 不应记录完整请求鉴权信息。

## 13. 错误模型

建议稳定错误码：

| 错误码 | 含义 |
| --- | --- |
| `BYCLAW_MODEL_NOT_FOUND` | `rel_model_id` 对应模型记录不存在 |
| `BYCLAW_MODEL_DISABLED` | 模型未启用 |
| `BYCLAW_MODEL_RECORD_INVALID` | 型号、URL、Token 等实例字段缺失 |
| `BYCLAW_PROVIDER_ADAPTER_NOT_FOUND` | 未注册 `providerName + modelProtocol` adapter |
| `BYCLAW_PROVIDER_CONFIG_INVALID` | 供应商实例配置不能被 adapter 执行 |
| `BYCLAW_REASONING_CONFIG_INVALID` | Thinking 配置不合法或当前 adapter 无法执行 |
| `BYCLAW_UNSUPPORTED_REASONING_EFFORT` | 会话 Thinking 档位不在白名单中 |
| `BYCLAW_MODEL_REGISTRATION_FAILED` | runtime provider/profile 注册失败 |

删除模型目录相关错误概念：

- 不存在“模型映射未找到”；
- 不存在“内置模型目录不一致”；
- 不存在“pi-ai 内置型号缺失”。

## 14. 可观测性

每轮成功解析后记录非敏感结构化事件：

```json
{
  "event": "byclaw_model_selection_resolved",
  "sessionId": "...",
  "sourceModelId": "20033843",
  "displayName": "DeepSeek 极速版",
  "semanticProvider": "DeepSeek",
  "modelProtocol": "OpenAI",
  "runtimeProviderId": "byclaw-deepseek-m-20033843",
  "modelCode": "deepseek-flash",
  "api": "openai-completions",
  "thinkingLevel": "high",
  "resolution": "explicit"
}
```

日志应能回答：

- 本轮选择了哪条 ByClaw 模型实例；
- 使用了哪个供应商 adapter；
- 使用了哪个协议/API；
- 发给上游的 modelCode 是什么；
- Thinking 最终档位是什么；
- 是否发生过回退。

禁止记录 Token、Authorization 和敏感 Headers。

## 15. 对当前 byclaw-integration 的修改方向

当前 `model-runtime.ts` 需要按以下方向调整：

1. `protocolOf()` 不再把 `providerName` 和 `modelProtocol` 放在一个循环中猜 API。
2. 新增精确的 `providerName + modelProtocol` adapter registry。
3. 每个 adapter 优先复用对应 pi-ai 内置供应商执行行为。
4. Redis 中每条模型记录始终创建动态 pi-ai model。
5. 不读取 pi-ai 内置供应商的 `getModels()` 作为 ByClaw 型号来源。
6. runtime provider 使用模型实例 ID 隔离 URL、Token 和 Headers。
7. `displayName` 只写入 `model.name` 和诊断信息。
8. `modelCode` 原样写入 `model.id`。
9. Thinking 映射保留任意 wire value，不重复归一化右值。
10. `off` 必须真正关闭，不得映射为默认开启档位。
11. 接入本轮 `thinkingLevel`，并在请求前进行 Supported Efforts 校验。
12. 保持现有模板、default、last-good 和静态 fallback 的顺序及触发条件不变。

## 16. 与 baiying-enhance 的对齐方向

`baiying-enhance` 不需要和 `byclaw-integration` 共享一份业务供应商目录。它需要：

1. 使用后端相同的标准 `providerName`、`modelProtocol` 和 Thinking 字段。
2. 通过 OpenClaw 自己的 adapter 表转换供应商行为。
3. 不按 modelCode 或 displayName 推断 provider/API/Thinking。
4. 不补充一套独立模型默认配置。
5. 与 `byclaw-integration` 共用 fixture 和契约期望，保证相同输入表达相同业务语义。

两边目标不同：

```text
相同 ByClaw 模型实例
    ├── baiying-enhance → OpenClaw ProviderBundle
    └── byclaw-integration → pi-ai Provider/Model + DSH ModelSelection
```

## 17. 建议的代码结构

```text
plugins/byclaw-integration/src/model-runtime/
├── types.ts
├── redis-record.ts
├── provider-adapters.ts
├── provider-behavior.ts
├── reasoning.ts
├── materialize.ts
├── runtime.ts
└── errors.ts
```

职责：

- `types.ts`：归一化的后端模型配置和运行时类型；
- `redis-record.ts`：读取现有 Redis 结构并归一化；
- `provider-adapters.ts`：`providerName + modelProtocol` 精确技术映射；
- `provider-behavior.ts`：继承 pi-ai 内置供应商或创建自定义供应商；
- `reasoning.ts`：验证和转换后端 Thinking 配置；
- `materialize.ts`：创建实例级 provider、动态 model 和 profile；
- `runtime.ts`：缓存、注册和会话选择；
- `errors.ts`：稳定错误码和非敏感诊断。

现有 `model-runtime.ts` 可暂时作为兼容导出入口。

## 18. 迁移步骤

### 阶段一：契约和测试

- 固化现有后端 Redis 模型 fixture。
- 明确供应商和协议标准 value。
- 明确空 Supported Efforts、adaptive 和 compatFormat 的后端语义。
- 添加 provider adapter 映射测试。

### 阶段二：重构供应商解析

- 新增精确 adapter registry。
- 移除字符串猜测式 `protocolOf()`。
- 实现 pi-ai 内置供应商行为继承。
- 保留自定义供应商扩展点。

### 阶段三：重构动态模型物化

- 所有模型从 ByClaw Redis 记录动态创建。
- 不使用 pi-ai 内置模型列表。
- 使用实例级 runtime provider。
- 完整接入 Headers、采样参数、timeout 和 retry。

### 阶段四：接入会话模型和 Thinking

- 在 Prompt 组装前解析 `rel_model_id`。
- 安装本轮 `ModelSelection`。
- 接入 `thinkingLevel`。
- 严格校验 Supported Efforts 和映射。
- 不改变现有模型解析失败和 fallback 行为。

### 阶段五：对齐 baiying-enhance

- 使用同一组后端 fixture。
- 对齐供应商/协议语义和 Thinking 期望。
- 移除型号、URL、显示名称驱动的猜测。
- 保留两个框架各自的 runtime adapter。

## 19. 测试设计

### 19.1 字段映射测试

- 修改 `displayName` 不影响 provider、protocol、modelCode 或请求行为。
- `modelCode` 原样成为 pi-ai `model.id`。
- URL、Token、Headers 来自指定模型实例。
- context/max tokens、abilities、采样参数正确映射。
- 不调用 pi-ai 内置 provider 的模型列表做型号查找。

### 19.2 供应商 adapter 测试

- `DeepSeek + OpenAI` 使用 DeepSeek 内置供应商执行行为。
- `OpenAI + OpenAI Responses` 使用 Responses 行为。
- `Anthropic + Anthropic` 使用 Anthropic Messages 行为。
- 未注册组合明确失败。
- 同一供应商的两个 ByClaw 模型实例拥有不同 runtime provider ID、URL 和 credential。
- 自定义供应商实现可以在不增加型号映射的情况下接入。

### 19.3 Thinking 测试

- `off` 真正关闭 Thinking。
- `supportedEfforts` 是严格白名单。
- `effortMap` 右侧 wire value 原样保留。
- budget 使用后端配置数值。
- 当前 adapter 不支持 adaptive 时请求前失败。
- compatFormat 不通过 URL、型号或名称推断。
- 会话档位覆盖模型默认档位。

### 19.4 会话集成测试

1. 会话从默认模型切换到模型实例 `20033843`，下一轮请求使用其 URL、Token 和 modelCode。
2. 同一会话切换到另一实例，下一轮立即使用新 runtime provider。
3. 改模型显示名称后，请求行为不变。
4. 同 modelCode、不同供应商实例使用各自 adapter。
5. 同供应商、不同协议使用不同 API serializer。
6. provider/protocol 未注册时产生明确解析错误，并继续遵循当前既有 fallback 策略。
7. Thinking 从 `off` 切到 `high` 后 payload 正确变化。
8. 选择未支持档位时在网络请求前失败。

### 19.5 跨运行时契约测试

把相同后端模型 fixture 分别输入：

- `baiying-enhance`；
- `byclaw-integration`。

比较业务语义：

- semantic provider；
- protocol/API；
- modelCode；
- context/max tokens；
- abilities；
- supported efforts；
- effort wire value；
- budget；
- compatFormat；
- 错误分类。

不要求两个 runtime 生成相同内部对象，只要求执行同一份后端配置时语义一致。

## 20. 验收标准

实现完成必须满足：

1. ByClaw 前后端是模型实例配置的唯一事实来源。
2. pi-ai/OpenClaw 只内置或映射供应商行为，不维护 ByClaw 型号清单。
3. 所有 pi-ai model 都由 ByClaw 模型记录动态创建。
4. `displayName` 可自由修改且不影响运行时选择。
5. `modelCode` 不经映射，原样发给上游。
6. `providerName + modelProtocol` 精确选择 runtime adapter。
7. ByClaw 模型实例优先继承 pi-ai 内置供应商执行行为。
8. URL、Token、Headers 和模型参数由 ByClaw 实例覆盖。
9. pi-ai 没有适合供应商时可接入 ByClaw 自定义供应商实现。
10. 同一供应商的多个模型实例互相隔离凭证和 Endpoint。
11. 会话 `rel_model_id` 在下一轮真实成为 DSH `ModelSelection`。
12. Thinking 配置按后端语义执行，不由 runtime 猜测。
13. 模型选择优先级、解析失败处理和 fallback 策略保持现状。
14. `baiying-enhance` 与 `byclaw-integration` 对相同后端配置表达相同业务语义。
15. 日志能无敏感信息地说明最终模型实例、供应商 adapter、协议、modelCode 和 Thinking 档位。

## 21. 实现前需要后端明确的字段语义

以下事项应由前后端确定，不能留给两个 runtime 分别猜测：

1. `providerName` 和 `modelProtocol` 的标准保存值及合法组合。
2. `supportedEfforts=[]` 表示“不支持任何开启档位”还是“未限制”。
3. `adaptive` 在各供应商/协议下的请求表达。
4. `compatFormat=auto` 是否由后端归一化成明确格式。
5. `effortMap` 缺失某个 Supported Effort 时是拒绝还是同名透传。
6. Token 缺失但 Headers 已提供 Authorization 时是否允许调用。
7. URL 保存的是 API 根地址还是完整 endpoint。

确认这些语义后，两个 runtime 只需要忠实执行，不再引入第二套产品规则。
