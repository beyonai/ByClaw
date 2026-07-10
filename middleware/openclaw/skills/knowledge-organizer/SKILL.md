---
name: knowledge-organizer
description: 对已上传或收集的文档资料进行知识整理时使用。调度 gbrain/document-object-split/doc-tagger 三个子技能协作完成全流程：gbrain 记忆写入 → 对象类型动态拆分 → 逐文件对象打标。触发词：整理文档/帮我整理/知识整理/整理资料。
triggers:
  - "整理文档"
  - "帮我整理"
  - "整理这份资料"
  - "知识整理"
  - "文档整理"
  - "整理上传的文件"
  - "整理一下"
---

# 知识整理（knowledge-organizer）

## 整体架构

本 skill 为元技能，负责调度三个子技能完成知识整理全流程：

| 阶段 | 调用子技能 | 职责 |
|------|-----------|------|
| Phase 1 | gbrain | 将文档写入 gbrain 记忆（hub 页） |
| Phase 2 | document-object-split | 动态获取 Ontology 对象类型列表 |
| Phase 3 | document-object-split | 按对象类型拆分文档，每实例一页 |
| Phase 4 | doc-tagger | 逐文件匹配对象打标录入 |

---

## Phase 1: 写入 gbrain hub 页

调用 `skills/gbrain/SKILL.md`，将文档内容写入 brain 作为 hub 页。

**Hub 写入规范：**
- slug 格式：`sources/{kebab-title}`
- frontmatter 必须包含字段：
  - `source_kind: knowledge-organizer`
  - `object_codes_snapshot: []` — Phase 2 加载后补充
  - `object_names_snapshot: []` — Phase 2 加载后补充
- body 预留各对象类型的 Index 节（Phase 3 后回填）

---

## Phase 2: 动态加载 Ontology 对象类型

调用 `skills/gbrain/references/document-object-split/scripts/get_object_detail.py`，从 openclaw 实时获取当前数字员工挂载的所有 OBJECT 类型。

```bash
/usr/local/bin/python3 /app/skills/gbrain/references/document-object-split/scripts/get_object_detail.py '{"objectCode": "待查询对象的ID"}'
```

**关键约束：**
- 必须动态获取，不固定、不硬编码任何对象列表
- 若 openclaw 接口 500，记录错误，继续仅做 gbrain 写入，向用户说明
- 将获取到的 `object_codes_snapshot` 和 `object_names_snapshot` 写回 hub frontmatter

**page_prefix 推断规则：**

| object_name | page_prefix |
|------------|-------------|
| Bug / Bug 管理对象 | `bugs` |
| 需求管理对象 / 需求 | `requirements` |
| 产品对象 | `products` |
| 订单对象 | `orders` |
| *其他类型* | `object_name` 对应 kebab-case 复数形式 |

---

## Phase 3: 按对象类型拆分文档

调用 `skills/gbrain/references/document-object-split/SKILL.md` Phase 3 子流程。

**核心原则：**
- N 个对象实例 → N 个 page，禁止合并
- 拆分粒度完全由 Phase 2 获取到的 `object_types[]` 驱动
- 每实例生成稳定 slug：`{page_prefix}/{stable-kebab-slug}`
- 每实例调用一次 `gbrain put`

**Page 内容规范：**
- frontmatter：元数据 + property_code 取值
- 正文三层：Properties 表格 → 描述 → Source（含回链 hub）
- 不得将整篇文档粘贴进 page

**拆分完成后更新 hub Index 节：**
```markdown
## {对象名称} Index
- [实例标题]({slug})
```

---

## Phase 4: 逐文件对象打标

调用 `skills/doc-tagger/SKILL.md` 子流程。

### 4.1 确定打标范围

只打当前任务拆分出的对象 page：
- hub 源文档页 → 跳过（无匹配对象时）
- 对象 page（Bug/需求/产品/订单等）→ 逐个打标

### 4.2 逐文件打标规范

对每个需打标的对象 page：

**Step 1:** 读取完整内容（`gbrain get {slug}`）

**Step 2:** 根据 page 的 `object_type_label` 或 `object_code` 在 openclaw OBJECT 资源中查找对应 `resource_id`

**Step 3:** 调用 `baiying_call` 打标（**每个文件单独一次调用**）：

```
resource_id: <匹配到的对象resource_id>
resource_type: OBJECT
query: "请根据以下文档内容进行结构化打标录入：
文档路径：{文件实际路径}
文档内容：{完整文档原文，不得截断或省略任何内容}

请提取文档中的关键信息，完成字段录入。"
```

**禁止事项：**
- 批量调用，必须逐文件单独调用
- 截断或摘要文档内容
- 打标前告知用户录入结果
- 为无匹配对象的文件强制打标

## Phase 5: 完成，输出清单

向用户输出结构化报告：
```text
✅ 知识整理完成

📄 文档来源：{hub_title}
📦 识别到的对象类型：{object_names.join(', ')}

📊 拆分结果（共 N 个 page）

📋 打标结果（共 M 个文件）
```

---

## 中断恢复与后续流程提示（核心规范）

**本流程分两个独立交互阶段，中间允许用户中断或确认：**

| 阶段 | 触发时机 | 用户操作 | AI 行为 |
|------|---------|---------|---------|
| **阶段 A：整理入库** | 用户说「整理」「帮我整理」 | 可在「导出并打标/导出/确认」处中断 | Phase 1→3 完成后，主动告知「阶段 A 已完成，阶段 B 待执行」并列出后续步骤 |
| **阶段 B：打标录入** | 用户确认或直接说「打标」 | 可在说「跳过/暂时不要打标」处中断 | 打标完成后，告知「全流程完毕」 |

**阶段 A 完成后，必须告知用户的 5 项信息（无论用户是否继续）：**

1. **已完成**：拆分了多少个 page、各是什么（清单列出 slug）
2. **导出的目录**：本次导出的工作空间路径
3. **阶段 B 待执行**：打标还未做，还需调用 doc-tagger
4. **阶段 B 包含什么**：逐文件调用 Bug/需求等对象进行知识库录入
5. **如何继续**：说「继续打标」或「打标」即可，无需重复整理

**示例阶段 A 完成的提示语：**

```text
📦 整理完成！

本次导出了 N 个文件至：`./gbrain-doc-split-2026XXXX-XXXXXX/`

✅ 已完成（阶段 A）：
  - 源文档 hub + N 个对象 page 已写入 brain
  - 文件已导出至工作空间

⏳ 待继续（阶段 B）：
  - 打标录入：逐文件调用 Bug 对象进行知识库录入

→ 接下来：说「继续打标」即可一键完成，无需重复整理步骤。
```

**禁止：**
- 阶段 A 完成后不告知用户还有阶段 B
- 用户中断后不告知如何继续
- 将阶段 B 的打标结果预测性告知用户（必须等实际调用返回）

---

## 错误处理

| 场景 | 处理方式 |
|------|---------|
| Phase 2 openclaw 接口 500 | 记录错误，继续仅做 gbrain 写入，向用户说明 |
| 打标接口部分失败 | 向用户说明哪些文件打标失败、哪些成功，不要因为部分失败停止整个流程 |
| 文档读取失败 | 向用户说明，询问重试或跳过 |
| 打标调用失败 | 记录失败文件及原因，继续其他文件 |

---

## 反模式

- 固定硬编码对象列表（必须动态获取）
- 批量调用 `baiying_call`（必须逐文件）
- 打标前告知用户录入结果
- 将多条实例合并进同一 page
- 截断文档内容传给打标接口
- 阶段 A 完成后不告知阶段 B 待执行
- 用户中断后不告知如何继续后续流程
