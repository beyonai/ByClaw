---
name: document-object-split
version: 1.0.0
description: |
  根据数字员工当前挂载的 Ontology 对象类型（Bug、需求管理、产品、订单等），
  对文档内容进行结构化拆分：先从 openclaw 资源列表筛出 OBJECT 类型，再经
  get_object_detail.py 从 Redis 读取各类型的 schema（object_name、properties），
  据此对文档分类并抽取独立实例——每个可拆分实例在对应 page_prefix 下形成
  一个独立 gbrain page（N 实例 = N page）；page 字段结构由 Redis properties 定义，
  字段取值结合文档内容适当抽取填写。完成后输出 page 清单并询问是否导出。
  再次拆分时按 external_id 匹配已有 page 更新。
triggers:
  - "document object split"
  - "文档对象拆分"
  - "文档内容拆分"
  - "按对象拆分文档"
  - "拆分需求对象"
  - "拆分业务对象"
  - "数字员工对象拆分"
  - "从文档提取对象"
  - "extract requirements and bugs"
  - "split requirements from"
  - "split bugs from"
  - "从会议提需求"
  - "从文档拆需求"
  - "拆 bug"
  - "拆需求"
  - "PRD 提需求"
  - "导入 PRD 并拆需求"
  - "meeting requirements bugs"
tools:
  - search
  - query
  - get_page
  - put_page
  - add_link
  - add_timeline_entry
  - file_upload
  - get_links
  - get_backlinks
  - traverse_graph
mutating: true
writes_pages: true
writes_to:
  - sources/
  - meetings/
  - "{page_prefix}/"   # 动态：requirements/, bugs/, products/, orders/, 及接口声明的任何顶层目录
---

# Document Object Split — 按对象类型拆分文档，每实例一页

**核心流程：** 当前对象类型定义「能拆什么」→ 文档提供「拆什么内容」→ brain 落地「拆成多少页」。

```text
openclaw 资源列表（OBJECT）→ Redis 对象 schema → object_types[]
  → 按 object_name 对文档分类（Bug / 需求 / 产品 / …）
  → 每类抽出原子实例
  → 每个实例 → 一个独立 page（slug = {page_prefix}/{kebab-slug}）
```

1. **加载对象类型** — openclaw 筛 `resourceBizType: OBJECT` → 对每个 `resourceId` 调 `get_object_detail.py` 读 Redis，得到 Bug、需求管理、产品等类型的 schema
2. **读文档** — 会议记录、PRD、PDF、Word、已 import 的 markdown → 建 hub 页
3. **按类型拆分** — 仅处理 `object_types[]` 中有的类型；用各类型的 `object_name` / `object_desc` / `properties` 分类并抽取
4. **每实例一页** — 一条 Bug、一条需求、一条产品记录各建 **独立** page，禁止合并
5. **写入 brain** — slug = `{page_prefix}/{kebab-slug}`（类型不同目录不同）
6. **更新已有页** — `external_id` 或确定性 slug 匹配 upsert
7. **输出清单** — 列出 touched page，询问是否导出

> **Run manifest：** 从 Phase 2 起维护内存清单 `run_manifest.pages[]`，每写/更新一页追加一条
> `{ slug, action: created|updated, object_code, external_id, title }`。Phase 7 报告与 Phase 8 导出
> 均读取此清单，禁止凭记忆遗漏 page。

> **Filing rule:** Read `skills/_brain-filing-rules.md` before creating any new page.

> **Iron rule:** **N 个对象实例 → N 个 page**。文档里 3 条 Bug + 5 条需求 → **8 个独立 page**（3 在 `bugs/`，5 在 `requirements/`）。禁止把多条实例合并进同一 page 或做成列表页。

> **Type-driven rule:** 拆分粒度与目录 **完全由 `get_object_detail.py` 返回的对象类型驱动**。返回几种类型（Bug、需求管理、产品、订单…），就对文档做几种分类；**只建返回类型范围内的实例页**，不得凭空新增未在 `object_types[]` 中的类型。

> **Update rule:** 再次拆分时 **必须先匹配已有 page**（`external_id` → 确定性 slug → search），
> 命中则 **更新**，未命中才 **新建**。

> **Slug 目录规则（所有对象类型通用）：** 每种 `object_type` **独占一个顶层目录前缀**，
> slug 一律 `{page_prefix}/{stable-kebab-slug}`。各 Ontology 对象类型（来自 `get_object_detail.py`）
> **任何其他类型** 都遵守同一套规则，仅 `page_prefix` 不同。
>
> | 对象类型 | page_prefix | slug 示例 |
> |----------|-------------|-----------|
> | 需求管理对象 | `requirements` | `requirements/baiying-ai-skill-dispatch` |
> | Bug 管理对象 | `bugs` | `bugs/baiying-ai-search-miss` |
> | 产品对象 | `products` | `products/baiying-ai-pro-edition` |
> | 订单对象 | `orders` | `orders/baiying-ai-order-20260603` |
> | *接口新增类型* | 接口 `page_prefix` | `{page_prefix}/baiying-ai-{语义-kebab}` |
>
> **禁止** `objects/requirements/…` 等嵌套前缀；接口若返回 `objects/{prefix}`，写入前
> **剥掉 `objects/`** 层。接口新增类型时 **`page_prefix` 必填**（复数、kebab-case，
> 如 `customers`、`contracts`）。

---

## 0. 对象类型来源与拆分原则

### 0.0 按返回类型拆分（总纲）

本 skill 的拆分 **不以固定「需求/Bug」硬编码为准**，而以 **当前数字员工挂载、且 Redis 能读到的对象类型** 为准。典型一次 run 可能同时包含：

| `object_name`（脚本返回） | 文档中识别信号 | `page_prefix` | 拆分结果 |
|---------------------------|----------------|---------------|----------|
| Bug / Bug 管理对象 | 缺陷、报错、复现、crash | `bugs/` | 每条缺陷 → `bugs/{slug}` |
| 需求管理对象 / 需求 | 必须、需要、功能、shall | `requirements/` | 每条需求 → `requirements/{slug}` |
| 产品对象 | 产品、SKU、版本、套餐 | `products/` | 每个产品 → `products/{slug}` |
| 订单对象 | 订单、下单、合同号 | `orders/` | 每笔订单 → `orders/{slug}` |
| *其他 OBJECT 类型* | `object_desc` + `property_name` | `page_prefix_map` 配置 | 每实例 → `{prefix}/{slug}` |

**同一篇文档可拆出多种类型、多个 page：**

```text
PRD 含 5 条需求 + 2 条 Bug + 1 个产品定义
  → requirements/* × 5
  → bugs/* × 2
  → products/* × 1
  = 8 个对象 page + 1 个 hub page
```

每种类型在 hub 上各有独立 Index 节（`## 需求管理对象 Index`、`## Bug 管理对象 Index`…），每节下列出该类型的全部实例 page 链接。

---

## 0.1 对象 schema：`get_object_detail.py`

对象类型的 **名称、字段 schema、文档分类依据** 一律来自脚本
`skills/document-object-split/scripts/get_object_detail.py`（**Redis 直读，不调 HTTP 详情接口**）。**禁止** 手写字段列表或凭空猜测对象结构。

**数据链路：**

```text
1. openclaw 数字员工资源列表 → 筛选 resourceBizType == OBJECT → 得到 resourceId[]
2. 对每个 resourceId：get_object_detail.py {"resource_id":"..."} → Redis GET OBJECT_{id}
3. 合并为 object_types[]（Bug、需求、产品…）→ 驱动 Phase 3 分类与建页
```

### 0a. 获取 `resource_id` 列表（openclaw）

从 openclaw 读取当前数字员工资源列表，筛选 `resourceBizType: OBJECT`，收集 `resourceId`。
（资源列表获取方式由运行环境提供；脚本层只负责用 `resource_id` 读 Redis。）

配置或用户消息可提供 `resource_ids[]` 子集；未提供时用 openclaw 返回的全部 OBJECT 资源。

### 0b. 调用脚本（按 resource_id 读 Redis）

```bash
# 单个类型 schema
echo '{"resource_id":"10042459"}' \
  | python skills/document-object-split/scripts/get_object_detail.py

# 批量（推荐 Phase 1：一次加载全部类型）
echo '{"resource_ids":["10042459","10042460","10042461"]}' \
  | python skills/document-object-split/scripts/get_object_detail.py

# 或直接传 Redis key
echo '{"key":"OBJECT_10042459"}' \
  | python skills/document-object-split/scripts/get_object_detail.py
```

| stdin 字段 | 必填 | 说明 |
|------------|------|------|
| `resource_id` | 否* | 自动拼 key `OBJECT_{resource_id}` |
| `key` | 否* | 完整 Redis key |
| `resource_ids` / `keys` | 否* | 批量加载多种对象类型 |

\* 四者至少提供一个。

**环境变量：** `REDIS_*` 或 `DATACLOUD_GATEWAY_REDIS_*`（经 `_common.py` 连接 Redis）。

**批量 stdout 示例（驱动拆分）：**

```json
{
  "ok": true,
  "object_codes": [
    "p_bug_0027024630_5406b7",
    "p_requirement_0027024630_abc",
    "p_product_0027024630_xyz"
  ],
  "objects": [
    {
      "ok": true,
      "resource_id": "10042459",
      "object_code": "p_bug_0027024630_5406b7",
      "object_name": "Bug",
      "object_desc": "…",
      "properties": [
        {"property_code": "title", "property_name": "任务标题", "data_type": "STRING"}
      ],
      "fields": ["handler", "deadline", "title"]
    },
    {
      "resource_id": "10042460",
      "object_code": "p_requirement_0027024630_abc",
      "object_name": "需求管理对象",
      "fields": ["title", "priority", "description"]
    },
    {
      "resource_id": "10042461",
      "object_code": "p_product_0027024630_xyz",
      "object_name": "产品对象",
      "fields": ["title", "sku", "version"]
    }
  ]
}
```

上例 → `object_types[]` 含 3 种类型 → Phase 3 对同一 hub 分别拆 Bug、需求、产品，**每实例各建一页**。

`ok: false` 时中止拆分，向用户报告 `error`。

### 0c. 将脚本输出映射为 `object_types[]`（内存结构）

对每个成功的 `get_object_detail` 响应，合并为 skill 内部使用的 `object_types[]` 条目：

| 内部字段 | 来源 |
|----------|------|
| `object_code` | 脚本 `object_code` |
| `display_name` | 脚本 `object_name` |
| `object_desc` | 脚本 `object_desc`（分类 + 抽取约束） |
| `page_prefix` | 配置 `page_prefix_map[object_code]`（见 0d）；必填 |
| `fields` | 脚本 `fields`（= 各 `property_code`） |
| `properties` | 脚本 `properties`（完整 schema） |
| `business_key_field` | `properties` 中 `business_key: true` 的 `property_code`；无则留空 |
| `match_hints` | 自动生成：`object_name` + `object_desc` 关键词 + 各 `property_name` |

**文档分类规则：** 对 hub 全文，**按 `object_types[]` 中每一种类型分别扫描**——用该类型的 `object_name`、`object_desc`、`match_hints` 定位属于该 `object_code` 的段落；**只处理已加载的类型**。文档里出现但未在 `object_types[]` 中的内容 → 仅保留在 hub 摘要，**不建对象页**。

**实例 → page 规则（核心）：**

```text
FOR EACH type IN object_types[]:
  instances = extract_atomic_instances(hub, type)   # 原子实例，不可合并
  FOR EACH instance IN instances:
    slug = {type.page_prefix}/{stable_kebab_slug}
    put_page(slug, instance_fields_from type.properties)
    run_manifest.pages.append({ slug, object_code, title, ... })
```

- 同一类型多条实例 → 多个 slug，**共享同一 `page_prefix`**
- 不同类型实例 → **不同 `page_prefix` 目录**（需求不进 `bugs/`）
- 每次 `put_page` **只写一个实例**

**实例字段填充：** page 内容 = **Redis 对象 schema（结构）** + **文档抽取（取值）**，二者结合、适当设置：

| 来源 | 决定什么 | 规则 |
|------|----------|------|
| Redis `properties[]` | page **有哪些字段**、frontmatter 键名、Properties 表行 | 只使用 schema 中声明的 `property_code`；**禁止** 自造 schema 外字段 |
| Redis `property_name` / `data_type` | 如何从文档中 **识别并映射** 取值 | 用中文/英文标签在原文中定位对应信息；`DATE` 规范为日期，`STRING` 保留原文要点 |
| Redis `is_name: true` | page **标题**（`title` + H1） | 优先取文档中该实例的名称行 |
| Redis `is_required: true` | 必填校验 | 文档无对应信息 → 填 `[待补充]`，不得留空 |
| Redis `business_key: true` | `external_id` / upsert 键 | 从文档提取稳定业务编号；无则用语义 slug |
| 文档 `source_quote` | **Source** 区块 | 保留该实例在原文中的关键摘录（非整篇文档） |
| 文档正文片段 | **Description / 长文本 property** | 可适度归纳，但须忠于 `source_quote`，不臆造 |

**适当设置（禁止过度）：**

- ✅ 文档写了「处理人：张三」→ `handler: 张三`（property_code 来自 Redis）
- ✅ 文档一段需求描述 → 填入 `description` 或等价 property，并可写简短 **## 摘要** 段落
- ✅ 文档未写截止时间 → `deadline: [待补充]`（`is_required` 时）
- ❌ 把整篇 PRD 粘贴进每个对象 page
- ❌ 文档没提的字段填「无」或猜测值（应用 `[待补充]` 或省略非必填项）
- ❌ 在 page 中增加 Redis `properties` 未声明的自定义列

**Page 内容三层（每个实例 page）：**

```text
1. frontmatter — 元数据 + 各 property_code 取值（文档能提取的写入，必填缺失标 [待补充]）
2. 正文 —
     H1 = title（来自 is_name 或 title 类 property）
     ## Properties — 表格：Field=property_name / property_code，Value=文档抽取值
     ## 描述 — 可选；长文本 property 或文档段落的适度整理（非全文复制）
     ## Source — source_quote + 回链 hub
3. compiled_truth — 以 Properties + 描述 为主干的当前最佳理解（更新时重写，不追加堆叠）
```

### 0d. `page_prefix` 配置（slug 目录）

脚本 **不返回** `page_prefix`；在 `~/.gbrain/document-object-split.json` 中声明：

```json
{
  "resource_ids": ["10042459", "10042460", "10042461"],
  "page_prefix_map": {
    "p_requirement_0027011322_abc": "requirements",
    "p_bug_0027011322_def": "bugs",
    "p_product_0027011322_xyz": "products"
  }
}
```

`page_prefix_map` 的 key 为脚本返回的 `object_code`；value 为该类型实例 page 的顶层目录。


常见映射示例：

| object_name（来自脚本） | 建议 page_prefix |
|-------------------------|------------------|
| 需求管理对象 / 需求 | `requirements` |
| Bug 管理对象 / 缺陷 | `bugs` |
| 产品对象 | `products` |
| 订单对象 | `orders` |
| 学术论文 | `papers`（或业务自定义） |

**禁止** `objects/{prefix}/…` 嵌套；写入前剥掉 `objects/` 层。

### 0e. 完整加载流程（Phase 1 实现）

```text
1. openclaw 资源列表 → 筛 OBJECT → resource_ids[]
2. echo '{"resource_ids":[...]}' | python .../get_object_detail.py
3. 校验 ok=true 且 objects[] 非空
4. 合并 page_prefix_map → object_types[]（每种类型含 display_name、properties、page_prefix）
5. 缓存到本次 run（hub 写 object_codes_snapshot + object_names_snapshot）
6. Phase 3 按 object_types[] 逐类型拆分，每实例独立建页
```

### Slug 命名规范（全类型统一）

```
slug = {page_prefix}/{stable_kebab_slug}
```

| 步骤 | 规则 | 适用 |
|------|------|------|
| 目录 | 接口 `page_prefix`，顶层、复数、kebab-case | 全部类型 |
| 后半段 | 优先 `{project-kebab}-{title-kebab}` | 全部类型 |
| 备选 | 业务编号 kebab-case（`ORD-2026-001` → `ord-2026-001`） | 全部类型 |
| 兜底 | `{external_id_prefix}-{hash8}` | 全部类型 |

**同项目多类型示例（百应 AI）：**

```
requirements/baiying-ai-skill-dispatch    # 需求
bugs/baiying-ai-search-miss               # Bug
products/baiying-ai-enterprise-pack       # 产品
orders/baiying-ai-trial-order-001         # 订单
customers/baiying-ai-acme-corp            # page_prefix 来自 page_prefix_map
```

---

## Contract

This skill guarantees:

- **Phase 0:** openclaw 筛 OBJECT → `get_object_detail.py` 批量读 Redis → 构建 `object_types[]`
- **Phase 1:** 源文档入 brain（hub 页 `sources/…` 或 `meetings/…`）
- **Phase 2:** 按 `object_types[]` **逐类型**对文档分类，**每类型内**独立抽取原子实例
- **Phase 3:** **每个实例一个 page**（Bug→`bugs/`，需求→`requirements/`，产品→`products/`，…）
- **Phase 4:** 更新时按 `business_key_field` / `external_id` / slug 匹配 → `put_page` 更新
- **Phase 5:** hub 页维护 `{display_name} Index` 链接；hub slug 写入 `run_manifest`
- **Phase 6:** 可选回写业务系统 API
- **Phase 7:** 输出完整 page 清单（created / updated / skipped）；**询问用户是否导出**
- **Phase 8:** 用户确认后，导出每个 page 为独立 md + 导出关系图到当前工作空间

---

## Phases

### Phase 1: 加载对象类型（必须先做）

```bash
# 1) 从 openclaw 拿到 OBJECT 资源的 resource_ids[]（运行环境提供）
# 2) 批量读 Redis schema
echo '{"resource_ids":["10042459","10042460","10042461"]}' \
  | python skills/document-object-split/scripts/get_object_detail.py > /tmp/object_types.json
```

校验：

- 响应 `ok === true` 且 `objects[]` 非空
- 每个 `object_code` 在 `page_prefix_map` 中有对应 `page_prefix`
- `object_types[]` 非空（至少一种可拆分类型）

将 `object_types[]` 缓存到本次 run。后续 **所有拆分范围以该数组为界**——返回几种类型就拆几种，每种类型的每个实例各建一页。

### Phase 2: 准备源文档 hub

| 输入 | 动作 |
|------|------|
| 已有 brain slug | `gbrain get <slug>` |
| PDF / DOC / DOCX | 抽文本 → `upload-raw` → `put_page` → `sources/{basename-kebab}` |
| 原始会议/粘贴文本 | `put_page` → `sources/…` 或 `meetings/…` |

Hub frontmatter 至少：

```yaml
---
title: "{文档标题}"
type: source
source_kind: document-object-split
employee_id: de-001
object_codes_snapshot:
  - p_requirement_0027011322_abc
  - p_bug_0027011322_def
object_names_snapshot:
  - Bug
  - 需求管理对象
  - 产品对象
tags: ['doc-split-source']
---
```

Hub 预留 **每种已加载类型** 的 Index 节（Phase 6 回填），标题 = `display_name`（脚本 `object_name`）：

```markdown
## 需求管理对象 Index
## Bug 管理对象 Index
## 产品对象 Index
```

**禁止** `gbrain capture --file *.pdf`（二进制 guard）。

### Phase 3: 按对象类型分类并抽取实例（核心 — 每实例一页）

**外层循环：类型；内层循环：实例。** 对 `object_types[]` 中 **每一种** 类型（Bug、需求、产品…）分别执行：

1. **分类** — 用该类型的 `object_name`、`object_desc`、`match_hints` 在 hub 全文中圈定属于此 `object_code` 的段落/章节
2. **抽取原子实例** — 在该类型范围内识别 **可独立成页** 的一条记录（一条 Bug、一条需求、一个 SKU…）
3. **一实例一页** — 每抽出一条 → 立即生成 slug → `put_page`（禁止攒批后合并写入）
4. **填字段 & 组装 page 内容** — **结构跟 Redis schema，取值跟文档**：
   - 遍历该类型 `properties[]`，逐项从实例对应文档片段中抽取或归纳
   - `property_code` → frontmatter 键 + Properties 表行
   - `property_name` → 表格 Field 列展示名（便于人读）
   - 文档有则写实；文档无且 `is_required` → `[待补充]`；非必填可省略
   - 正文只保留 **该实例** 相关内容 + `source_quote`，禁止粘贴整篇源文档

| 字段 | 来源 | 说明 |
|------|------|------|
| `object_code` | Redis | Ontology 对象编码 |
| `display_name` | Redis `object_name` | 类型标签 |
| `business_key` / `external_id` | 文档 + Redis `business_key_field` | 稳定业务键 |
| `title` | 文档 + Redis | `is_name: true` 的 property 优先；否则 title 类 property 或首行摘要 |
| `source_quote` | 文档 | 该实例原文摘录 |
| `source_section` | 文档 | 章节/页码 |
| `{property_code}` | **文档 → Redis schema** | 按 `property_name`/`data_type` 映射抽取 |

**Bug 对象示例**（`object_name: Bug`，`page_prefix: bugs`）：

```yaml
object_code: p_bug_0027024630_5406b7
display_name: Bug
business_key: BUG-042
title: 检索结果未命中
slug: bugs/search-result-miss
handler: alice-example
deadline: 2026-06-15
source_quote: "3.4 检索模块：部分 query 返回空…"
```

**需求对象示例**（`object_name: 需求管理对象`，`page_prefix: requirements`）：

```yaml
object_code: p_requirement_0027011322_abc
display_name: 需求管理对象
business_key: REQ-001
title: 百应 AI Skill 分发能力
slug: requirements/baiying-ai-skill-dispatch
priority: P1
source_quote: "3.2 Skill 模块：须支持按意图分发…"
```

**产品对象示例**（`object_name: 产品对象`，`page_prefix: products`）：

```yaml
object_code: p_product_0027011322_xyz
display_name: 产品对象
title: 百应 AI 企业版
slug: products/baiying-ai-enterprise-pack
sku: BY-AI-ENT-2026
source_quote: "企业版包含 SSO、审计日志…"
```

**计数校验（必须满足）：**

| 文档内容 | 应建 page 数 |
|----------|-------------|
| 5 条独立需求 | 5 × `requirements/{slug}` |
| 2 条独立 Bug | 2 × `bugs/{slug}` |
| 1 个产品定义 | 1 × `products/{slug}` |
| 合计 | **8 个对象 page**（外加 1 hub） |

不得将多条实例写入同一 page，不得做「需求列表页」代替多页。

### Phase 4: 匹配已有 page（更新 vs 新建）

对每个实例，**按顺序**查找已有 page：

```text
1. business_key / external_id 精确匹配（同 source_id 下 search/list）
   gbrain search "external_id:{business_key}" 或 get_page({page_prefix}/{slug})

2. 确定性 slug：
   slug = {page_prefix}/{stable_kebab_slug}
   gbrain get {slug}

3. 语义 dedup（仅当 1–2 未命中）：
   gbrain search "{title keywords}"
   gbrain query "{description}" --limit 5
   强匹配 → 视为同一对象，沿用其 slug 更新
```

**Slug 生成规则（`stable_kebab_slug`）：**

| 优先级 | 规则 | 示例 |
|--------|------|------|
| 1 | 文档或接口已有稳定业务键 → kebab-case | `REQ-001` → `req-001`；或直接用语义 slug |
| 2 | `{project-kebab}-{title-kebab}`（推荐，可读） | `baiying-ai-skill-dispatch` |
| 3 | 无 business_key → `{object_code_kebab}-{hash8}` | `p-req-a1b2c3d4` |

`page_prefix` 来自 `page_prefix_map[object_code]`（Phase 1 已校验）。

| 结果 | 动作 |
|------|------|
| 找到已有 page | **UPDATE**：`put_page` 同 slug，刷新 compiled_truth + frontmatter；timeline 追加「来源文档修订」 |
| 未找到 | **CREATE**：新 slug，`put_page` |

**Stable key 规则（写入 frontmatter，供下次匹配）：**

```yaml
external_id: REQ-001          # = business_key 值
object_code: p_requirement_0027011322_abc
object_type_label: 需求管理对象   # = display_name / object_name
employee_id: de-001
source_document: sources/prd-v2
source_quote: "…"
```

slug 格式（**所有 object_type 同一模板**）：

```
{page_prefix}/{stable_kebab_slug}

# 内置四种
requirements/baiying-ai-skill-dispatch
bugs/baiying-ai-search-miss
products/baiying-ai-enterprise-pack
orders/baiying-ai-trial-order-001

# 接口扩展（page_prefix 由接口声明）
customers/baiying-ai-acme-corp
contracts/baiying-ai-sla-2026
```

### Phase 5: 写入对象 page（每实例一页 — schema + 文档）

> **内容原则：** page 的 **字段清单** 由 Redis `properties[]` 决定；**字段取值** 从文档该实例片段抽取；二者结合后写入 frontmatter、Properties 表与正文。

**需求管理对象 page 模板**（`properties` 来自 Redis，值来自文档）：

```markdown
---
title: "百应 AI Skill 分发能力"          # 文档抽取；对齐 is_name/title property
type: note
object_code: p_requirement_0027011322_abc
object_type_label: 需求管理对象          # Redis object_name
external_id: REQ-001                     # 文档 business_key
employee_id: de-001
source_document: sources/prd-v2
source_section: "3.2 Skill 模块"
# ↓ 以下键名 = Redis properties[].property_code，值 = 文档适当抽取
title: 百应 AI Skill 分发能力
priority: P1
description: 须支持按意图将用户请求分发至对应 Skill…
status: proposed                         # 文档无则 [待补充] 或合理默认
tags: ['object-split']
---

# 百应 AI Skill 分发能力

**Object Code:** p_requirement_0027011322_abc
**External ID:** REQ-001
**Slug:** requirements/baiying-ai-skill-dispatch
**类型:** 需求管理对象

## Properties

> 表格 **动态生成**：行数 = 该类型 Redis `properties[]` 长度；Field 用 `property_name`，Value 用文档抽取值。

| Field | Value |
|-------|-------|
| 任务标题 (title) | 百应 AI Skill 分发能力 |
| 优先级 (priority) | P1 |
| 描述 (description) | 须支持按意图分发… |

## 描述

{对该实例文档片段的适度整理 — 可覆盖长文本 property，须与 source_quote 一致}

## Source

> {source_quote — 仅该实例在源文档中的摘录}

From [{hub title}](sources/prd-v2).

## See Also

- [Source document](sources/prd-v2)
```

**Bug page 示例**（Redis 返回 `handler`、`deadline`、`title` 时）：

| Field (property_name) | Value（文档抽取） |
|---------------------|-----------------|
| 任务标题 (title) | 检索结果未命中 |
| 处理人 (handler) | alice-example |
| 截止时间 (deadline) | 2026-06-15 |

Bug / 产品 / 其他类型 **结构相同**：Properties 表 **严格按该类型 Redis `properties[]` 生成**；正文描述取自文档对应段落，适当归纳，不臆造。

每次 `put_page` **只写一个对象**；批量 N 条则调用 N 次。

### Phase 6: 更新 hub Index + 可选回写业务系统

Hub 页每个对象类型一节，**链接到全部实例 page**：

```markdown
## 需求管理对象 Index

- [百应 AI Skill 分发](requirements/baiying-ai-skill-dispatch)
- [导出 CSV 列配置](requirements/export-csv-columns)

## Bug 管理对象 Index

- [百应 AI 检索未命中](bugs/baiying-ai-search-miss)

## 产品对象 Index

- [百应 AI 企业版](products/baiying-ai-enterprise-pack)

## 订单对象 Index

- [百应 AI 试用订单 #001](orders/baiying-ai-trial-order-001)
```

`put_page` 更新 hub。

若用户接口提供 **回写/同步** endpoint（可选 Phase 7），在 brain page 创建成功后 POST：

```json
{
  "external_id": "REQ-001",
  "brain_slug": "requirements/baiying-ai-skill-dispatch",
  "source_document": "sources/prd-v2"
}
```

无回写接口则跳过。

### Phase 7: 导入报告 + 询问是否导出

拆分完成后，**必须先输出完整 page 清单**，再 **停止并询问用户**（见 `skills/ask-user/SKILL.md`）。

**7a. 结构化报告（stdout / 对话）**

```text
Document object split complete:
  source hub:       sources/prd-v2
  employee_id:      de-001

  Summary:
    requirement:    5 created, 2 updated, 0 skipped
    bug:            1 created, 0 updated, 0 skipped
    product:        0 created, 0 updated, 1 skipped (no instances in doc)
    order:          2 created, 1 updated, 0 skipped

  Pages imported/updated (12):
    [created]  sources/prd-v2                          源文档 hub
    [created]  requirements/baiying-ai-skill-dispatch  REQ-001  百应 AI Skill 分发
    [created]  requirements/export-csv-columns          REQ-002  导出 CSV 列配置
    [updated]  bugs/baiying-ai-search-miss             BUG-042  百应 AI 检索未命中
    …
```

规则：

- **逐条列出** `run_manifest.pages[]` 中每个 slug，标注 `[created]` / `[updated]`
- 对象页附带 `external_id` + `title`；hub 页标注「源文档 hub」
- 按 `page_prefix` 分组或表格展示均可，但 **不得省略任何 touched slug**

**7b. 询问用户是否导出（必须停 turn）**

```
📦 本次共写入/更新 N 个 page（见上方清单）。

是否将这些 page 导出到当前工作空间？
- 每个 page 一个 `{slug}.md` 文件（slug 与 brain 一致，保留 `/` 目录层级）
- 同时导出 page 之间的关系（hub ↔ 对象页、对象页 ↔ 源文档等）

1. **导出** — 导出全部 touched page + 关系文件
2. **仅导出对象页** — 不含 sources/meetings hub
3. **跳过** — 不导出，拆分结束
```

**禁止** 在用户回复前自动导出。用户说「导出」「是的」「1」等 → 进入 Phase 8。

### Phase 8: 导出到当前会话工作空间

用户确认导出后，写入 **当前 Agent 工作目录**（Cursor 会话 workspace / `$PWD`），
**不要** 写到 `~/.gbrain` 或 brain repo 根目录。

**8a. 输出目录**

```bash
EXPORT_ROOT="${GBRAIN_DOC_SPLIT_EXPORT_DIR:-$PWD}/gbrain-doc-split-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$EXPORT_ROOT"
```

`GBRAIN_DOC_SPLIT_EXPORT_DIR` 可选；未设置时用当前工作空间。

**8b. 一 page 一 md（命名：`{slug}.md`）**

> **Iron rule：** 导出文件名 **必须** 为 `{slug}.md`，slug 与 brain 中完全一致，**禁止**
> 改用 title、external_id 或自定义文件名。

| brain slug | 导出文件路径（相对 `EXPORT_ROOT`） |
|------------|-----------------------------------|
| `sources/prd-v2` | `sources/prd-v2.md` |
| `requirements/baiying-ai-skill-dispatch` | `requirements/baiying-ai-skill-dispatch.md` |
| `bugs/baiying-ai-search-miss` | `bugs/baiying-ai-search-miss.md` |

对 `run_manifest.pages[]` 中每个 slug（或用户选了「仅对象页」则跳过 `sources/`、`meetings/`）：

```bash
SLUG="requirements/baiying-ai-skill-dispatch"
mkdir -p "$(dirname "$EXPORT_ROOT/$SLUG.md")"
gbrain get "$SLUG" > "$EXPORT_ROOT/$SLUG.md"
```

- 完整路径：`{EXPORT_ROOT}/{slug}.md`（slug 含 `/` 时保留目录层级）
- 使用 `gbrain get` 输出完整 markdown（frontmatter + body + timeline）
- MCP 环境用 `get_page` 写入同一路径 `{EXPORT_ROOT}/{slug}.md`

**8c. 导出关系**

在导出 slug 集合内收集 **出链 + 入链**（含 markdown wikilink、frontmatter、`add_link` 写入的边）：

```bash
# 对每个已导出 slug（CLI 示例；Agent 可用 get_links / get_backlinks / traverse_graph）
gbrain graph-query "$SLUG" --depth 1 --direction both
```

过滤规则：只保留 **from_slug 与 to_slug 均在本次导出集合内** 的边（hub 若已导出则保留 hub↔对象边）。

写入两个文件：

**`$EXPORT_ROOT/_relationships.json`**

```json
{
  "exported_at": "2026-06-03T14:30:00+08:00",
  "source_hub": "sources/prd-v2",
  "pages": ["sources/prd-v2", "requirements/baiying-ai-skill-dispatch", "bugs/baiying-ai-search-miss"],
  "edges": [
    {
      "from_slug": "sources/prd-v2",
      "to_slug": "requirements/baiying-ai-skill-dispatch",
      "link_type": "documents",
      "context": "REQ-001 from PRD section 3.2"
    },
    {
      "from_slug": "requirements/baiying-ai-skill-dispatch",
      "to_slug": "sources/prd-v2",
      "link_type": "",
      "context": "See Also"
    }
  ]
}
```

**`$EXPORT_ROOT/_relationships.md`**（人类可读）

```markdown
# Page Relationships

| From | To | Type | Context |
|------|-----|------|---------|
| sources/prd-v2 | requirements/baiying-ai-skill-dispatch | documents | REQ-001 |
| requirements/baiying-ai-skill-dispatch | sources/prd-v2 | (wikilink) | See Also |
```

**8d. 导出 manifest**

**`$EXPORT_ROOT/_manifest.json`** — 复制/序列化 `run_manifest`（含 action、object_type、external_id、title），
供下游脚本或二次导入使用。

**8e. 完成提示**

```text
Export complete:
  directory:  ./gbrain-doc-split-20260603-143000/
  pages:      12 markdown files
  relations:  _relationships.json, _relationships.md
  manifest:   _manifest.json

  requirements/baiying-ai-skill-dispatch.md   # = {slug}.md
  bugs/baiying-ai-search-miss.md              # = {slug}.md
  …
```

### Phase 9: Report（拆分-only 路径）

用户选择「跳过」导出时，Phase 7 报告即为终态。用户验证 brain 内数据：

```bash
gbrain get requirements/baiying-ai-skill-dispatch
gbrain get bugs/baiying-ai-search-miss
gbrain get products/baiying-ai-enterprise-pack
gbrain list --slug-prefix requirements/
gbrain list --slug-prefix bugs/
gbrain list --slug-prefix products/    # 任意 page_prefix 同理
gbrain search "external_id REQ-001"
```

---

## Anti-Patterns

- **多条实例塞进一个 page**（违反 N 实例 = N page；含「需求列表页」「Bug 汇总页」）
- 未在 `object_types[]` 中的类型仍建 page（如 Redis 未返回产品类型却建 `products/` 页）
- 把需求实例写入 `bugs/` 或反之（类型与 `page_prefix` 必须对齐脚本返回的 `object_code`）
- `page_prefix_map` 缺少某 object_code 仍继续拆分
- 跳过 `get_object_detail.py`，手写 object_types / fields
- 跳过 business_key / slug 匹配，重复拆分产生 duplicate page
- 把不同对象类型写进同一目录（如需求进 `bugs/` 或统一 `objects/`）
- 使用 `objects/requirements/…` 嵌套路径（应直接用 `requirements/…`）
- PDF 二进制走 `gbrain capture`
- 把整篇 PDF/PRD 原文 paste 进每个对象 page（只保留该实例内容 + `source_quote`）
- 填写 Redis `properties` 未声明的字段，或对文档未提及的非必填项臆造具体值
- Properties 表行数/键名与 Redis schema 不一致（必须一一对应 `property_code`）
- 拆分完成后不列出 touched page 清单
- 不询问用户、自动导出到工作空间（须 Phase 7 确认）
- 导出时不用 `{slug}.md` 命名（如改用 title.md、REQ-001.md）
- 导出时合并多个 page 到一个 md
- 导出关系时包含本次未导出的 foreign page（应过滤）
- 导出目录写到 brain repo / `~/.gbrain`（应写当前会话 workspace）
- 更新时改 slug（破坏匹配链；只改 compiled_truth / frontmatter 字段）

---

## Output Format

| 阶段 | 输出 |
|------|------|
| Phase 7 | 完整 page 清单 + 用户导出确认门 |
| Phase 8（用户确认） | `{workspace}/gbrain-doc-split-{ts}/` 下每个 page 为 `{slug}.md` + `_manifest.json` + `_relationships.json` + `_relationships.md` |
| Phase 9 | brain 内验证命令 |

---

## Tools Used

| Tool | 用途 |
|------|------|
| `get_object_detail.py` | **Phase 1 必调** — 按 `resource_id` 从 Redis 读各对象类型 schema |
| `get_page` | 加载 hub / 匹配已有对象页 |
| `get_page` / `gbrain get` | 导出单页 markdown |
| `get_links` / `get_backlinks` / `traverse_graph` / `gbrain graph-query` | 收集导出集合内的关系边 |
| `search` / `query` | external_id 与语义 dedup |
| `put_page` | 每个对象实例一次；更新 hub Index |
| `file_upload` / `upload-raw` | PDF/DOC 原件 |
| `add_link` / `add_timeline_entry` | 可选 graph 补边 |

---

## Chaining

| 场景 | 做法 |
|------|------|
| 会议 + 参会人 enrich | `meeting-ingestion` → 本 skill（hub = meetings/…） |
| 仅 PDF PRD | 本 skill Phase 2 抽文本 + 全流程 |
| 已 `gbrain import` 的 md | 本 skill 从 Phase 3 开始，hub = import slug |
