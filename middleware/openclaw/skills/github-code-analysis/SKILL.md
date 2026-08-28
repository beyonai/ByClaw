---
name: github-code-analysis
description: >
  GitHub 代码分析套件。支持：PR 审查、代码质量扫描、安全扫描、性能扫描、
  不一致性检测、自动生成文档。默认仓库 beyonai/ByClaw。
  触发词：review PR、代码扫描、安全检查、性能分析、生成文档、质量报告。
metadata:
  openclaw:
    requires:
      bins: [node]
---

# GitHub 代码分析套件

提供六大能力，覆盖代码全生命周期质量管控：

| 能力 | 触发词示例 | 说明 |
|------|-----------|------|
| PR 审查 | "review PR"、"审查 PR #52" | 拉取 PR diff，四维度分析，写回 comment |
| 代码质量扫描 | "代码质量扫描"、"quality scan" | 扫描仓库/目录的命名、复杂度、重复、一致性 |
| 安全扫描 | "安全扫描"、"security scan" | 检测注入、硬编码 secret、不安全依赖 |
| 性能扫描 | "性能扫描"、"performance scan" | 检测 N+1、内存泄露、阻塞调用 |
| 不一致扫描 | "不一致扫描"、"consistency check" | 检测代码风格/模式/命名不一致 |
| 自动生成文档 | "生成文档"、"generate docs" | 为模块/函数/API 生成 markdown 文档 |

## Default Configuration

- **Default repository**: `beyonai/ByClaw`
- **授权方式**: 平台 GitHub 连接器统一授权
- 用户不指定仓库时使用默认值，无需询问

## Workflow

**IMPORTANT**: Always start by executing Step 0. Do NOT ask the user for a token. Do NOT suggest creating a token. Do NOT mention GITHUB_TOKEN or environment variables.

### Step 0: Check Authorization (MANDATORY FIRST STEP)

Run this command immediately — do not ask the user anything first:

```bash
node skills/github-code-analysis/scripts/gh-pr-list.mjs --limit 1
```

**If `"ok": true`** → proceed based on user intent.

**If `"auth_required": true`** → 展示返回的 `message`，提示用户先在平台连接器中授权 GitHub，然后停止本次 GitHub 操作。连接器授权后的新凭据会在新建或重启沙箱时注入。

**禁止**：不得向用户索要 GITHUB_TOKEN、PAT、Personal Access Token，也不得自行发起第二套 Device Flow。

---

## Mode 1: PR 审查

### When to Use

用户说"review PR"、"审查 PR"、"帮我看看 PR"、"代码审查"等。

### Steps

**Do NOT ask the user for PR number or repo.** Follow this logic:

1. If the user explicitly mentions a PR number (e.g. "review PR #52"), use that number.
2. If the user does NOT specify a PR number, automatically list open PRs and pick the most recently updated one:

```bash
node skills/github-code-analysis/scripts/gh-pr-list.mjs --state open --limit 5
```

Pick the first PR from the result and proceed.

3. Fetch PR data:

```bash
node skills/github-code-analysis/scripts/gh-pr-fetch.mjs --pr <number> --format all
```

4. Read `references/review-prompts.md` for detailed criteria. Analyze across four dimensions:
   - **Security** — 注入、硬编码 secret、不安全依赖、auth 问题
   - **Performance** — N+1 查询、内存泄露、阻塞调用
   - **Quality** — 命名、圈复杂度、重复代码、不一致模式
   - **Test** — 缺失测试覆盖、边界条件

5. Post review comment:

```bash
echo '<json>' | node skills/github-code-analysis/scripts/gh-pr-comment.mjs
```

### Review Output Format

```markdown
## 🔍 PR Review: #{number} {title}

**Reviewer**: ByClaw AI | **Dimensions**: Security, Performance, Quality, Tests

### Summary
{1-2 sentence overview}

### Findings

#### 🔒 Security
{findings or "No issues found"}

#### ⚡ Performance
{findings or "No issues found"}

#### 📐 Quality
{findings or "No issues found"}

#### 🧪 Tests
{findings or "No issues found"}

### Verdict
{approve / needs changes / comment only}

---
*Automated review by ByClaw AI*
```

---

## Mode 2: 代码质量扫描

### When to Use

用户说"代码质量扫描"、"quality scan"、"扫描代码质量"、"检查代码规范"等。

### Steps

1. 确定扫描范围：
   - 用户指定了路径 → 直接使用
   - 用户说"扫描前端" → 用 `byclaw-fe/src`
   - 用户说"扫描后端" → 用 `byclaw-be/src`
   - 用户无具体指定 → 扫描最新 PR 的变更文件

2. Clone 仓库到本地（如已 clone 则自动更新）：

```bash
node skills/github-code-analysis/scripts/gh-repo-clone.mjs
```

脚本输出 `data.path` 即为本地仓库路径。后续直接用 `cat`/`grep`/`find` 等命令读取本地文件分析。

3. 在本地仓库中定位并读取目标文件：

```bash
# 列出目标目录结构
find <repo-path>/byclaw-fe/src -name "*.ts" -o -name "*.tsx" | head -30

# 读取具体文件
cat <repo-path>/byclaw-fe/src/utils/request.ts
```

4. 逐文件分析以下维度：
- **命名规范** — 变量/函数/类/文件命名是否一致（camelCase vs snake_case 混用）
- **圈复杂度** — 深层嵌套（>3层）、超长函数（>50行）
- **代码重复** — 相似逻辑块、copy-paste 模式
- **Dead code** — 未使用的 import、unreachable 分支、注释掉的代码
- **Error handling** — 吞掉的异常、缺少错误类型、generic catch

### Output Format

```markdown
## 📐 代码质量报告

**扫描范围**: {repo/path/PR}
**扫描时间**: {timestamp}

### 统计
- 扫描文件数: N
- 发现问题: N (critical: X, warning: Y, suggestion: Z)

### 问题列表

| 严重度 | 文件 | 行号 | 类别 | 描述 |
|--------|------|------|------|------|
| ⚠️ | src/foo.ts | 42 | 命名 | 混用 camelCase 和 snake_case |
| ... | ... | ... | ... | ... |

### 建议
{top 3 改进建议}
```

---

## Mode 3: 安全扫描

### When to Use

用户说"安全扫描"、"security scan"、"检查安全漏洞"、"有没有安全问题"等。

### Steps

1. 确定扫描范围（同 Mode 2 的逻辑）
2. 确保仓库已 clone 到本地：

```bash
node skills/github-code-analysis/scripts/gh-repo-clone.mjs
```

然后用 `find`/`grep`/`cat` 在本地仓库路径中读取文件。
对于 PR 变更可用：`node skills/github-code-analysis/scripts/gh-pr-fetch.mjs --pr <number> --format files`

3. 按以下维度深度分析：

- **注入漏洞** — SQL injection（字符串拼接查询）、command injection（exec/spawn 未转义）、XSS
- **硬编码 Secret** — API key、token、password、private key 出现在源码中
- **不安全依赖** — 已知漏洞包、typosquatting 包名
- **认证/授权** — 缺少 auth 检查、权限提升路径
- **加密问题** — 弱算法（MD5/SHA1 用于安全场景）、硬编码 IV/salt
- **数据泄露** — 敏感数据进日志、错误信息暴露内部结构

### Output Format

```markdown
## 🔒 安全扫描报告

**扫描范围**: {target}
**风险等级**: {高/中/低}

### 发现

#### Critical
{list or "无"}

#### Warning
{list or "无"}

### 修复建议
{prioritized fix suggestions}
```

---

## Mode 4: 性能扫描

### When to Use

用户说"性能扫描"、"performance scan"、"性能分析"、"有没有性能问题"等。

### Steps

1. 确定扫描范围（同 Mode 2 的逻辑）
2. 获取源码：

```bash
node skills/github-code-analysis/scripts/gh-repo-fetch.mjs --dir <target-path>
# 或针对 PR 变更：
node skills/github-code-analysis/scripts/gh-pr-fetch.mjs --pr <number> --format files
```

3. 按以下维度分析：

- **N+1 查询** — 循环内 DB/API 调用，应改为批量
- **无界操作** — 缺少分页、加载整表、无 LIMIT
- **内存问题** — 大数组全量加载、未关闭资源/句柄
- **阻塞调用** — 异步上下文中的同步 I/O、事件循环上的 CPU 密集操作
- **冗余计算** — 可缓存/memoize 的重复计算
- **网络** — 缺少连接池、无超时、chatty API

### Output Format

```markdown
## ⚡ 性能扫描报告

**扫描范围**: {target}

### 发现

| 严重度 | 文件 | 问题 | 影响 | 建议 |
|--------|------|------|------|------|
| 🔴 | ... | N+1 query in loop | 线性增长延迟 | 改为批量查询 |
| ... | ... | ... | ... | ... |

### 优化优先级
1. {most impactful fix}
2. ...
```

---

## Mode 5: 不一致扫描

### When to Use

用户说"不一致扫描"、"consistency check"、"检查一致性"、"风格不统一"等。

### Steps

1. 确定扫描范围（同 Mode 2 的逻辑）
2. 确保仓库已 clone 到本地：

```bash
node skills/github-code-analysis/scripts/gh-repo-clone.mjs
```

然后用 `find`/`grep`/`cat` 在本地仓库路径中读取文件。

3. 跨文件对比，检测以下不一致：

- **命名风格** — 同一项目中 camelCase/snake_case/PascalCase 混用
- **异步模式** — callback vs Promise vs async/await 混用
- **错误处理** — 有的地方 try-catch，有的地方 .catch()，有的地方不处理
- **导入风格** — default import vs named import 不一致
- **API 风格** — REST 命名不统一（复数/单数、嵌套/扁平）
- **配置模式** — 有的用环境变量，有的用配置文件，有的硬编码
- **日志格式** — 有的结构化，有的 console.log，格式不统一
- **类型使用** — 有的用 interface，有的用 type，有的用 any

### Output Format

```markdown
## 🔄 不一致性报告

**扫描范围**: {target}

### 发现的不一致模式

#### 1. {pattern name}
- **现状**: 文件 A 用 X 方式，文件 B 用 Y 方式
- **涉及文件**: file1.ts, file2.ts, ...
- **建议**: 统一为 {recommended pattern}，原因：{why}

#### 2. ...

### 统一建议
{overall recommendation for consistency}
```

---

## Mode 6: 自动生成文档

### When to Use

用户说"生成文档"、"generate docs"、"写文档"、"API 文档"、"模块文档"等。

### Steps

1. 确定文档目标：
   - 用户指定了文件/模块 → 为该文件生成文档
   - 用户说"为 PR 生成文档" → 为 PR 中新增/修改的公共 API 生成文档
   - 用户说"生成项目文档" → 生成项目结构概览 + 核心模块文档

2. 确保仓库已 clone 到本地：

```bash
node skills/github-code-analysis/scripts/gh-repo-clone.mjs
```

然后用 `find`/`cat` 在本地仓库路径中读取源码。对于 PR 变更可用：
```bash
node skills/github-code-analysis/scripts/gh-pr-fetch.mjs --pr <number> --format files
```

3. 生成文档内容：
   - **模块文档** — 模块职责、导出 API、使用示例
   - **函数文档** — 参数、返回值、异常、使用示例
   - **API 文档** — endpoint、请求/响应格式、认证要求
   - **架构文档** — 模块关系、数据流、关键设计决策

4. 输出为 markdown，可直接用于 README 或 docs/ 目录

### Output Format

```markdown
## 📝 自动生成文档

### {Module/Function/API Name}

**路径**: `src/path/to/file.ts`
**职责**: {one-line description}

#### 导出 API

| 名称 | 类型 | 说明 |
|------|------|------|
| functionA | function | ... |
| TypeB | type | ... |

#### 使用示例

\`\`\`typescript
import { functionA } from "./path";
const result = await functionA(params);
\`\`\`

#### 注意事项
- {important notes}
```

---

## Scripts Reference

| 脚本 | 用途 | 示例 |
|------|------|------|
| `gh-repo-clone.mjs` | Clone 仓库到本地 | `node skills/github-code-analysis/scripts/gh-repo-clone.mjs` |
| `gh-pr-list.mjs` | 列出 PR | `node skills/github-code-analysis/scripts/gh-pr-list.mjs --state open --limit 5` |
| `gh-pr-fetch.mjs` | 拉取 PR 数据 | `node skills/github-code-analysis/scripts/gh-pr-fetch.mjs --pr 52 --format all` |
| `gh-pr-comment.mjs` | 写回 PR comment | `echo '{...}' \| node skills/github-code-analysis/scripts/gh-pr-comment.mjs` |
| `gh-repo-fetch.mjs` | 轻量 API 查询（单文件/目录树） | `node skills/github-code-analysis/scripts/gh-repo-fetch.mjs --tree --path src` |

### gh-repo-clone.mjs 用法

Clone 仓库到 `skills/github-code-analysis/.cache/ByClaw/`：
```bash
node skills/github-code-analysis/scripts/gh-repo-clone.mjs
```

输出 `data.path` 为本地路径。后续直接用标准命令分析：
```bash
# 列出文件
find <path>/byclaw-fe/src -name "*.ts" | head -20

# 搜索模式
grep -rn "password" <path>/byclaw-be/src --include="*.java" | head -20

# 读取文件
cat <path>/byclaw-fe/src/utils/request.ts
```

再次运行时自动 `git pull` 更新，不会重复 clone。用 `--force` 强制重新 clone。

所有脚本默认仓库为 `beyonai/ByClaw`，可通过 `--repo owner/repo` 覆盖。

## Important Notes

- 用户不指定仓库时，默认 `beyonai/ByClaw`，不要问
- 用户不指定 PR 号时，自动选最新的 open PR，不要问
- Only post `REQUEST_CHANGES` when there are critical security or correctness issues
- If the diff is too large (>5000 lines), focus on the most impactful files
- Skip generated files, lockfiles, vendor dirs, node_modules
- 中文回复，除非用户用英文提问
