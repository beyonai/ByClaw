---
name: github-issues-mgmt
description: >
  GitHub Issues 管理。支持：从文字/CSV/Excel 描述中提取需求并批量创建 Issues；
  列出和查询现有 Issues。默认仓库 beyonai/ByClaw。
  触发词：创建 issue、新建任务、导入需求、批量建 issue、列出 issues。
metadata:
  openclaw:
    requires:
      bins: [node]
---

# GitHub Issues 管理

从文字描述、CSV、Excel 中提取需求，自动创建 GitHub Issues。也可列出/查询现有 Issues。

## Default Configuration

- **Default repository**: `beyonai/ByClaw`
- **授权方式**: 平台 GitHub 连接器统一授权

## Workflow

**IMPORTANT**: Always start by executing Step 0. Do NOT ask the user for a token. Do NOT suggest creating a token. Do NOT mention environment variables.

### Step 0: Check Authorization (MANDATORY FIRST STEP)

```bash
node skills/github-issues-mgmt/scripts/gh-issues-list.mjs --limit 1
```

**If `"ok": true`** → proceed based on user intent.

**If `"auth_required": true`** → 展示返回的 `message`，提示用户先在平台连接器中授权 GitHub，然后停止本次 GitHub 操作。连接器授权后的新凭据会在新建或重启沙箱时注入。

**禁止**：不得向用户索要 GITHUB_TOKEN、PAT、Personal Access Token，也不得自行发起第二套 Device Flow。

---

## Mode 1: 从文字/CSV/Excel 创建 Issues

### When to Use

用户提供了一段文字描述、CSV 内容、或 Excel 文件路径，要求创建 Issues。

### Steps

1. **解析用户输入**：
   - 纯文字 → 提取每个独立的需求/任务/bug 作为一个 issue
   - CSV 内容 → 按行解析，每行一个 issue（识别 title/body/labels 列）
   - Excel 文件路径 → 提示用户先转为 CSV 或直接粘贴内容

2. **确认 issue 列表**：向用户展示将要创建的 issues 摘要，确认后再创建：

```
即将创建 N 个 Issues：
1. [bug] 标题1 — 描述摘要
2. [feature] 标题2 — 描述摘要
...
确认创建？
```

3. **批量创建**：

```bash
echo '{
  "issues": [
    {"title": "标题1", "body": "详细描述", "labels": ["bug"]},
    {"title": "标题2", "body": "详细描述", "labels": ["feature"]}
  ]
}' | node skills/github-issues-mgmt/scripts/gh-issues-create.mjs
```

4. **报告结果**：展示创建成功的 issue 链接列表。

### 解析规则

从文字中提取 issues 时：
- 每个独立的需求/任务/问题 → 一个 issue
- 自动推断 labels：包含"bug"/"缺陷"/"修复" → `bug`；包含"功能"/"新增"/"feature" → `enhancement`；包含"优化"/"改进" → `improvement`
- title 简洁（<80字），body 包含完整描述
- 如果文字中有优先级信息，加到 body 中

从 CSV 中提取 issues 时：
- 自动识别列名：title/标题、body/描述/内容、labels/标签、assignees/负责人
- 如果没有明确列名，第一列为 title，第二列为 body

---

## Mode 2: 列出/查询 Issues

### When to Use

用户说"列出 issues"、"有哪些 bug"、"查看待办"等。

### Steps

```bash
# 列出所有 open issues
node skills/github-issues-mgmt/scripts/gh-issues-list.mjs --state open --limit 20

# 按标签过滤
node skills/github-issues-mgmt/scripts/gh-issues-list.mjs --labels bug --limit 10

# 列出已关闭的
node skills/github-issues-mgmt/scripts/gh-issues-list.mjs --state closed --limit 10
```

展示结果时用表格格式：

| # | 标题 | 标签 | 负责人 | 更新时间 |
|---|------|------|--------|----------|
| 1 | ... | bug | user1 | 2026-05-28 |

---

## Scripts Reference

| 脚本 | 用途 |
|------|------|
| `gh-issues-create.mjs` | 批量创建 issues（stdin JSON） |
| `gh-issues-list.mjs` | 列出/查询 issues |

## Important Notes

- 创建 issues 前必须先向用户确认，不要静默创建
- 默认仓库 `beyonai/ByClaw`，不需要问用户
- 中文回复
