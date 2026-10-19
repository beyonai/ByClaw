[![dshfind](https://dshfind.com/api/card/lehhair/dsh-diff-viewer?lang=zh)](https://dshfind.com/zh/plugins/lehhair/dsh-diff-viewer?ref=badge)

# dsh-diff-viewer

> ByClaw 维护版本：包名为 `@byclaw/dsh-diff-viewer`，从本仓库的 `plugins/dsh-diff-viewer` 安装；上游版本与提交见 [UPSTREAM.md](./UPSTREAM.md)。

DSH Web GUI 的 PiUI 风格 diff 查看器插件：替换 write/edit 工具调用的 diff 渲染（原 DiffBlock）。

- **unified 单栏默认**：同一 gutter 并排显示旧/新行号，无左右错位；split 双栏可选（`viewMode`）
- **变更条**：新增实心绿条、删除条纹红条；行背景色带统一延伸到最宽行
- **词级高亮**：行内改动叠加绿/红标记，shiki 语法着色（`highlightLines`）
- **上下文折叠**：长段未变更行折叠为"`N 行未变更`"，向上/向下/全部展开
- **窗口化渲染**：固定行高窗口化，大 diff 不挂载全部行；sticky 横向滚动条（hover 显现）
- **复制 + `└ +A -R · N file(s)` 页脚**
- **edit 结果默认展开**：settled 的 edit 结果卡展开即见替换 diff（write 保持默认收起）
- **PTC/Code 嵌套支持**：Code Dispatch 内的 write/edit 子卡片同样接管——嵌套子调用没有 wire diff view，插件按工具自身的 `presentCall` 语义从参数推导调用时 diff（edit 的 old_string→new_string、write 的整文件新增），错误子调用保持通用错误路径

## 机制

插件通过 **keyed 接管**替换 write/edit 的工具行渲染：ui-tool 的 `tool.call.toolview` 槽是开放 key 域，同一 key 以**更低 priority 阴影**（最低优先渲染）。插件注册 `edit`/`write` 键（priority -1），接管后的行**完全复刻官方 FileMutationRow**（复用官方 ToolRow 样式 + DisclosureRow/StateDot 等平台组件），只把展开后的 diff 卡换成 PiUI 风格 DiffViewer——**不改任何核心，纯插件**，卸载即还原官方行。

- **不限制高度**：展开的 diff 直接撑开显示完整内容（不套滚动容器），窗口化渲染保证超大 diff 依然高效
- **diff 数据**：从工具调用的 `callView`/`resultView` 的 `card:'diff'` 意图提取（running 用调用时 diff，settled 用应用后的 hunks）；执行错误（无 diff 卡）走官方行的错误摘要 + IN/OUT 卡
- **嵌套兜底**：Code Dispatch 子调用（PTC 模式）的 `callView`/`resultView` 恒为 null（分发桥不落 presentation meta），插件回退到参数的调用时 diff——与官方行渲染同一调用的 running 态一致

## 效果

<img width="1740" height="1048" alt="image" src="https://github.com/user-attachments/assets/67b4db35-07e5-4fce-852d-bbe4ee33b695" />

## 安装

### 方式一：GitHub 仓库直装（源码 + 构建产物）

`lib/` 构建产物**已提交进仓库**，因此 `github:` 直装可直接工作（market 的 Install 按钮即走此路径）：

```sh
dsh plugin --profile web add "github:lehhair/dsh-diff-viewer"
```

> 直装装的是仓库当前 commit 的构建产物。想要跟随最新 commit 请用 Release 资产（见下），它永远指向最新**发版**。

### 方式二：GitHub Release 构建产物（推荐，跟随发版）

每次发版后，GitHub Actions 自动构建并把 tarball 附加到 [Releases](https://github.com/lehhair/dsh-diff-viewer/releases) 页。`releases/latest` 永远指向最新版本，安装链接不需要随版本改动：

```sh
# 直接用 latest 资产 URL（永远是最新版）：
dsh plugin --profile web add "https://github.com/lehhair/dsh-diff-viewer/releases/latest/download/dsh-external-dsh-diff-viewer.tgz"

# 重启 dsh web 生效
dsh web
```

> ⚠️ 升级注意：pnpm 会按 URL 缓存 tarball——同一 `latest` 链接在出新版本后可能命中旧缓存。升级失败/装到旧版时，先 `dsh plugin --profile web remove @byclaw/dsh-diff-viewer`，再 `pnpm store prune`（或删除 `C:\Users\lehhair\AppData\Local\pnpm\store` 对应缓存）后重新安装。

### 开发环境（从源码）

```sh
# devDependencies 用 link: 指向 ../dsh2026/deepseek-harness（本地 deepseek-harness checkout）
pnpm install && pnpm run check    # typecheck + test + build
# 直接安装本地目录，或 npm pack 后装 tarball：
dsh plugin --profile web add E:\dev\dsh-diff-viewer
```

> Windows 注意：`dsh plugin add <本地目录>` 的 `link:` 绝对路径有 junction bug（pnpm 拼错目标）。用 **tarball**（`npm pack` 后 `dsh plugin add *.tgz`）可绕过。

> 发版注意：`lib/` 已提交，源码改动必须同时重建并提交 `lib/`（CI 的 `check` 后会校验 `lib/` 与源码一致，不一致即失败）。

## 卸载

```sh
dsh plugin --profile web remove @byclaw/dsh-diff-viewer
```

## 开发

```sh
pnpm install && pnpm run check    # typecheck + test + build
```

测试需要 workspace 内的 `@deepseek-ai/dsh-*` 包（devDependencies 用 `link:` 指向 `../dsh2026/deepseek-harness`，vitest alias 统一 react 单实例；接管行复用 ui-tool 的 `ToolRow.module.css`，经包导出的 src 子路径内联进 bundle）。

## 友情链接 / Friend Links

- [DSHFind](https://dshfind.com/) — DeepSeek Harness 插件市场与学习社区
