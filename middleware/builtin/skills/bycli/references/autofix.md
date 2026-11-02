# AutoFix — 适配器自修复流程

当 `bycli` 命令因网站改版（DOM/API/响应 schema 变化）失败时，自动诊断、修复 adapter 并重试。

---

## Safety Boundaries

**硬停止（不修改代码）：**
- **AUTH_REQUIRED** (exit 77) — 提示用户登录
- **BROWSER_CONNECT** (exit 69) — 不修改 adapter；未经过微信 Runner 的任务先按主 skill 用 DSH `browser` 工具的 `status` 确认托管配置与租约所有权，再执行 `node /app/skills/bycli/scripts/bridge-bootstrap.mjs --format json` 有界观测。Runner 已返回最终 bridgeCode 时外层不再次调用入口。`BRIDGE_UNAVAILABLE` 或 `BRIDGE_RECOVERY_BUSY` 结束本次调用并报告；进程恢复由 browserd/supervisor 管理，不自行启动 Chromium 或重启 daemon
- **CAPTCHA / 限流** — 不是 adapter 问题
- **执行原因或业务结果不确定 / 已终结操作** — 保留原错误、trace 和产物，不为收集新 trace 重放写操作或绕过 Runner/Gate 终态

**作用域：**
- 仅修改 trace `summary.md` frontmatter 中 `adapterSourcePath` 指向的文件
- 禁止修改 `src/`、`extension/`、`tests/`、`package.json`、`tsconfig.json`

**重试预算：** 每次失败最多 3 轮（diagnose → fix → retry）

---

## 触发条件

`bycli <site> <command>` 失败且错误码为可修复类型：
- **SELECTOR** — 元素未找到（DOM 改变）
- **EMPTY_RESULT** — 无数据返回（API 响应变化）
- **API_ERROR** / **NETWORK** — 端点移动或中断
- **PAGE_CHANGED** — 页面结构不再匹配
- **COMMAND_EXEC** — 已有证据确认 adapter 逻辑运行时错误，且当前操作允许重试
- **TIMEOUT** — 先分类；只有已确认 adapter 等待条件失配且允许重试才进入修复

---

## "Empty" ≠ "Broken"

`EMPTY_RESULT` 常常**不是** adapter bug。进入修复前先排除：

- **换个查询词重试** — 平台可能在做结果限制
- **对照用户已提供的普通 Chrome 结果** — 普通 Chrome 有数据仅说明执行环境存在差异；可能涉及认证、限流、工具注入兼容性、旧 TAB/target 状态、等待条件或偶发网络错误。依据已有证据排查，不直接归因为认证/限流，不换账号或 session 绕过错误；认证与人工验证期间不得为对照补查页面
- **注意软 404** — 某些站返回 HTTP 200 + 空 payload 代替真 404
- **"0 结果"本身是有效答案** — adapter 成功请求到空列表，直接报告用户

只有已有证据确认 adapter 与实际页面/API 不匹配，且主 skill 与站点 reference 允许重试时，才进入修复；不得以“验证是否复现”为由循环请求、重复写操作或重置逻辑操作指纹。

---

## Step 1: 收集 Trace

先完成下方执行原因分类；只有允许重试的 adapter 失配才执行本步。认证/人工验证、原因或业务结果不确定、已终结的 Runner/Gate 操作只使用已有 trace 与产物，不重跑本命令。

```bash
bycli <site> <command> [args...] --trace retain-on-failure 2>trace-error.yaml
```

失败时 stderr 包含 `trace` 块：

```yaml
trace:
  traceId: "..."
  dir: "/path/to/traces/..."
  summaryPath: "/path/to/traces/.../summary.md"
```

读取 `summaryPath`。它是 LLM 导向入口，frontmatter 包含：

```yaml
---
adapterSourcePath: "/path/to/clis/example/search.js"
errorCode: "SELECTOR"
errorMessage: "Could not find element: .old-selector"
---
```

Trace 目录还有：`trace.jsonl`、`network.jsonl`、`console.jsonl`、`state/`、`screenshots/`

---

## Step 2: 分析失败

先读取已返回的结构化错误、现有 trace 和本地产物，区分认证/验证、桥接连接、adapter 等待条件失配与执行结果不确定。TIMEOUT、空结果、普通 Chrome 正常或 `BRIDGE_READY` 本身都不能证明目标 JS 暂停、登录失效或网站改版。

仅底层返回与当前目标匹配的 `Debugger.paused` 或等价明确暂停证据时，才报告 JS 被暂停；未提供暂停检测能力或证据时，标记执行原因/结果不确定并停止，不声称已检测到暂停，不自动 resume、不新增虚构检查 API、不通过修改 wait 或重启共享进程掩盖原因。微信专属认证/终态规则优先，不清理 Gate state、改变参数或新建指纹重放。

工具更新与旧 TAB 的迁移只按主 skill「工具更新与旧 TAB」执行。更新运行文件、daemon 重连或 confirmed-rerun 不会自动替换已有文档注入；认证等待、未保存编辑与不确定写保持上下文。

| Error Code | 可能原因 | 修复策略 |
|-----------|---------|---------|
| SELECTOR | DOM 重构，class/id 改名 | 探索当前 DOM → 找新 selector |
| EMPTY_RESULT | API 响应 schema 变化 | 检查 network → 找新响应路径 |
| API_ERROR | 端点 URL 变化 | network intercept 发现新 API |
| TIMEOUT | 原因可能是认证、桥接、等待条件或执行不确定 | 先分类；仅确认 adapter 等待条件失配且允许重试时更新 wait |
| PAGE_CHANGED | 大改版 | 可能需要 adapter 重写 |

**关键问题：**
1. Adapter 试图做什么？（读 `adapterSourcePath`）
2. 失败时页面什么样？（`summary.md` → `state/`）
3. 发生了什么网络请求？（`network.jsonl`）
4. Adapter 期望 vs 页面实际的差距？

---

## Step 3: 探索当前网站

使用 `bycli browser` 检查活站点。**不要用坏掉的 adapter**。

### DOM 变化 (SELECTOR)

```bash
bycli browser open https://example.com/target-page && bycli browser state
```

### API 变化 (API_ERROR, EMPTY_RESULT)

```bash
bycli browser open https://example.com/target-page && bycli browser state
bycli browser click <N> && bycli browser network
bycli browser network --filter author,text,likes
bycli browser network --detail <key>
```

---

## Step 4: 修补 Adapter

仅修改 `adapterSourcePath` 指向的文件。

### 常见修复

```typescript
// Selector 更新
// Before: page.evaluate('document.querySelector(".old-class")...')
// After:  page.evaluate('document.querySelector(".new-class")...')

// API 端点变化
// Before: fetch('/api/v1/old-endpoint')
// After:  fetch('/api/v2/new-endpoint')

// 响应 schema 变化
// Before: const items = data.results
// After:  const items = data.data.items

// Wait 条件更新
// Before: await page.wait({ selector: '.loading-spinner', hidden: true })
// After:  await page.wait({ selector: '[data-loaded="true"]' })
```

### 修补规则

1. **最小改动** — 只修坏的部分，不重构
2. **保持输出结构** — `columns` 和返回格式不变
3. **API 优于 DOM** — 发现 JSON API 时优先用它
4. **仅用 `@sovovs/bycli/*` 导入** — 不加第三方包
5. **修后必测** — 重新运行验证
6. **禁止放宽 fixture** — fixture 失败说明 adapter 输出错了，修 adapter

---

## Step 5: 验证修复

```bash
bycli <site> <command> [args...]
```

仍失败 → 回 Step 1 收集新 trace。3 轮后仍失败 → 停止并报告。

---

## Step 6: 提交上游 Issue

**仅在本地修复验证通过后**提交。

**不提交的场景：** AUTH_REQUIRED、BROWSER_CONNECT、CAPTCHA、限流、3 轮未修复。

**流程：**
1. 准备 issue（title: `[autofix] <site>/<command>: <error_code>`）
2. **先问用户是否同意提交**
3. 用户同意且 `gh auth status` OK：

```bash
gh issue create --repo sovovs/byCLI \
  --title "[autofix] <site>/<command>: <error_code>" \
  --body "..."
```

---

## 停止条件

| 类型 | 条件 | 行为 |
|------|------|------|
| 硬停止 | AUTH/CAPTCHA/限流，或 bridge-bootstrap 最终返回 `BRIDGE_UNAVAILABLE` / `BRIDGE_RECOVERY_BUSY` | 不修改；只报告已有最终状态，不由外层重复恢复 |
| 硬停止 | 执行原因/业务结果不确定、明确 JS 暂停或 Runner/Gate 操作已终结 | 保留错误与产物；不自动 resume、重放或重置指纹 |
| 软停止 | 3 轮耗尽 | 报告尝试了什么 |
| 软停止 | 功能完全删除 | 数据不存在了 |
| 软停止 | 大改版 | 转 adapter-author 流程 |
