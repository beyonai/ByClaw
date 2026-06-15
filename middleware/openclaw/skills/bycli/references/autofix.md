# AutoFix — 适配器自修复流程

当 `bycli` 命令因网站改版（DOM/API/响应 schema 变化）失败时，自动诊断、修复 adapter 并重试。

---

## Safety Boundaries

**硬停止（不修改代码）：**
- **AUTH_REQUIRED** (exit 77) — 提示用户登录
- **BROWSER_CONNECT** (exit 69) — 提示用户运行 `bycli doctor` + `bycli daemon status` 诊断桥接
- **CAPTCHA / 限流** — 不是 adapter 问题

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
- **COMMAND_EXEC** — adapter 逻辑运行时错误
- **TIMEOUT** — 页面加载方式变化

---

## "Empty" ≠ "Broken"

`EMPTY_RESULT` 常常**不是** adapter bug。进入修复前先排除：

- **换个查询词重试** — 平台可能在做结果限制
- **在普通 Chrome 标签检查** — 如果用户浏览器能看到数据，问题是认证/限流
- **注意软 404** — 某些站返回 HTTP 200 + 空 payload 代替真 404
- **"0 结果"本身是有效答案** — adapter 成功请求到空列表，直接报告用户

只有在**多次重试 + 不同入口点都复现**时才进入修复。

---

## Step 1: 收集 Trace

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

| Error Code | 可能原因 | 修复策略 |
|-----------|---------|---------|
| SELECTOR | DOM 重构，class/id 改名 | 探索当前 DOM → 找新 selector |
| EMPTY_RESULT | API 响应 schema 变化 | 检查 network → 找新响应路径 |
| API_ERROR | 端点 URL 变化 | network intercept 发现新 API |
| TIMEOUT | 页面加载方式变化 | 更新 wait 条件 |
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
| 硬停止 | AUTH/BROWSER_CONNECT/CAPTCHA/限流 | 不修改，报告 |
| 软停止 | 3 轮耗尽 | 报告尝试了什么 |
| 软停止 | 功能完全删除 | 数据不存在了 |
| 软停止 | 大改版 | 转 adapter-author 流程 |