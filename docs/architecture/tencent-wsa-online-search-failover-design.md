# 腾讯 WSA 主用、SearXNG 故障降级设计

## 1. 文档状态

- 状态：已按设计实现，待验收
- 日期：2026-09-01
- 范围：`middleware/openclaw/skills/knowledge-collection` 公共互联网发现链路中的 `online-search`
  实现替换
- 不包含：`hot-discovery` 行为调整、正文抓取器替换、候选质量规则修改、采集交付契约修改

## 2. 背景

`knowledge-collection` 当前通过 `public-discover` 运行两个逻辑通道：

1. `online-search`：由镜像内置的 SearXNG CLI 发现公开网页 URL；
2. `hot-discovery`：通过垂直来源补充带平台热度的候选。

`public-discover` 负责通道编排、候选合并、页面类型判断、主题相关性校验和发现授权。正文仍由
`acquire-web`、`materialize-web` 等来源执行器获取和物化，搜索摘要不能作为文章全文。

腾讯联网搜索 API（WSA）的 `SearchPro` 接口能够返回标题、发布时间、来源 URL、摘要、相关性得分、
站点名称及套餐允许的权威度等字段。它适合作为 `online-search` 的主要实现，但不改变
`hot-discovery` 的职责和触发逻辑。

本设计将 WSA 定义为 SearXNG 的上位替代：WSA 可用时仅使用 WSA；WSA 出现通道级故障时才透明降级到
SearXNG。两者对 `public-discover` 共同表现为一条 `online-search` 通道，不并行竞争，也不分别参与
发现轮次计数。

## 3. 目标

1. 将 WSA 设为 `online-search` 的首选 provider。
2. WSA 通道级故障时，在同一次 `public-discover` 调用内自动降级到 SearXNG。
3. WSA 正常返回但结果为空或合格候选不足时，不启动 SearXNG，继续执行既有 `hot-discovery` 逻辑。
4. 对 `public-discover` 保持统一、稳定的搜索结果契约，避免让上层感知腾讯 API 的原始响应结构。
5. 保留实际 provider、降级原因、请求 ID、耗时和结果数量，确保可观测、可追溯。
6. 凭据只从运行环境读取，不进入命令参数、会话状态、发现快照、日志或错误详情。
7. 搜索结果只用于发现和授权 URL，正文获取、物化、校验与交付链路保持不变。

## 4. 非目标

- 不同时调用 WSA 和 SearXNG 做结果融合或交叉排序。
- 不把 WSA 新建为独立 Skill，也不允许 Agent 绕过 `public-discover` 直接调用搜索 API。
- 不修改 `hot-discovery` 的来源顺序、适配器、停止阈值、软硬预算或候选排序。
- 不使用 WSA 的 `content`、`passage` 或图片字段代替正文抓取。
- 不修改候选的 `article`、`weak`、`reject` 分类规则和主题相关性门禁。
- 不在首期启用 VR 卡、附件子链或搜索结果图片的本地物化。
- 不为 WSA 搜索结果定义跨调用缓存。

## 5. 方案比较

### 方案 A：WSA、SearXNG、hot-discovery 三通道并行

WSA 和 SearXNG 分别返回候选，再与 hot-discovery 统一合并。

优点是覆盖面最大；缺点是每次都产生 WSA 调用成本，候选融合与跨引擎分数比较复杂，也不符合“WSA 是
SearXNG 上位替代”的产品定位。该方案不采用。

### 方案 B：在 `public-discover` 中直接增加 WSA 分支

由 `public-discover` 先执行 WSA，失败后再构造并执行 SearXNG 命令。

优点是改动集中；缺点是 `public-discovery.mjs` 需要同时理解腾讯 API、SearXNG 进程和 hot-discovery，
进一步扩大编排器职责，并使 provider 独立测试变得困难。该方案不采用。

### 方案 C：建立统一 `online-search` provider 层

新增 `online-search` provider runner。runner 内部固定执行 WSA 主用、SearXNG 故障降级，并向
`public-discover` 返回统一结果。`public-discover` 继续把它当作单一在线搜索通道。

该方案职责清晰、对现有编排兼容性最好，也能独立验证故障判定、凭据保护和结果归一化，因此选用方案 C。

## 6. 总体架构

```text
knowledge-collection public-discover
          │
          ├── online-search provider runner
          │       │
          │       ├── 1. Tencent WSA SearchPro
          │       │          │
          │       │          ├── 正常响应 ──> 统一 online-search 结果
          │       │          └── 通道级故障
          │       │                         │
          │       └── 2. SearXNG CLI <─────┘
          │
          └── hot-discovery（现有逻辑保持不变）
                          │
                          ▼
              候选合并、分类与主题校验
                          │
                          ▼
              acquire-web / materialize-web
```

组件职责：

| 组件 | 职责 | 不负责 |
|------|------|--------|
| `online-search/provider.mjs` | 选择 WSA、判断通道故障、必要时降级到 SearXNG、输出统一诊断 | 候选质量判断、hot-discovery 编排 |
| `online-search/tencent-wsa.mjs` | 调用 SearchPro、解析 `Pages`、归一化腾讯结果 | 正文抓取、跨来源去重 |
| `online-search/searxng.mjs` | 封装现有 SearXNG CLI 调用和结果解析 | 判断何时使用 WSA |
| `public-discovery.mjs` | 保持现有发现轮次、hot-discovery、合并、授权和快照逻辑 | 腾讯 API 认证与原始响应解析 |

建议文件布局：

```text
middleware/openclaw/skills/knowledge-collection/
├── scripts/
│   ├── public-discovery.mjs
│   ├── public-discovery.test.mjs
│   └── online-search/
│       ├── provider.mjs
│       ├── provider.test.mjs
│       ├── tencent-wsa.mjs
│       ├── tencent-wsa.test.mjs
│       └── searxng.mjs
└── references/
    └── online-search.md
```

## 7. Provider 选择与降级语义

### 7.1 固定选择顺序

每次执行 `online-search` 时遵循以下顺序：

1. 检查 WSA 是否已启用且凭据是否完整；
2. 条件满足时调用 WSA；
3. WSA 返回正常搜索文档时立即结束，不调用 SearXNG；
4. WSA 出现通道级故障时调用 SearXNG；
5. SearXNG 成功则以降级成功状态返回；
6. 两者均失败时，`online-search` 通道失败，由 `public-discover` 按既有规则判断是否仍可使用
   hot-discovery 结果。

WSA 未启用或凭据未配置属于 `unavailable`，直接使用 SearXNG。这是预期降级，不应输出需要用户处理的认证提示。

### 7.2 触发 SearXNG 的通道级故障

以下情况触发降级：

- WSA 未启用；
- WSA 凭据缺失或不完整；
- 请求无法在配置的超时内完成；
- DNS、TLS、连接中断等网络错误；
- HTTP 响应无法读取或不是合法 JSON；
- 腾讯云响应包含 `Response.Error`；
- `Response`、`Pages` 等必需结构缺失或类型不正确；
- `Pages` 非空，但其中没有任何一项能解析为合法结果对象；
- SDK 初始化或运行时依赖不可用。

鉴权失败、未开通、资源不可用、限流和腾讯云内部错误均属于通道级故障。它们可触发本次只读搜索降级，
但 provider runner 不自动重试 WSA，避免延长共享发现预算或放大限流。

### 7.3 不触发 SearXNG 的正常结果

以下情况表示 WSA 已正常工作，不触发降级：

- `Pages` 是合法的空数组；
- WSA 返回结果，但经页面类型判断后没有 `article`；
- WSA 返回结果，但没有通过主题相关性校验；
- WSA 合格候选数量少于 `requested-count`；
- 当前套餐没有返回 `content`、`authority_level`、`pics` 或 `deeplinks` 等可选字段。

这些结果继续进入既有流程。是否启动 hot-discovery、何时停止以及如何选择候选，仍由当前
`public-discover` 逻辑决定。不得因候选质量不足在 provider 层追加一次 SearXNG 搜索。

### 7.4 发现轮次

WSA 调用及同一次调用内的 SearXNG 降级共同属于一次 `online-search` 执行，也属于一次
`public-discover` 发现轮次。降级不能调用 `reserveDiscoveryAttempt`，不能消耗第二轮发现机会，也不能更改
初始化时锁定的 query 和 category。

## 8. WSA 调用设计

### 8.1 接口与认证

首期严格采用腾讯云标准接口：

- Endpoint：`wsa.tencentcloudapi.com`
- Action：`SearchPro`
- Version：`2025-05-08`
- Region：不传
- Method：`POST`
- Content-Type：`application/json`

使用腾讯云官方 Node.js SDK 处理 TC3 签名，不在技能代码中自行实现签名算法。首期锁定
`tencentcloud-sdk-nodejs@4.1.304`，由 OpenClaw 镜像构建阶段安装；运行时不动态安装依赖。升级 SDK
属于独立依赖变更，必须重新运行本设计列出的 provider、回归和镜像构建验证。

凭据只允许从运行环境读取：

```text
TENCENTCLOUD_SECRET_ID
TENCENTCLOUD_SECRET_KEY
TENCENT_WSA_ENABLED
TENCENT_WSA_TIMEOUT_MS
```

两项凭据齐全且 `TENCENT_WSA_ENABLED` 未显式设为 `false` 时启用 WSA；`false` 可用于强制降级验证。
`SecretId` 和 `SecretKey` 不得出现在 CLI 参数、
返回对象、snapshot、`session.json`、日志、错误文本或测试快照中。测试通过依赖注入的伪客户端运行，不读取真实环境凭据。

### 8.2 参数映射

| `public-discover` 输入 | WSA 参数 | 规则 |
|------------------------|----------|------|
| `query` | `Query` | 必填，原样传递 |
| `category=general` | 不传 `Industry` | 使用公开网页自然结果 |
| `category=news` | `Industry=news` | 仅配置允许使用套餐参数时传递 |
| `category=science` | `Industry=acad` | 仅配置允许使用套餐参数时传递 |
| `category=finance` | `Industry=finance` | 仅配置允许使用套餐参数时传递 |
| `time-range=day` | `Freshness=d1` | 精确映射 |
| `time-range=week` | `Freshness=d7` | 精确映射 |
| `time-range=month` | `Freshness=m1` | 精确映射 |
| `time-range=year` | `Freshness=y1` | 精确映射 |
| `max-results` / `requested-count` | `Cnt` | 套餐允许时按 10/20/30/40/50 向上取档，最终在本地截断 |

首期固定 `Mode=0`，只请求公开网页自然结果；不传 `Deeplinks`。`language` 和 `pageno` 没有可靠的 WSA
等价参数，不映射也不拼入 query。站点限定不在首期增加新的 `public-discover` 命令参数；后续如有明确需求，
再独立设计 `Site` 的单域名搜索和最多五域名排除语义。

套餐能力通过部署配置显式声明，provider 不根据缺失字段猜测套餐，也不在参数错误后删减套餐参数重试。
未声明高级能力时只发送 `Query` 和固定的 `Mode=0`，在本地截断结果。

### 8.3 超时与重试

WSA 单次调用超时默认 10 秒，并受 `public-discover` 传入的剩余硬预算约束；有效超时取两者较小值。
provider 内不自动重试 WSA。超时或瞬态失败后立即进入 SearXNG 降级，并把 WSA 已消耗时间计入
`onlineSearchMs` 和发现总耗时。

SearXNG 继续使用当前单次搜索超时和外层进程超时。降级开始前必须检查剩余硬预算；预算已经耗尽时，
将 SearXNG 标记为 `skipped_hard_budget`，不得启动新进程。

## 9. WSA 响应归一化

WSA 的 `Response.Pages` 是 JSON 字符串数组。`tencent-wsa.mjs` 必须逐项解析，而不是把数组元素直接当成对象。

统一输出示例：

```json
{
  "query": "人工智能发展现状",
  "provider": "tencent-wsa",
  "requestId": "39684d0c-0504-4892-b7b4-0d8f05203007",
  "providerVersion": "flagship",
  "results": [
    {
      "url": "https://example.com/article",
      "title": "文章标题",
      "content": "动态摘要或标准摘要",
      "engine": "tencent-wsa",
      "score": 0.84889734,
      "publishedAt": "2025/02/26 09:37:00",
      "site": "来源站点",
      "authorityLevel": 4
    }
  ],
  "warnings": []
}
```

字段规则：

- `url`、`title` 为候选核心字段；URL 必须是无用户名和密码的 HTTP(S) URL。
- `content` 取 `page.content || page.passage || ''`，只用于候选分类和主题相关性判断。
- `engine` 固定为 `tencent-wsa`，保证后续来源追踪不误报为 SearXNG。
- `score` 保留 WSA 原值，只用于 WSA 结果内部排序，不和其他 provider 的分数直接比较。
- `publishedAt` 保留原始日期字符串；日期解析失败不影响候选使用。
- `site`、`authorityLevel` 作为附加元数据保留，缺失时省略。
- `pics`、`favicon` 和 `deeplinks` 不进入首期标准候选；原始响应可以在脱敏后留作会话内部诊断，但不能成为
  Markdown 的远程图片或全文证据。
- 单个 `Pages` 元素解析失败时记录有限长度 warning 并跳过；只要至少一条合法记录存在，WSA 通道仍成功。
- `RequestId`、`Version` 和非敏感 `Msg` 保留在 provider 诊断中，不参与候选正文。

搜索摘要的内容粒度始终是发现上下文，不能标记为 `excerpt`、`abstract` 或 `full-text` 采集成果，不能直接
交给 `collect`。

## 10. `online-search` 对外契约

正常使用 WSA：

```json
{
  "query": "查询词",
  "results": [],
  "provider": "tencent-wsa",
  "fallbackUsed": false,
  "providerDiagnostics": {
    "tencentWsa": {
      "status": "success",
      "durationMs": 832,
      "requestId": "request-id",
      "resultCount": 0
    },
    "searxng": {
      "status": "skipped",
      "skipReason": "primary_provider_succeeded"
    }
  }
}
```

WSA 失败、SearXNG 降级成功：

```json
{
  "query": "查询词",
  "results": [],
  "provider": "searxng",
  "fallbackUsed": true,
  "providerDiagnostics": {
    "tencentWsa": {
      "status": "failed",
      "code": "RequestLimitExceeded",
      "retryable": true,
      "durationMs": 1002
    },
    "searxng": {
      "status": "success",
      "durationMs": 2140,
      "resultCount": 12
    }
  }
}
```

对 `public-discover` 而言，以上两种情况都表现为 `channels.onlineSearch.status=success`。现有
`channels.searxng` 字段在兼容期继续保留，但语义改为在线搜索逻辑通道，并新增：

```json
{
  "provider": "tencent-wsa",
  "fallbackUsed": false
}
```

兼容期内不得删除 `channels.searxng`、`snapshots.searxng`、`candidateQuality.searxng` 和 `timing.searxngMs`，
避免破坏现有调用方和测试。新增同值别名：

- `channels.onlineSearch`
- `snapshots.onlineSearch`
- `candidateQuality.onlineSearch`
- `timing.onlineSearchMs`

旧字段标记为兼容字段，但本次不安排删除版本。snapshot 文件名可继续使用 `*-searxng.json` 以保持路径兼容，
文件内容必须通过 `provider` 明确实际来源；同时返回的 `snapshots.onlineSearch` 指向同一文件。

## 11. 与 hot-discovery 的数据流

### 11.1 未指定 `requested-count`

保持当前行为：`online-search` 与 hot-discovery 并行启动。变化仅发生在 `online-search` 内部：

```text
Promise.all([
  runOnlineSearch(),   // WSA -> 必要时 SearXNG
  runHotDiscovery()    // 完全不变
])
```

WSA 降级到 SearXNG 不得重新启动或取消 hot-discovery，也不得改变 hot-discovery 的 dimensions、tiers、limit
和超时参数。

### 11.2 指定 `requested-count`

保持当前自适应行为：

1. 先运行一次 `online-search`；
2. 对统一结果执行现有候选分类和主题相关性判断；
3. 合格文章数量达到请求数量时，hot-discovery 维持
   `skipped/sufficient_article_candidates`；
4. 数量不足时运行 hot-discovery；
5. 数量不足不能触发 SearXNG，因为 WSA 已经正常工作。

### 11.3 中文文章 profile

保持现有中文文章 profile 的首批并发、最少来源尝试数、确定性停止阈值、60 秒软预算和 90 秒硬上限。
其中原来的 SearXNG 任务替换为统一 `online-search` 任务。WSA 失败后启动 SearXNG 时必须使用剩余预算，
不得重新获得完整 90 秒。

## 12. 错误、安全与可观测性

### 12.1 错误分类

provider runner 将失败归一化为：

| 类型 | 示例 | 是否降级 |
|------|------|----------|
| `unavailable` | 未启用、凭据缺失、SDK 缺失 | 是 |
| `authentication` | `AuthFailure`、未授权 | 是 |
| `resource` | 未开通、资源不可用 | 是 |
| `rate-limit` | `RequestLimitExceeded` | 是 |
| `timeout` | 调用超过有效超时 | 是 |
| `network` | DNS、TLS、连接中断 | 是 |
| `provider` | 腾讯内部错误或 `Response.Error` | 是 |
| `invalid-response` | JSON 或 `Pages` 结构无效 | 是 |
| `empty-result` | 合法空 `Pages` | 否，属于成功 |

错误只保留稳定 code、分类、是否可重试和有限长度的脱敏 message。不得保存 SDK 请求对象、请求头、签名、
SecretId、SecretKey 或完整环境变量。

### 12.2 快照与来源追踪

统一 online-search snapshot 保存在当前会话 `.collection-inputs/` 下，并包含：

- query；
- 实际 provider；
- 是否降级；
- 归一化候选；
- provider diagnostics；
- WSA `RequestId` 和套餐版本；
- SearXNG 的既有 engine stats，仅当实际使用 SearXNG 时存在；
- 解析 warning；
- 阶段耗时。

WSA 和 SearXNG 返回同一 URL 的情况不会发生在同一次成功执行中，因为两者不是融合关系。若未来会话不同轮次
分别使用两者，仍由现有 normalized duplicate group 去重并保留每条来源记录。

### 12.3 性能指标

现有 `timing.searxngMs` 在兼容期表示整个 online-search 逻辑通道耗时。新增：

```json
{
  "onlineSearchMs": 3142,
  "tencentWsaMs": 1002,
  "searxngFallbackMs": 2140,
  "hotDiscoveryMs": 2011,
  "mergeAndClassifyMs": 18,
  "totalMs": 3174
}
```

当 WSA 成功时 `searxngFallbackMs=0`；当 WSA 未启用时 `tencentWsaMs=0`。所有时间均为实际墙钟时间，
并继续纳入公共采集最终性能摘要。

## 13. 测试设计

### 13.1 WSA 单元测试

- 正常解析 `Response.Pages` JSON 字符串数组；
- `content` 缺失时回退到 `passage`；
- 套餐可选字段缺失时仍成功；
- 混合合法与损坏的 Pages 时保留合法候选并输出 warning；
- 非空 Pages 全部损坏时返回 `invalid-response`；
- 空 Pages 返回成功且不触发 SearXNG；
- `Response.Error` 被归一化且不泄露凭据；
- URL 含用户名、密码或非 HTTP(S) 协议时被过滤；
- `Cnt` 取档和本地结果截断；
- Freshness 与 Industry 映射；
- SDK 超时能够中止等待并返回结构化错误。

### 13.2 Provider runner 单元测试

- WSA 成功时不调用 SearXNG；
- WSA 成功但结果为空时不调用 SearXNG；
- WSA 成功但结果少于 requested-count 时不调用 SearXNG；
- WSA 未启用、凭据缺失、鉴权失败、限流、超时和响应损坏时分别调用一次 SearXNG；
- WSA 与 SearXNG 都失败时保留两个脱敏诊断；
- 剩余硬预算不足时不启动 SearXNG；
- fallback 不改变 query、category、language、time-range 和最大结果数；
- 环境中的 SecretId、SecretKey 不出现在返回对象、异常或序列化 snapshot 中。

### 13.3 `public-discover` 回归测试

- 无 requested-count 时 online-search 和 hot-discovery 仍并行；
- requested-count 达标时 hot-discovery 仍按原原因跳过；
- requested-count 不足时 hot-discovery 仍启动；
- WSA 到 SearXNG 的内部降级不增加 discovery attempt；
- 中文文章 profile 继续遵守来源尝试数、软预算和硬上限；
- `candidateQuality`、`selectedCandidate` 和 discovery authorization 使用统一结果；
- 旧字段与新增 onlineSearch 别名内容一致；
- online-search 失败但 hot-discovery 成功时，整轮发现仍按现有规则成功；
- 两条逻辑通道均失败时，保持现有终止行为。

### 13.4 契约测试

- 搜索摘要不能直接交给 `collect`；
- WSA `pics` 不能成为交付 Markdown 的远程图片；
- 实际 provider 和 RequestId 可从会话快照追溯；
- 所有公开发现仍受两轮限制和主题锚点保护；
- WSA provider 不能绕过 `public-discover` 授权来源 URL。

## 14. 实施范围

预计实施仅涉及：

- 新增 online-search provider runner、WSA adapter 及相应测试；
- 把现有 SearXNG 构造和执行逻辑移动到独立 adapter，行为保持一致；
- `public-discovery.mjs` 改为调用统一 runner，并增加兼容字段和诊断；
- 更新 `public-discovery.test.mjs`；
- 更新 `references/online-search.md` 和 `references/online-search/SKILL.md` 的 provider 说明；
- 更新 `references/manifest.json` 中的描述；
- 在镜像构建依赖中加入锁定版本的腾讯云 Node.js SDK；
- 在非敏感环境变量示例或部署说明中增加 WSA 配置项。

本设计不需要数据库迁移，不修改 `deploy/middleware/initdb/`，也不运行迁移合并脚本。

## 15. 验收标准

1. WSA 启用且正常返回时，执行记录证明 SearXNG 未被调用。
2. WSA 通道级故障时，SearXNG 在同一 online-search 调用内执行且能返回候选。
3. WSA 合法空结果或候选不足时，SearXNG 未被调用，hot-discovery 行为与改造前一致。
4. `public-discover` 的两轮限制、主题相关性门禁、候选分类、授权和正文采集路径不变。
5. 现有调用方使用的 `searxng` 字段在兼容期仍可读取，并能通过新增字段识别实际 provider。
6. WSA 和 SearXNG 双失败时，错误中包含可操作的 provider 分类，但不包含任何凭据。
7. WSA 摘要、图片和子链不会被误当作已采集全文或交付资产。
8. 新增与既有 knowledge-collection 测试全部通过，镜像构建能离线使用已锁定的 SDK 依赖。
