# 跟随 DSH 的 i18n（ctx.locale）设计

> 2026-08-12 · 随 v0.8.2 发布

## 背景

better-sidebar 的界面文案（约 260 处 `t()` 调用、28 个文件）此前自带 zh/en 词典并直接读
`navigator.language`（`src/client/locales.ts` 头注释曾明言"renders outside the slot
system's locale seat, so it reads the browser language directly"）。问题：

- DSH 的语言偏好是 Host-backed（`locale.preference`，存于 `$DSH_HOME/settings.yaml`），
  用户设置与浏览器语言不一致时侧边栏不跟随（如偏好 zh、浏览器 en 时侧边栏仍为英文）。
- 词典游离在 DSH 的 i18n 注册表之外，无法参与公共命名空间回退等机制。

DSH 的 i18n 系统（`@deepseek-ai/dsh-client-locale`）：

- `ctx.locale` 服务（client-only）：`getSnapshot()/subscribe()` 是 LocaleFace
  （uSES 安全，revision 递增），`locale/change` 事件在切换时触发；
- `ctx.locale.register(ns, {zh, en})` 命名空间词典注册（typed 变体要求合并
  `LocaleNamespaceMap`）；查询链 ns → common → zh → key；
- 所有 DSH 客户端包以 `inject = [..., 'locale']` 消费。

## 设计决策

1. **结构镜像服务**（仓库惯例，`src/context-types.ts` 头注释）：本插件解析在 DSH
   monorepo 单一 cordis 实例之外，上游 `declare module 'cordis'` augmentation 不达此
   Context。新增 `SidebarLocaleService` 结构脸（只镜像用到的切片：
   `getSnapshot` / `subscribe` / `register`），merge `Context.locale`。不引入
   `@deepseek-ai/dsh-client-locale` 依赖、不做 value import（client bundle 纯度门）。
2. **保留模块级 `t()`**：`t()` 被 28 个文件使用，穿 props 不可行。改为模块级 holder：
   `apply()` 调 `attachLocale(ctx.locale)`，`t()`/`isZh()` 从 holder 读活跃 locale；
   无 holder 时回退既有 `navigator.language` 检测（行为与改动前完全一致，也是 jsdom
   测试与非标准组合的降级路径）。
3. **根级重渲染触发**：侧边栏自行 `createRoot` 挂在 slot 系统之外，拿不到 `t` seat。
   在 `Sidebar.tsx` 根组件加 `useSyncExternalStore(ctx.locale.getSnapshot/subscribe)`
   （该文件已用此 API 订阅 sessions/store）；树内无 `React.memo`，根重渲染即整树
   重渲染，所有渲染期 `t()` 求值读到新语言。事件期调用（intercept、api、subagent-tasks）
   在调用时刻读当前语言，天然正确。SideCardSection 由 settings shell 渲染，shell 自身
   订阅 locale revision（ui-settings-general 的 section rows 缓存含 locale revision），
   自动跟随。
4. **命名空间 `'betterSidebar'`**：`'sidebar'` 已被 DSH 的 ui-sidebar 占用。注册走
   非类型化单语言重载 `register(ns, locale, dict)`（DSH 内 ui-permission 同款先例）；
   键型安全由本地 `const en: Record<keyof typeof zh, string>` + 测试键集相等断言保证。
5. **词典注册进 DSH 注册表**：`ctx.effect` 内注册 zh/en 并返回合并 disposer
   （fiber 卸载时撤销，HMR 重激活不抛 "already registered"）。
6. **xlsx 预览的 Univer locale pack**：`xlsx-view.tsx` 原内联 navigator 检测改走
   `isZh()`（跟随 DSH 语言；Univer 实例在挂载时创建，语言切换不重建实例——可接受）。

## 实施偏差记录

- 无。计划与实施一致。
- 版本号随 v0.8.2 发版提交（`package.json` + `dsh.plugin.json`）。
- v0.8.2 后补遗：md 预览（`TextEditor.tsx`）的代码块复制按钮文案——DSH 的
  `MarkdownText`/`CodeBlock` 是 cordis-free 组件，未传 `codeLabels` 时回退到硬编码中文
  「复制/复制成功」。修复为渲染时传入 `codeLabels={{ copyLabel: t('copy'), copiedLabel: t('copied') }}`
  （对齐 DSH 聊天区 `AssistantMarkdown` 的做法），新增 `tests/markdown-copy-labels.spec.tsx`
  钉住 zh/en 跟随。

## 验收

- `pnpm typecheck` / `pnpm test` / `pnpm build`（纯度门）全绿；`tests/locales.spec.ts`
  覆盖：无服务回退、attach 后跟随活跃 locale 实时切换、detach 恢复回退、占位符插值、
  relativeTime 链路、命名空间名、zh/en 键集相等。
- 手动：设置页切换语言 → 侧边栏全部文案实时切换；`locale.preference: zh` 且浏览器 en
  → 侧边栏中文。
