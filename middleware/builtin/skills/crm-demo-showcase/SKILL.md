---
name: crm-demo-showcase
description: 当用户想了解本体如何开发和使用时使用本技能。它能够通过 CRM 的实际 DEMO，演示以下 6 项能力：1）自然语言数据查询（无需 SQL）；2）聚合统计分析；3）字段歧义智能消歧；4）非结构化文本转对象和跨表视图的创建；5）数据操作（周报生成→信息抽取→客户录入→商机任务创建）；6）非结构化本体的文档融合检索。你可以通过以下对话唤起本技能：「给我演示一下」「本体能做什么」「怎么创建对象和视图」「结构化和非结构化怎么融合」「帮我查一下客户数据」。
---

# CRM 综合能力演示

> **核心原则**：按用户要求逐项演示，不一次做完所有项。全部使用简体中文。
>
> **引导原则**：每次演示结束后，用一句话点出刚才展示的核心价值，并自然引导用户选择下一个想了解的方向。

## ⚠️ 脚本执行规则（最高优先级，不得违反）

1. **必须严格按照本SKILL的演示流程进行演示，严禁自由发挥、胡乱编造、修改演示用例**
2. **必须直接用 Bash 执行 `scripts/` 下的现有脚本**，禁止自行编写 Python/Shell 代码来替代或模拟脚本功能
3. **禁止重写脚本逻辑**：即使理解脚本内容，也不允许复现、改写或内联其逻辑
4. **解析脚本输出**：读取 stdout 的 JSON，`ok: true` 为成功，`ok: false` 为失败，失败时将 `error` 字段原文告知用户
5. **不允许推测结果**：脚本未执行前不得告知用户操作成功或失败

## 演示能力地图

每个演示项对应一个 demo 文件，用户感兴趣时直接打开执行。

| 序号 | 演示项 | 核心价值一句话 | 适合问法 |
|:----:|--------|--------------|---------|
| 1 | [数据查询](demos/01-data-query.md) | 一句话问到数据，无需 SQL | "帮我查客户""查商机数据" |
| 2 | [数据统计](demos/02-data-statistics.md) | 聚合排序分组，说出来就行 | "统计一下各行业""TOP 3 是谁" |
| 3 | [歧义处理](demos/03-ambiguity-handling.md) | 能确定的不问，不确定的才问 | "它怎么知道我想查什么" |
| 4 | [数据操作](demos/04-data-operations.md) | 文本进去，结构化数据出来 | "帮我把周报录入系统" |
| 5 | [结构化本体](demos/05-structured-ontology.md) | 自己建模自己查，不需要开发 | "我能自定义数据结构吗" |
| 6 | [非结构化本体](demos/06-unstructured-ontology.md) | 文档打标签，检索像查数据库 | "会议纪要也能查吗" |

> **新手引导**：用户说"给我演示一下"或"功能有哪些"时，先展示以下功能清单，**等用户选择后再继续**，不要自动开始执行：
>
> ```
> 我来给你演示一下，以下是我能展示的能力，你想从哪个开始？
>
> 1️⃣ 数据查询 — 直接说"查客户""查商机"，不用写 SQL
> 2️⃣ 数据统计 — "各行业签约金额汇总"这样一句话搞定聚合
> 3️⃣ 歧义处理 — 字段名说错了？系统会智能追问确认
> 4️⃣ 数据操作 — 把钉钉周报里的客户信息直接录入 CRM
> 5️⃣ 本体建模 — 不用开发，自己创建数据对象和跨表视图
> 6️⃣ 文档融合 — 会议纪要也能像查数据库一样精准检索
>
> 说"全部演示"我会按顺序逐个展示，或者直接告诉我你最感兴趣的～
> ```

> **全部演示**：按 1→6 依次执行 [01](demos/01-data-query.md) → [02](demos/02-data-statistics.md) → [03](demos/03-ambiguity-handling.md) → [04](demos/04-data-operations.md) → [05](demos/05-structured-ontology.md) → [06](demos/06-unstructured-ontology.md)，每个演示结束后用"这就是xxx能力，下面我展示xxx"过渡。

---

## 环境准备（静默执行，不打断演示节奏）

收到任何演示请求后，**先静默完成环境检查，就绪后再开口**。不要向用户解释环境准备过程。

### 就绪条件

1. `/usr/local/bin/python3` 可用，`by-framework` 和 `by-datacloud` 已预装
2. `list_mounted_resources.py` 返回至少一条 VIEW 或 OBJECT 记录（说明本体已挂载）

两个条件都满足 → 直接开始演示。否则按以下步骤准备。

### Step 1：检查 Python 环境

```bash
bash scripts/setup.sh
```

### Step 2：挂载视图（仅在未挂载时执行）

先执行 `list_mounted_resources.py` 检查是否已有 `scene_sales_management`：

```bash
/usr/local/bin/python3 scripts/ontology/structured/list_mounted_resources.py \
  '{"resource_id": <Agent的数字后缀>}'
```

- **已存在** → 跳过，直接开始演示
- **不存在** → 执行挂载：

```bash
/usr/local/bin/python3 scripts/ontology/structured/mount_resource.py \
  '{"agent_id": <Agent编码的数字后缀>, "resource_code": "scene_sales_management"}'
```

> `agent_id` 从 Agent 编码中提取数字后缀（如 `agent-10014603` → `10014603`）。

### Step 3：首次挂载后需结束本轮

首次挂载后 **baiying_call 不会立即可用**。必须**结束本轮**，等待用户下一轮输入后生效。

回复话术：`"好的，我先准备一下演示环境～ 马上开始！"`

下一轮收到用户输入后，再次执行 `list_mounted_resources.py` 确认挂载成功 → 环境就绪，开始演示。

---

## 演示通用规则

各 demo 子文件中不再重复以下规则：

### resource_id 获取

`baiying_call` 的 `resource_id` 是**数字型 ID**，通过 `list_mounted_resources.py` 运行时动态获取，**不可硬编码**：

```bash
# 提取 Agent 的 resource_id（从编码中的数字后缀，如 agent-10014603 → 10014603）
/usr/local/bin/python3 scripts/ontology/structured/list_mounted_resources.py \
  '{"resource_id": <Agent的resource_id>, "keyword": "<中文名称>"}'
```

从返回 JSON 的 `data` 数组中提取数字 `resourceId`。各 demo 步骤中注明了对应的 keyword。

### resource_type

`baiying_call` 必须指定 `resource_type`：`VIEW`（查询）或 `OBJECT`（写入），必须大写。

### 挂载生命周期

演示 5/6 中创建的视图/对象挂载后，属于非首次挂载，无需结束本轮等待生效。规则同上 Step 3。

### 演示收尾引导

每个 demo 演示结束后，**必须**用以下结构收尾：

```
[一句话总结刚才展示的核心价值]

你还想了解哪方面？
• 数据统计 — 聚合排序分组
• 歧义处理 — 智能识别模糊表述
• 数据操作 — 文本录入结构化数据
• 本体建模 — 自定义数据模型
• 文档融合 — 非结构化文档检索
```

> 根据当前演示调整推荐列表：已演示过的项可以从列表中去掉，或换成"深入了解 xxx"的选项。

---

## baiying_call 工具

`baiying_call` 是 MCP 工具，**挂载资源后才在工具列表中可见**。未挂载时调用会直接不可用。

| 参数 | 说明 |
|------|------|
| `resource_id` | 数字型 ID，不同资源 ID 不同。通过 `list_mounted_resources.py`（查询已挂载资源）获取，不可硬编码 |
| `resource_type` | `VIEW`（查询）或 `OBJECT`（写入），必须大写 |
| `query` | 自然语言，用户想做什么就写什么 |

> **获取 resource_id**：执行 `list_mounted_resources.py`。不传参数默认查全部（个人+企业、OBJECT+VIEW）。可按 `keyword` 中文名称筛选，从返回结果中获取数字 `resourceId`。

### 挂载生命周期与中途故障处理

挂载视图后 **不会立即生效**——需要用户下一轮输入后，`baiying_call` 才会出现在工具列表中。

**标准处理流程：**

```
收到用户请求
    ↓
尝试调用 baiying_call
    ├── ✅ 成功 → 返回结果，继续
    └── ❌ 工具不可用 / 404
            ↓
        执行 mount_resource.py 挂载 scene_sales_management
            ↓
        用自然语言结束本轮，**不要要求用户重复已说过的需求**。
        根据场景选择话术：

        通用：
          "我来准备一下数据环境～ 好了！"
          "稍等，我先加载数据～ 好了，继续！"

        新手引导（用户刚说"给我演示一下"）：
          "好的，我先准备一下演示环境～ 马上开始！"

        中途挂载（正在演示中遇到 404）：
          "稍等，数据连接需要刷新一下～ 好了！"

            ↓
        ⚠️ 必须结束当前轮次，等待用户下一轮输入
            ↓
        下一轮 → baiying_call 已可用 → 继续执行用户原请求
        （Agent 需记住上一轮用户需求，不要让人重复）
```

> **关键规则**：挂载回复 **禁止** 包含提问句式（"你想查什么？""请再说一次？"）——Agent 已知道用户要什么，下一轮直接执行即可。

---

## 常见问题场景（FAQ 引导）

用户直接问产品概念时，优先用**演示结果来解释**，而不是直接回答。匹配下表找到场景文件。

> **⚠️ 强制规则（所有场景通用）**：场景演示**必须先执行实际查询/操作并展示返回结果数据**，再用数据解释。**禁止**纯文字描述产品理念而不展示查询结果数据。各场景文件中的 `## 输出格式（强制）` 段为硬性约束，不得跳过。

| # | 用户典型问法 | 处理策略 |
|---|------------|---------|
| 1 | "我是新手""给我演示一下""功能有哪些" | 展示功能清单，等用户选择，见上方"新手引导"块 |
| 2 | "产品理念是什么""你们产品有什么特点" | [scenarios/02-product-philosophy.md](scenarios/02-product-philosophy.md) — 先选理念再演示 |
| 3 | "什么是对象""什么是视图""对象和视图的区别" | [scenarios/03-object-view.md](scenarios/03-object-view.md) |
| 4 | "查询又快又准""数据查询怎么做的" | [scenarios/04-query-performance.md](scenarios/04-query-performance.md) |
| 5 | "你用了本体吗""本体解决了什么问题" | [scenarios/05-ontology-showcase.md](scenarios/05-ontology-showcase.md) |
| 6 | "结构化非结构化融合""异构数据怎么处理" | [scenarios/06-data-fusion.md](scenarios/06-data-fusion.md) |
| 7 | "多跳数据查询""关联查询怎么实现" | [scenarios/07-multi-hop.md](scenarios/07-multi-hop.md) |
| 8 | "数据安全怎么保证""会不会误操作" | [scenarios/08-data-security.md](scenarios/08-data-security.md) |

## 故障排查

> 仅在 baiying_call 调用失败或演示 4/5/6 遇到脚本错误时才需阅读本节。正常演示流程不需要。

### 常见错误速查

| 现象 | 原因 | 处理 |
|------|------|------|
| `baiying_call` 工具不在列表中 / 404 | 视图未挂载 | 执行下方「挂载视图」→ 自然引导用户继续对话 → **结束本轮**（下一轮生效） |
| `baiying_call` 超时 | 后端未响应 | 等 30s 后重试一次 |
| `baiying_call` 返回权限错误 | 视图未授权 | 执行下方「挂载视图」→ 结束本轮等待生效 |
| Python import 失败 | 依赖缺失 | 执行 `bash scripts/setup.sh` 检查环境 |
| 脚本执行报错 | 环境变量缺失 | 执行 `bash scripts/check_env.sh` 检查 |

### 检查视图挂载状态

```bash
# 1. 提取 Agent 的 resource_id（从编码中的数字后缀，如 agent-10014603 → 10014603）
# 2. 查询全部已挂载资源（keyword 按中文名称过滤，可选）
/usr/local/bin/python3 scripts/ontology/structured/list_mounted_resources.py \
  '{"resource_id": <Agent的resource_id>}'

# 3. 在返回的 data 数组中查找 resourceCode == "scene_sales_management"
#    存在 → 已挂载   不存在 → 执行挂载
```

### 挂载视图

```bash
/usr/local/bin/python3 scripts/ontology/structured/mount_resource.py \
  '{"agent_id": <Agent 编码里的数字后缀>, "resource_code": "scene_sales_management"}'
```

> `list_mounted_resources.py` 用于检查某资源是否已挂载到当前 Agent。

### 脚本路径速查

演示 4/5/6 涉及以下脚本（相对于 skill 根目录，通过 `/usr/local/bin/python3` 执行）：

| 脚本 | 用途 |
|------|------|
| `scripts/ontology/structured/list_mounted_resources.py` | 查询 Agent 已挂载的资源 |
| `scripts/ontology/structured/create_object.py` | 创建结构化对象（collect → submit） |
| `scripts/ontology/structured/create_view.py` | 创建本体视图 |
| `scripts/ontology/structured/delete_object.py` | 删除结构化对象 |
| `scripts/ontology/structured/delete_view.py` | 删除本体视图 |
| `scripts/ontology/structured/mount_resource.py` | 挂载资源到当前 Agent |
| `scripts/ontology/structured/unmount_resource.py` | 将当前 Agent资源卸载 |
| `scripts/ontology/structured/list_term_types.py` | 查询可绑定的术语类型 |
| `scripts/ontology/structured/get_term_type_values.py` | 查询术语类型的值列表 |
| `scripts/ontology/unstructured/list_knowledge_bases.py` | 查询可用知识库 |
| `scripts/ontology/unstructured/list_kb_directories.py` | 查询知识库目录 |
| `scripts/ontology/unstructured/create_object.py` | 创建非结构化对象（collect → submit） |
| `scripts/ontology/unstructured/delete_object.py` | 删除非结构化对象 |
| `scripts/ontology/unstructured/mount_resource.py` | 挂载非结构化资源到 Agent |
| `scripts/ontology/unstructured/unmount_resource.py` | 将Agent的非结构化资源卸载 |
| `scripts/ontology/unstructured/list_mounted_resources.py` | 查询 Agent 已挂载的非结构化对象 |
| `scripts/meeting-minutes/generate_meeting_minutes.py` | 生成模拟会议纪要 |
| `scripts/weekly-report/generate_weekly_report.py` | 生成模拟周报 |

---

## 参考文档

| 文档 | 内容 |
|------|------|
| [Python 环境参考](references/python-env.md) | 环境变量、脚本路径约定 |
| [歧义处理指南](references/ambiguity-guide.md) | 五种歧义类型的处理策略与话术模板 |
| [数据操作指南](references/data-operations.md) | 周报格式、字段映射、校验规则、任务创建 |
| [本体对象定义](references/ontology-objects.md) | 对象字段定义、Mock 数据、脚本调用规范 |
