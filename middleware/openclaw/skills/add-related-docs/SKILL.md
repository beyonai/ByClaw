---
name: add-related-docs
version: 1.5.3
description: |
  按三步完成：①提取当前文档要点、关键字，以及正文 wiki-link /「归属|包含|实现|对应|佐证」等关系线索；
  ②在当前数字员工关联知识库中检索可关联文档（正文写了归属/包含等且能搜到目标介绍文档时，当前文档即对这些命中文档声明对应关系；
  多库让用户选择，单库默认选中；调用 by-knowledge-manager 的 search-file / read-file）；
  ③按指定关系与格式为当前文档添加 related_docs（必含 kb_resource_id、target_doc_id、relation）。
  若知识库未搜到对应关联文档，不得添加或擅自改写 related_docs。
  完成后输出添加后的完整关系结果。不上传知识库。
triggers:
  - "add related docs"
  - "加关系"
  - "写 related_docs"
  - "文档关系"
  - "对象关系"
  - "关联文档"
  - "整理关系"
mutating: true
writes_pages: false
depends_on:
  - by-knowledge-manager
---

# Add Related Docs — 对象文档关系声明

按固定三步为**当前文档**补充关联关系：

1. **提取**要点、关键字，以及 `[[wiki-link]]` / 中文关系线索（**优先于纯语义检索**）
2. **解析并检索**可关联文档（线索中的链接先落地，再补 search）
3. **写入**当前文档末尾 `--- related_docs ---`（必含 `kb_resource_id`、`target_doc_id`、`relation`）

知识库检索委派 `skills/by-knowledge-manager`（仅用 `search-file` / `read-file`）。
**不上传、不 update-file、不改知识库内容**；只改当前文件。

## Contract

本技能保证：

- 严格按下方「工作流」三步执行，顺序不可跳步
- 正文中的 `[[链接]]` 与「归属 / 包含 / 实现 / 对应 / 佐证」等线索是**一级证据**，不得忽略
- **正文线索 + 知识库命中即建边**：若正文写明关系（如 `归属: [[本体库]]`），且能在知识库中搜到对应该名称/介绍的文档，则**当前文档**对该命中文档声明对应 `relation`（其他线索同理）；不得因「未主动想到」而跳过
- **未搜到则不写**：若知识库中**没有**搜到对应关联文档（无线索命中、`search-file` 无相关结果、或 `read-file` 核对无关），**不得**添加 `related_docs` 边，也**不得**擅自改写、补全或臆造已有/不存在的 `--- related_docs ---` 内容；仅汇报未命中即可
- 关系块格式固定为下方「写入格式」（起止标记均为 `--- related_docs ---`）
- 每条关系边**必须**包含：`kb_resource_id`、`target_doc_id`、`relation`
- `doc_id` / `target_doc_id` 优先使用知识库内绝对路径；若 frontmatter 已有正式 `doc_id` 则用正式 ID
- `kb_resource_id` = 该边命中文档所在检索知识库的 `resourceId`
- `relation` 只使用下方关系清单中的编码
- 候选须经 `read-file`（或对 wiki-link 解析命中后的核对）确认存在且相关；无关跳过
- 已有关系块时**合并**（去重：同 `kb_resource_id` + `target_doc_id` + `relation`），不整段覆盖
- 不把本技能的关系写进 frontmatter；以文末 `--- related_docs ---` 为准
- 检索用知识库必须来自**当前数字员工已关联的知识库（DOC）**
- **写回范围仅限当前文件本地内容**
- 有合格命中并写入后，**必须输出**完整 `--- related_docs ---` 关系结果（原文块）；无命中则说明未改写，禁止虚构关系块

## 依赖技能与命令入口

```bash
node skills/by-knowledge-manager/scripts/by-knowledge-manager.mjs help
```

本 skill 只用只读命令：

| 动作 | 命令 |
|------|------|
| 按文件语义检索 | `search-file --resource-id <ID> --query "..." --top-k 10`（多库可重复 `--resource-id`） |
| 读文件核对 | `read-file --resource-id <ID> --file-path /path/a.md --start-line 1 --end-line 80` |

详细约定以 `skills/by-knowledge-manager/SKILL.md` 为准。

### 故障处理：找不到 `@byclaw/by-framework`

若调用 `by-knowledge-manager` 时报错：

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@byclaw/by-framework'
imported from /app/skills/by-knowledge-manager/scripts/by-knowledge-manager.mjs
```

按如下方式处理（复用扩展依赖，不重新下载安装）：

```bash
ln -sf /app/dist-runtime/extensions/baiying-enhance/node_modules \
  /app/skills/by-knowledge-manager/node_modules
```

完成后重新执行 `search-file` / `read-file`。

---

## 工作流（必须按序执行）

### 步骤 1：提取当前文档内容、关键字与关系线索

**目标**：得到检索关键字 + **显式关系候选**（禁止整篇原文当 query；禁止只抽摘要却丢掉 `[[link]]`）。

1. 锁定**当前文件**（必须可写）
2. 读全文（含 frontmatter 与正文）
3. 提取：

| 提取项 | 用途 | 优先级 |
|--------|------|--------|
| `[[链接名]]` wiki-link | **直接作为关联候选名**，必须进入步骤 2 解析 | **P0** |
| 行首/段首线索词：`归属` `包含` `包括` `实现` `对应` `对位` `佐证` `依赖于` `支撑` 等 + 其后的链接或名称 | 推断 `relation` + 方向 | **P0** |
| frontmatter `relations:`（若有） | 补充候选，不替代正文线索；本技能结果仍写文末块，不回写 frontmatter | P1 |
| 标题 / 文件名 / `name` | 主关键词、对象类型 | P1 |
| 核心实体、能力名、产品名、术语 | 补充 `search-file` query | P2 |
| 已有 `--- related_docs ---` | 合并基线 | P1 |

4. 为每条 P0 线索生成结构化候选（步骤 2 / 3 的输入）：

```text
{ link_or_name, cue_word, suggested_relation, role_hint }
```

`role_hint`：当前文档相对目标是「组成部分」还是「整体」（由线索词判定，见「线索词 → 关系与方向」）。

5. 另生成 **1～3 条**短 query，仅用于补全「无线索但语义相关」的命中；**不得**用 query 检索替代未处理的 wiki-link。
6. 记下当前 `doc_id`、对象类型。

本步产出：`doc_id`、对象类型、P0 线索列表、关键字、补充 query、已有关系块。

#### 核心规则：正文有关系说明 → 搜到目标文档 → 当前文档对其建边

只要当前文档**已经写明**某种关系线索，且知识库里能搜到对应介绍文档，就必须落边（不是「可选联想」）。

典型：

1. 正文有 `归属: [[本体库]]`（或「归属 / 隶属于 / 所属」+ 链接/名称）
2. 在选定知识库中 `search-file`（query 用「本体库」等）能命中《本体库》相关介绍文档，`read-file` 确认相关
3. **结论**：当前文档 **归属于** 该命中文档 → 写入  
   `target_doc_id = 命中 filePath`，`relation = part-of`，`kb_resource_id = 检索库 resourceId`

**其他关系同理**：

| 正文已写 | 知识库搜到 | 当前文档应写入的边 |
|----------|------------|-------------------|
| `归属: [[本体库]]` | 本体库介绍文档 | 当前 → 本体库，`part-of` |
| `包含: [[术语]]` | 术语介绍文档 | 当前 → 术语，`part-of` |
| `实现: [[知识检索]]` | 知识检索相关文档 | 当前 → 该文档，`realizes` |
| `对应: [[OWL]]` | OWL 相关文档 | 当前 → 该文档，`maps-to` |
| `佐证: [[术语消歧验证]]` | 对应案例/验证文档 | 当前 → 该文档，`evidenced-by` |
| `依赖于: [[…]]` / `支撑: [[…]]` | 对应文档 | `depends-on` / `supports` |

原则一句话：**线索里的名字 = 检索词；搜到的文档 = `target_doc_id`；线索词 = `relation`；当前文件 = 关系声明方。**

**未搜到则禁止写入**：某一线索在知识库中找不到对应介绍文档时，该线索**不建边**；若全部线索与补充检索均无合格命中，则**整次不新增、不改写**当前文件的 `related_docs`（已有块原样保留，也不虚构新块）。

#### 线索词 → 关系与方向（必须遵循）

| 正文线索 | `relation` | 当前文档角色 | `target` 含义 | 示例 |
|----------|------------|--------------|---------------|------|
| 归属 / 隶属于 / 所属 | `part-of` | **组成部分** | 所属整体 | `归属: [[本体库]]` → 术语 `part-of` 本体库 |
| 包含 / 包括 / 由…构成 | `part-of`（整体侧声明，见下方说明） | **整体** | 被包含的组成部分 | `包含: [[术语]]` → 本体库侧声明「包含术语」 |
| 实现 | `realizes` | 抽象方 | 落地能力/规格 | 概念实现某能力 |
| 对应 / 对位 | `maps-to` | 任一侧 | 对位对象 | 跨体系同义 |
| 佐证 | `evidenced-by` | 被证方 | 案例/验证 | 能力佐证案例 |
| 依赖于 | `depends-on` | 依赖方 | 被依赖方 | — |
| 支撑 | `supports` | 底层方 | 上层特性/能力 | — |

**`part-of` 双向怎么写（只改当前文件时的约定）**：

- **标准正向（优先）**：「组成部分 → 整体」。线索「归属」时必须这样写。例：当前是《术语》，目标是《本体库》：

  ```yaml
  - target_doc_id: /Concept/本体库.md
    relation: part-of
    kb_resource_id: <KB_RESOURCE_ID>
  ```

- **整体侧声明（兼容「包含」）**：当前是整体且正文写「包含 [[子]]」时，仍只写**当前文件**，边为「当前 → 子」，`relation` 同为 `part-of`：

  ```yaml
  - target_doc_id: /Concept/术语.md
    relation: part-of
    kb_resource_id: <KB_RESOURCE_ID>
  ```

- **禁止**：把「术语归属本体库」误写成「本体库 part-of 术语」；禁止在目标文件再抄一遍反向边（单向声明）。
- 同一对文档若两侧将来都有边，去重时保留「归属」侧（组成部分 → 整体）即可；本技能单次只写当前文件。
- **默认输出字段仅限** `target_doc_id`、`relation`、`kb_resource_id`，不要自作主张加 `reason` / `kind` 等字段。

---

### 步骤 2：解析线索并在知识库中检索可关联文档

**目标**：把步骤 1 的 P0 候选落到真实 `filePath`；再用 search 补漏。

#### 2.1 选定知识库

1. 从 OpenClaw **当前数字员工上下文**取数字员工 `resourceId`（禁止硬编码）
2. 查询已关联资源，**只保留 `resourceBizType = DOC`**
3. 例如：
   ```bash
   /usr/local/bin/python3 skills/crm-demo-showcase/scripts/ontology/unstructured/list_mounted_resources.py \
     '{"resource_id":<当前数字员工resourceId>,"keyword":""}'
   ```
4. 选择：
   - **0 个**：停止
   - **1 个**：默认选中
   - **多个**：列出 `resourceName (resourceId)` 让用户选（可多选）

#### 2.2 优先解析 wiki-link / 线索名（先于泛化 search）

对每个 P0 的 `link_or_name`（如 `本体库`、`术语`）：

1. 用其作为 query 调 `search-file`（可再试：带目录提示如 `Concept 本体库`、原文名、去掉「库」的变体）
2. 取高分命中，`read-file` 核对：标题/`name`/路径是否与链接名一致或同义（确认为「该对象的介绍文档」）
3. **一旦确认命中**：当前文档与该命中文档之间按线索词建立关系（见上方「核心规则」），纳入合格候选，并带上 `suggested_relation` / `role_hint`
4. **未命中 / 核对无关**：该线索**不写入**任何边；不得用猜测路径或裸链接名冒充 `target_doc_id`
5. **解析失败不得静默假装成功**：在汇报中列入「未解析链接: [[…]]」；可再换 query（最多 3 轮），仍失败则保持不写边

```bash
node skills/by-knowledge-manager/scripts/by-knowledge-manager.mjs search-file \
  --resource-id <KB_RESOURCE_ID> \
  --query "<链接名或线索名>" \
  --top-k 10
```

```bash
node skills/by-knowledge-manager/scripts/by-knowledge-manager.mjs read-file \
  --resource-id <KB_RESOURCE_ID> \
  --file-path <命中的filePath> \
  --start-line 1 \
  --end-line 120
```

#### 2.3 补充语义检索

对步骤 1 的补充 query 再 `search-file`，**排除当前文件自身**；拟采用者同样 `read-file`。无线索的命中需自行判定 `relation`（步骤 3）。

合格候选记录：

- `target_doc_id` = 命中 `filePath`
- `kb_resource_id` = 本次 `--resource-id`
- `suggested_relation` / `evidence`（来自线索或正文）

---

### 步骤 3：按指定关系与格式添加 related_docs

**目标**：写入/合并关系边；每条必含 `kb_resource_id`、`target_doc_id`、`relation`。

#### 3.1 判定关系类型

| 字段 | 要求 |
|------|------|
| `doc_id` | 当前文件标识 |
| `target_doc_id` | 候选 `filePath` |
| `kb_resource_id` | 检索库 `resourceId` |
| `relation` | 关系清单合法编码 |

判定顺序：

1. **P0 线索自带的 `suggested_relation` 优先**（见线索表）
2. 用户指定的关系表优先于启发式
3. 否则按关系清单类型约束 + 正文证据
4. 启发：Ability→Feature → `supports`；Feature/TechSpec→Example → `evidenced-by`；**Concept/Methodology 组成树 → `part-of`**；跨体系同义 → `maps-to`；概念落地能力 → `realizes`
5. 不符约束又无理由 → 跳过或问用户（P0 显式线索一般应保留）
6. 展示拟写边摘要；用户已说「直接加」可跳过确认

#### 3.2 追加/合并到当前文件末尾

**前置条件**：合格候选列表非空。若步骤 2 无任何合格命中，**跳过本步整段写回**——不添加新块、不改已有 `related_docs`、不臆造 `target_doc_id`。

只改**当前文件**（且仅写入已确认命中的边）：

1. 定位已有 `--- related_docs ---` … `--- related_docs ---` 块
2. 无则追加；有则按 `(kb_resource_id, target_doc_id, relation)` 合并
3. 写回 UTF-8；不改目标文档；不 upload / update-file

字段顺序固定：`target_doc_id` → `relation` → `kb_resource_id`。默认不要添加其他字段。

#### 3.3 汇报

若本次无任何合格命中：说明「未搜到对应关联文档，未添加/未改写 related_docs」；若文件已有关系块可原样展示，若无则明确「未添加任何关系」。**禁止**为交差而虚构关系块。

若有写入，按下列格式输出：当前文件: <path>
检索知识库: <resourceName> (<resourceId>)...
线索解析: [[…]] → /path/…（失败列出）
检索命中: N（采用 M，跳过无关 P）
新增边: M
跳过(已存在): K
失败: [...]

添加后的关系结果:
--- related_docs ---
...
--- related_docs ---
```

- 完整块 = 落盘结果（历史边 + 本次新增）
- 无变更也要说明；无块则写「未添加任何关系」

---

## 写入格式（必须 verbatim）

每条边必填：`target_doc_id`、`relation`、`kb_resource_id`。

```markdown
--- related_docs ---

doc_id: /Ability/自然语言查询.md
related_docs:
  - target_doc_id: /Feature/性能与准确率双保障.md
    relation: supports
    kb_resource_id: <KB_RESOURCE_ID>

--- related_docs ---
```

**概念组成示例（归属）** — 当前文件为《术语》：

```markdown
--- related_docs ---

doc_id: /Concept/术语.md
related_docs:
  - target_doc_id: /Concept/本体库.md
    relation: part-of
    kb_resource_id: <KB_RESOURCE_ID>

--- related_docs ---
```

**整体侧「包含」示例** — 当前文件为《本体库》：

```markdown
--- related_docs ---

doc_id: /Concept/本体库.md
related_docs:
  - target_doc_id: /Concept/术语.md
    relation: part-of
    kb_resource_id: <KB_RESOURCE_ID>
  - target_doc_id: /Concept/对象.md
    relation: part-of
    kb_resource_id: <KB_RESOURCE_ID>

--- related_docs ---
```

## ID 约定

| 字段 | 规则 |
|------|------|
| `doc_id` | 当前文件：优先知识库绝对路径；frontmatter 有正式 `doc_id` 则用之 |
| `target_doc_id` | 知识库 `filePath`（绝对路径，含扩展名） |
| `kb_resource_id` | 目标所属知识库 `resourceId` |
| `relation` | 关系清单编码 |
| 对象类型 | 优先路径目录（`/Concept/...`→Concept）；否则标题/`name`/正文 |

不要用磁盘绝对路径当 `target_doc_id`；不要只用裸文件名。

---

## 关系声明原则

### 单向声明，双向可见

- **单向声明**：同一语义边只在一侧落盘；不要为「可见」去目标文件抄反向边
- **双向可见**：查询时可从对侧反查（见反向表）

### 唯一声明源（默认主动方）

| 关系 | 默认声明方向 |
|------|--------------|
| `part-of`（归属） | 组成部分 → 整体（优先） |
| `part-of`（包含，整体侧） | 整体 → 组成部分（仅当正文用「包含」且只编整体文件时） |
| `supports` | 底层能力 → 上层特性 |
| `realizes` | 抽象概念 → 具体能力 |
| `evidenced-by` | 能力/特性/规格 → 案例 |

### 一致性

- 目标必须在知识库真实存在（search/read 或 wiki-link 解析确认）
- 关系类型符合清单约束（含 Concept 组成树的 `part-of`）
- 同一 `(kb_resource_id, target_doc_id, relation)` 不重复

### 反向关系推断

| 正向关系编码 | 反向语义 | 示例 |
|---|---|---|
| `competitor-of` | 被竞争于 | A competitor-of B → B 被 A 竞争 |
| `depends-on` | 被依赖于 | A depends-on B → B 被 A 依赖 |
| `part-of` | 包含 / 归属（视声明侧） | 术语 part-of 本体库 ↔ 本体库包含术语 |
| `maps-to` | 对位于（对称） | A maps-to B → B 对位于 A |
| `realizes` | 被实现于 | A realizes B → B 被 A 实现 |
| `supports` | 被支撑于 | A supports B → B 被 A 支撑 |
| `evidenced-by` | 佐证 | A evidenced-by B → B 佐证 A |

## 关系清单（编码必须一致）

| 关系类型名称 | 关系类型编码 | 适用来源对象类型 | 适用目标对象类型 | 关系标准 |
|---|---|---|---|---|
| 竞争于 | `competitor-of` | Product | Product | 两产品在同一市场/品类直接竞争时使用。 |
| 依赖于 | `depends-on` | Product, TechComponent | Product, TechComponent | 来源强依赖目标；缺失则不可用。 |
| 归属 / 包含 | `part-of` | Concept, Methodology, Product, TechComponent | Concept, Methodology, Product, TechComponent | **组成关系**。①归属：组成部分 → 整体（如术语 → 本体库）。②包含：整体 → 组成部分（如本体库 → 术语）。Concept↔Concept 组成树明确允许。 |
| 对位 | `maps-to` | Methodology, Concept | Methodology, Concept | 跨体系等价/对位。 |
| 实现 | `realizes` | Concept, TechComponent | Ability, TechSpec | 抽象落地为能力/规格。 |
| 支撑 | `supports` | Ability, TechSpec, TechComponent | Feature, Ability | 底层功能性支撑上层。 |
| 佐证 | `evidenced-by` | Ability, Feature, TechSpec | Example, Validation | 目标须含可观测结果。 |

对象类型：

| 类型编码 | 含义 |
|---|---|
| Product | 产品 |
| Methodology | 方法论 |
| Concept | 概念 |
| Ability | 能力 |
| Feature | 特性 |
| TechComponent | 技术组件 |
| TechSpec | 技术特性/规格 |
| Example | 案例/场景 |
| Validation | 验证 |
| TechArchitecture | 技术架构 |
| ProductMap | 产品总图 |
| Operation | 操作说明 |

> 其他跨类型扩展须能说明理由；不确定时先问用户。P0 正文线索（如「归属: [[本体库]]」）一般视为已有理由。

## 反模式

- 未搜到对应关联文档仍添加边，或擅自改写 / 臆造 `related_docs`
- 用未验证的路径或裸 `[[链接名]]` 冒充 `target_doc_id`
- 正文有 `[[链接]]` /「归属|包含|…」却不解析，只靠泛化语义 search
- 把「术语归属本体库」误写成「本体库 part-of 术语」
- 默认输出里私自增加 `reason` / `kind` 等未约定字段
- 跳过步骤 2.1，不从数字员工关联知识库选库
- 未核对就把 search 命中全部写成边
- 关系边缺少 `kb_resource_id` / `target_doc_id` / `relation`
- 在目标文件写反向边
- 只改 frontmatter、不写文末 `--- related_docs ---`
- 使用中文关系名当 `relation` 字段值
- 调用 upload / update-file
- 覆盖整块导致旧边丢失
- 对解析失败的 `[[链接]]` 静默假装已写入

## 输出（对用户）

有变更时按步骤 3.3：摘要（含线索解析结果）+ **完整关系结果块**。  
无合格命中时：说明未搜到、未改写即可；不得为交差虚构关系块。
