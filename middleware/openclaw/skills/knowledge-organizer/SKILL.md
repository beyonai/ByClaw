---
name: knowledge-organizer
description: 用户上传或采集文档后，对文档资料进行知识整理：对象拆分、两阶段关系梳理、预览确认后入库。
allowed-tools: read, edit, exec, write, baiying_call
triggers:
  - "整理文档"
  - "帮我整理"
  - "知识整理"
  - "整理资料"
  - "上传了文档帮我整理"
  - "采集了一批资料帮我整理"
  - "上传了一批文档"
  - "我有一批资料"
---

# 知识整理（knowledge-organizer）

## 角色分工

| 执行方 | 职责 |
|--------|------|
| **本技能（自己做）** | 正文生成、YAML front matter 打标、阶段1本地关系、阶段2知识库关联 |
| **doc-tagger** | 仅最后一步：将完整文档录入本体库 |

> **doc-tagger 是入库工具，不是整理流程的一部分**。入库之前的所有工作（正文、打标、关系）均由本技能自行完成。

## 关系创建的两个阶段

### 阶段1：本地对象文档关系梳理

**工具**：`scripts/add_related_docs.py`

梳理同一批整理出来的对象文档之间的关联关系，写入 `--- related_docs ---` 块：

```markdown
--- related_docs ---

doc_id: /path/to/doc.md
related_docs:
  - target_doc_id: /path/to/related.md
    relation: reference
    kb_resource_id: "10067398"

--- related_docs ---
```

### 阶段2：知识库内关系梳理

**工具**：`add-related-docs` Skill

在知识库中检索与当前文档相关的已有文档，为本地文档补充来自知识库的外部关联关系。

**执行规则**：
- 严格按 `add-related-docs` 的三步流程执行：①提取关系线索 → ②知识库检索 → ③写入 `related_docs`
- 知识库检索结果为空时，**不写入**该知识库关联关系（不建边）
- 知识库检索结果有命中时，追加到 `kb_resource_id` 指向知识库的 `related_docs` 条目

---

## 执行流程

### Step 1：收集与读取文档

1. 确认用户待整理的文档来源（本地文件路径、知识库目录等）
2. 读取所有文档内容，了解主题和关键信息
3. 按文档内容自然分类，为每个类别确定对应的本体对象类型
4. 确认用户是否指定**对象范围**（对象编码或对象名称）。未指定时按所有已授权对象处理；已指定时，该范围是后续生成、消解、预览和入库的唯一对象范围，不得因文档内容推断而扩展范围。

> 若文档来源为知识库，使用 `by-knowledge-manager` 的 `download` 命令将文档下载到本地 session 目录。

### Step 2：查询本体对象与对象覆盖检查

#### 2.1 依赖预检查

在查询本体对象前，先检查 `add_related_docs.py` 所需的依赖是否可用：

```bash
python3 -c "import yaml" 2>/dev/null || python3 -m pip install pyyaml
```

若安装失败，记录错误并中止流程，告知用户依赖问题。

#### 2.2 获取授权对象列表并确定处理范围

调用 `unstructured-ontology-manager` 技能获取当前数字员工有权限的**全部本体对象列表**：

```bash
/usr/local/bin/python3 <skill>/unstructured-ontology-manager/scripts/list_mounted_resources.py '{"resource_id":"<数字员工的id>"}
```

先用该列表校验用户指定的对象范围，并确定“处理对象列表”：

- **用户未指定对象范围**：处理对象列表等于全部已授权对象；
- **用户指定对象范围**：仅保留对象编码或对象名称与用户输入精确匹配的对象。用户指定但未匹配到的对象必须告知用户并停止，**不得回退为处理全部对象**；
- 用户指定对象范围时，仅获取范围内对象的完整详情；范围外对象只用于范围校验，不获取三要素。

只对“处理对象列表”中的对象，通过 `unstructured-ontology-manager` 的 `get_object.py` 脚本获取完整详情（三要素）：

```bash
/usr/local/bin/python3 <skill>/unstructured-ontology-manager/scripts/get_object.py '{"object_code":"<object_code>"}'
```

返回结果中即包含三要素：
1. **字段属性**：`data.properties` — 对象的全部字段定义及约束（含 `terminology` 术语绑定信息）
2. **正文模版**：`data.template` — 对象的正文编写规范（章节结构、必填内容等）
3. **对象关系规则**：`data.rules` — 对象支持哪些关系类型（如 `depends-on`、`reference` 等）

> **⚠️ 通过 get_object.py 获取，不要用 baiying_call**

记录每个对象的：
- `entity_code`（对象编码）
- `entity_name`（对象名称）
- `resourceCode`（资源编码，用于 doc-tagger）
- `resourceId`（资源 ID，用于 doc-tagger）
- **三要素**（字段属性、正文模版、对象关系规则）

> **⚠️ 三要素是写文档的必要前提**：必须先拿到对象的正文模版，才知道文档怎么写；必须先拿到字段属性，才知道 front matter 有哪些字段、哪些是枚举需要查术语值；必须先拿到对象关系规则，才知道阶段1关系用什么类型。

> **动态获取，不写死对象列表**：每次执行时都重新从本体库查询；未指定范围时涵盖所有已授权对象，指定范围时仅处理范围内对象。

#### 2.3 对象覆盖检查（⚠️ 必须执行）

**在进入 Step 3 之前，必须基于 Step 2.2 确定的“处理对象列表”执行覆盖检查。未指定对象范围时，确保不遗漏任何已授权对象类型；指定范围时，仅检查范围内对象。**

检查方法是：

```text
对“处理对象列表”中的每一个对象类型，根据其 objectDesc（对象描述）理解该类型的用途，
对照源文档内容，判断是否有内容可提炼为该类型实例。
```

**判断标准**：每个对象类型都有一个 `objectDesc` 字段描述其用途（如 Concept 描述为"概念定义对象，描述通用概念、专属概念、元概念及竞品对照概念"），根据这个描述来判断源文档是否有匹配内容。

**检查规则**：
- **遍历对象列表是动态的**：每次执行时都基于 Step 2.2 实时确定的“处理对象列表”，不得使用预置的固定列表
- **不得跳过范围内对象类型**：对处理对象列表中的所有对象逐一判断；指定范围时不得处理范围外对象
- 对于不确定是否可用的类型，标记为"候选"并在 Step 6 向用户展示，让用户判断
- 在 Step 6 的预览汇报中，明确列出用户指定的对象范围、范围内已覆盖对象类型和范围内未使用对象类型及原因；范围外对象不纳入预览

### Step 3：基于三要素生成对象级文档（自己做）

**⚠️ 禁止在三要素缺失的情况下写文档**：必须先完成 Step 2 拿到每个对象的三要素，才能进入本步骤。

对每个匹配到的本体对象，**严格按三要素编写**文档内容：

所有处理中文档必须按来源和状态分目录保存，禁止将三类文件混放：

```
/by/.sessions/{session_id}/{任务名称}/
  ├── 新建对象/                         # Step 3：本次整理生成的对象文档
  │     ├── {对象名称1}/
  │     │     ├── {对象实例1}.md
  │     │     └── {对象实例2}.md
  │     └── {对象名称2}/
  │           └── {对象实例3}.md
  ├── 知识库候选/                       # Step 5.5：从知识库召回并下载的候选文档
  │     └── {对象名称}/
  │           └── {对象实例}.md
  └── 融合结果/                         # Step 5.5：doc-fusion 生成的融合文档
        └── {对象名称}/
              └── {对象实例}.md
```

目录职责：
- **新建对象**：仅存放 Step 3 新生成的文档；Step 4、Step 5 和 Step 5.5 均以此目录中的文档为处理对象。
- **知识库候选**：仅存放 Step 5.5 召回后下载到本地、用于内容确认和融合的知识库文档；候选不等于已确认同一实例。
- **融合结果**：仅存放 Step 5.5 由 `doc-fusion` 产出的变更文档；不得复制未变更的知识库文档或未融合的新建文档。

文档内容包含：
- **YAML front matter（严格按字段属性写）**：根据 Step 2 获取的「字段属性」中的字段定义写入，禁止自行增加字段；枚举类字段值调用 `unstructured-ontology-manager` 的 `get_term_type_values.py` 查询允许值列表，从中选择匹配项填入，不得自行编造
- **正文（严格按正文模版写）**：根据 Step 2 获取的「正文模版」中的章节结构规范编写，不得自行删减或增加结构层级
- **关系标注与关系线索词（⚠️ 必须执行）**：在正文中同时使用以下两种格式标注文档间关联：
  - **wiki-link 格式**：`[[../类型/文档名.md]]`，用于生成可跳转的文档链接
  - **关系线索词**：在段落中嵌入「归属」「包含」「实现」「对应」「佐证」「支撑」「依赖于」等关键词，用于阶段1关系梳理时自动确定 `relation` 类型

  示例：
  ```markdown
  ## 对象说明

  企业本体是AI时代企业数据新基建的核心概念。它由四根"刺"组成......
  本概念归属: [[../Concept/数据本体论.md|数据本体论]]
  实现: [[../Ability/AI语义理解能力.md|AI语义理解能力]]

  ## 关键依据

  - 来源：《大话企业本体》系列8篇文章
  - 对位: [[../Methodology/数据本体论方法论.md|数据本体论方法论]]
  ```

- **术语值查询空结果处理（⚠️ 新增）**：对枚举类字段调用 `get_term_type_values.py` 查询后，若返回空集，在 front matter 对应字段后添加注释，例如：
  ```yaml
  product_code: "ByDC"  # term_type: product_code, 查询结果为空，使用合理值
  owner_type: "own"     # term_type: concept_owner_type, 查询结果为空，使用合理值
  ```

查询术语值的命令：
```bash
/usr/local/bin/python3 <skill>/unstructured-ontology-manager/scripts/get_term_type_values.py '{"term_type_code":"<字段名>"}'
```

### Step 4：阶段1 — 梳理本地文档关系（自己做）

**⚠️ 这是 Step 3 之后、Step 6 之前必须执行的步骤，不可跳过。写完正文后不能直接进入用户确认，必须先完成两阶段关系梳理。**

根据各对象的 relations 字段定义（或通用基础关系规则），从文档内容中挖掘对象实例之间的关联，生成 `relations_batch.json` 配置文件：

```json
[
  {
    "doc_path": "/by/.sessions/{session_id}/{任务名称}/新建对象/Ability/跨源联邦查询能力.md",
    "relations": [
      {
        "target_doc_id": "/by/.sessions/{session_id}/{任务名称}/新建对象/Feature/实时跨源查询.md",
        "relation": "reference",
        "kb_resource_id": "{知识库resourceId}"
      }
    ]
  }
]
```

**关系类型判断规则**（优先使用 Step 3 正文中嵌入的关系线索词）：
- 正文中有「归属」→ `part-of`
- 正文中有「包含」→ `part-of`
- 正文中有「实现」→ `realizes`
- 正文中有「对应」/「对位」→ `maps-to`
- 正文中有「佐证」→ `evidenced-by`
- 正文中有「支撑」→ `supports`
- 正文中有「依赖于」→ `depends-on`
- 无明确线索词但需要关联的 → `reference`

调用本技能目录下的 `scripts/add_related_docs.py` 脚本写入关系：

```bash
cd /by/.sessions/{session_id} && python3 <skill>/knowledge-organizer/scripts/add_related_docs.py -b relations_batch.json
```

`<skill>` 路径占位符会在执行时由 agent 自动解析为当前 workspace 下的 skills 根目录路径。

### Step 5：阶段2 — 梳理知识库关联（自己做，使用 add-related-docs）

**⚠️ 这是 Step 4 之后、Step 6 之前必须执行的步骤，不可跳过。写完正文后不能直接进入用户确认，必须先完成两阶段关系梳理。**

**严格按 `add-related-docs` 技能的三步流程执行**：

**步骤①：提取要点与关系线索**
- 提取当前文档的 wiki-link 链接（Step 3 中已嵌入）
- 提取正文中「归属|包含|实现|对应|佐证」等关系关键词

**步骤②：在知识库中检索可关联文档**
- 对每个 wiki-link 路径和关系关键词，使用 `by-knowledge-manager` 的 `search-file` 命令检索
- 检索命中后用 `read-file` 核对文档内容

**步骤③：写入知识库关联关系**
- 将知识库命中的文档按格式追加到本地文档的 `--- related_docs ---` 块
- 知识库检索结果为空时，**跳过**，不写入该知识库关联
- 已有关联不重复写入（去重）

### Step 5.5：对象级实例消解与文档融合（子 agent）

**⚠️ Step 5 之后、Step 6 之前执行，不可跳过。主流程按对象名称启动子 agent，每个子 agent 仅处理一个对象目录。**

1. 从“新建对象”目录按 `{对象名称}` 分组；每批并发启动 3–5 个子 agent，等待本批完成后再启动下一批。
2. 向每个子 agent 提供任务目录、对象名称、对象类型、identity 字段、KB ID、resource ID 与该对象的三类目录路径。
3. 子 agent 必须先加载 `knowledge-organizer/skills/entity-resolution`，在隔离目录中完成批内去重、双路召回、候选下载和实例判断；只对确认融合的文档对再加载 `knowledge-organizer/skills/doc-fusion`，写入“融合结果”目录。
4. 子 agent 不得读取或写入其他对象目录，不得入库、调用 `baiying_call` 或启动嵌套子 agent。待用户确认候选不得融合，未匹配文档保留在“新建对象”目录。
5. 子 agent 的最终回复**只能**返回下表（不得附加说明文字）。每个结果项一行；`result_type` **只能**是 `new` 或 `fusion`，没有该类结果时不创建对应行。`result_status` 只能是 `completed`、`partial` 或 `failed`。

| object_name | result_status | result_type | current_source_path | candidate_source_path | output_path | detail |
| --- | --- | --- | --- | --- | --- | --- |
| `{对象名称}` | `completed` | `new` | `{新建对象文档路径}` | - | - | `无候选或内容不同义` |
| `{对象名称}` | `completed` | `fusion` | `{新建对象路径}` | `{知识库候选路径}` | `{融合结果路径}` | `conflicts=[]` |

`fusion` 行的三条路径是 Step 7 融合更新的唯一来源；候选、待确认、批内去重和错误均由子 agent 内部处理，不单独返回结果行。

6. 主流程等待所有对象子 agent 返回后，仅以该 Markdown 表格汇总预览和后续入库数据，才可进入 Step 6。

### Step 6：用户预览确认（⚠️ 关键节点）

**Step 3 → Step 4 → Step 5 → Step 5.5 → Step 6，必须按顺序执行，不可跳步。在完成两阶段关系梳理、实例消解和文档融合之前，不得进入此步骤。**

向用户展示：
1. **整理结果目录树**：列出所有生成的文档及其层级结构
2. **文档存储地址**：`/by/.sessions/{session_id}/{任务名称}/`，并按“新建对象 / 知识库候选 / 融合结果”三层来源目录展示完整目录树
3. **核心文档摘要**：每个对象类型的代表性内容概要
4. **关系图谱**：各文档间的关联关系（阶段1 + 阶段2）
5. **对象覆盖情况**：列出本次对象范围、范围内已覆盖的对象类型，以及范围内未使用的对象类型及原因；范围外对象不展示、不处理
6. **实例消解结果（新增）**：

   ━━ 新建实例（N个）━━
   ✅ /Person/张三.md → 新增

   ━━ 融合更新（M个）━━
   🔗 /Person/王小明.md ⇄ KB已有 /Person/王小明.md
      匹配: name="王小明" ✅ | 置信度: 高
      新增属性: 获奖经历 → "短跑冠军"
      无冲突

   ━━ 批内合并（K组）━━
   🔀 /Person/王小明.md + /Person/王小明的运动会经历.md
      → 合并为 /Person/王小明.md（新增属性: 获奖经历×2）
7. **文档融合结果（新增）**：对每个已融合实例展示知识库原文路径、本次新增文档路径和融合输出路径；待用户确认的同义候选必须标明“未融合，等待决定”。

明确告知用户：

> 请在继续操作之前，前往以下地址确认文档内容是否符合预期：
> `{存储地址}`
>
> 「新建实例」将作为独立文档录入。
> 「融合更新」将以 `doc-fusion` 生成的融合文档更新已有文档。
> 属性有冲突的已标记 ⚠️，请确认处理方式。
>
> 确认无误后请回复「确认入库」或「可以」，我将为您执行分流入库。
> 如需修改某篇文档内容或调整消解结果，请告知具体文档和修改意见。

**等待用户明确确认后再进入 Step 7。**

### Step 7：分流入库

用户确认后，按消解结果分流：

**执行方式（⚠️ 禁止使用子代理）**：
- **不使用子代理**：主流程直接调用 `baiying_call`，禁止通过 `sessions_spawn` 派发子代理处理
- **每个文件单独调用**：每个文件必须单独发起一次 `baiying_call`，不得合并
- **并发调用**：同一轮中可以同时发起多个 `baiying_call` 调用，提高效率。建议每批 3-5 个同时调用，等待返回后再处理下一批
- **按对象ID分组**：将文档按对象ID分组，同一对象ID的文档可以批量处理

**匹配规则**：
- 新建实例只从“新建对象”目录读取；融合更新只从“融合结果”目录读取；“知识库候选”目录中的文件仅用于消解和融合，禁止直接入库
- 根据文档的 YAML front matter 中的 `product_code`、对象类型目录判断应录入哪个本体对象
- 使用 `baiying_call` 调用，`resource_id` 为对象的 resourceId，`resource_type` 为 `"OBJECT"`

---

**方式 A：新建实例** → `doc-tagger` 普通打标

```
baiying_call:
  resource_id: "{对象的resourceId}"
  resource_type: "OBJECT"
  query: "请对以下文档进行结构化打标录入：
    文档路径：{文件完整路径}
    文档内容：{完整文档内容}

    请提取文档中的关键信息，完成字段录入。"
```

---

**方式 B：融合更新** → `doc-tagger` 融合更新

仅对 Step 5.5 返回表中 `result_type=fusion` 的行执行。`original_source_path`、`current_source_path` 和 `source_path` 必须分别使用该行的 `candidate_source_path`、`current_source_path` 和 `output_path`；禁止以未融合的新增文档替代 `source_path`。

```
baiying_call:
  resource_id: "{对象的resourceId}"
  resource_type: "OBJECT"
  query: "请执行融合更新，将文件融合后的文件打标更新。
    original_source_path: {KB已有文档路径}
    current_source_path: {本次生成文档路径}
    source_path: {融合后文档路径}
    content:
    {融合后完整正文}"
```

**注意**：所有 `baiying_call` 调用完成后，汇总结果并汇报。禁止在调用过程中就告知用户"已成功"。

### Step 8：汇总结果

向用户汇总：
- 整理文档数量
- 各对象类型分布
- **批内去重合并组数（新增）**
- **实体消解结果：新建数 / 融合数 / 冲突数（新增）**
- **doc-fusion 结果：融合文档数 / 待确认候选数（新增）**
- 阶段1写入的本地关系数量
- 阶段2写入的知识库关联数量
- 入库成功/失败数量
- 知识库存储路径

---

## 执行约束

1. **正文和打标自己做**：文档正文内容、YAML front matter 均由本技能自行生成，不委托给其他 Skill
2. **YAML 字段值必须查询术语表**：front matter 中的枚举类字段值（如 `product_code`、`owner_type` 等）必须通过 `unstructured-ontology-manager` 的 `get_term_type_values.py` 查询允许值列表，从中选择匹配项填入，不得自行编造；查询结果为空时，在字段后添加注释说明
3. **关系创建分两阶段**：阶段1（本地）+ 阶段2（知识库），缺一不可；**Step 3 → Step 4 → Step 5 → Step 5.5 → Step 6，必须按顺序执行，不可跳步**
4. **阶段2使用 add-related-docs**：严格按其三步流程执行，知识库为空则不写关联
5. **Step 6 用户确认不可跳过**：未获得用户确认不得调用 doc-tagger 入库
6. **每个文件单独调用 baiying_call**：禁止合并多个文件到同一次调用
7. **动态获取并过滤对象列表**：不写死固定对象类型，每次执行时从本体库查询；用户指定对象范围时，只获取并处理范围内对象详情
8. **正文必须包含 wiki-link 关系标注和关系线索词**：在"对象说明"和"关键依据"中使用 `[[../类型/文档名.md]]` 格式标注关联，使用「归属」「包含」「实现」「对应」「佐证」「支撑」「依赖于」等线索词
9. **对象覆盖检查**：进入 Step 3 前，必须遍历处理对象列表中的所有对象类型，对照源文档内容判断是否能提炼为各类型实例；在 Step 6 中展示范围内未使用的对象类型及原因
10. **打标录入禁止使用子代理**：Step 7 由主流程直接调用 `baiying_call`，同一轮中可并发发起多个调用
11. **Step 5.5 必须按对象隔离**：主流程按对象名称派发子 agent；每个子 agent 必须加载 `entity-resolution`，只处理其分配的三类对象目录并返回结构化结果
12. **冲突属性必须标记让用户选**：属性 diff 中出现两边值不同的字段，必须在 Step 6 中用 ⚠️ 标记，由用户确认处理方式后再入库
13. **Step 5.5 必须使用两个子 skill**：实例消解必须加载 `entity-resolution`，已确认同一实例的文档必须再加载 `doc-fusion` 并输出到独立目录；不得覆盖任一输入目录，不得跳过融合直接入库
14. **处理目录必须隔离**：Step 3 仅写入“新建对象”，Step 5.5 下载的知识库候选仅写入“知识库候选”，融合结果仅写入“融合结果”；“知识库候选”不得直接入库
15. **子 agent 只处理 Step 5.5**：对象子 agent 不得调用 `baiying_call`、不得启动嵌套子 agent；Step 7 的入库仍由主流程直接执行
16. **对象范围不可扩展**：用户指定对象范围时，范围外对象不得进入 Step 3、Step 5.5、Step 6 或 Step 7；对象范围未匹配时必须停止并向用户确认
