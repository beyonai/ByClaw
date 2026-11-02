# ByClaw DSH 实时会话状态实施计划

> 设计依据：`docs/superpowers/specs/2026-09-01-byclaw-dsh-realtime-session-status-design.md`

## Task 1：修复 Agent Teams 最终回合竞态

**Files**

- Modify: `plugins/byclaw-integration/src/session-runtime.ts`
- Modify: `plugins/byclaw-integration/scripts/worker-verify.mjs`
- Modify: `plugins/byclaw-integration/scripts/async-turn-completion-verify.mjs`

**TDD**

1. 添加失败用例：终态团队快照不能立即 resolve gate。
2. 添加失败用例：终态快照之后，必须观察到队长新的 completed `turn/end` 才完成。
3. 运行：

   ```bash
   pnpm build
   node scripts/worker-verify.mjs
   node scripts/async-turn-completion-verify.mjs
   ```

4. 最小实现两阶段 quiescent/finalized gate，再运行相同命令至通过。

## Task 2：插件发布 DSH 聚合运行态

**Files**

- Modify: `plugins/byclaw-integration/src/session-runtime.ts`
- Modify: `plugins/byclaw-integration/src/byclaw-presentation.ts`
- Modify: `plugins/byclaw-integration/src/protocol.ts`
- Modify: `plugins/byclaw-integration/scripts/presentation-verify.mjs`
- Add: `plugins/byclaw-integration/scripts/runtime-status-verify.mjs`
- Modify: `plugins/byclaw-integration/package.json`

**TDD**

1. 添加失败用例，覆盖：根 Agent running、两个子 Agent running、计数下降、等待用户、最终 idle、
   状态不变不重复发送、revision 单调。
2. 添加失败用例，断言 `session.runtime` metadata 使用父会话 scope，并包含活动计数和 revision。
3. 运行新用例，确认因缺少运行态聚合器/投影而失败。
4. 实现 `agent/status` 监听、lineage 归属、状态聚合和投影。
5. 运行：

   ```bash
   pnpm build
   node scripts/runtime-status-verify.mjs
   node scripts/presentation-verify.mjs
   pnpm verify
   ```

## Task 3：BE 消费并持久化 DSH 运行态

**Files**

- Add: `byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/chat/dto/DshSessionRuntimeState.java`
- Add: `byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/chat/service/DshSessionRuntimeStateService.java`
- Modify: `byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/chat/service/SessionStreamEventRouter.java`
- Modify: `byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/chat/service/RunningOutputStreamRegistry.java`
- Modify: `byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/chat/dto/RunningChatInfo.java`
- Add: `byclaw-be/src/test/java/com/iwhalecloud/byai/state/domain/chat/service/DshSessionRuntimeStateServiceTest.java`
- Modify: `byclaw-be/src/test/java/com/iwhalecloud/byai/state/domain/chat/service/SessionStreamEventRouterScopedSessionTest.java`
- Modify: `byclaw-be/src/test/java/com/iwhalecloud/byai/state/domain/chat/service/RunningOutputStreamRegistryTest.java`

**TDD**

1. 添加失败用例：新 revision 更新状态，旧 revision 被忽略，旧 trace idle 不清新 trace。
2. 添加失败用例：`session.runtime` 被路由但不进入聊天正文，并广播
   `SESSION_RUNTIME_STATUS`。
3. 添加失败用例：请求运行标记缺失但 DSH 为 running 时，`getRunning()` 仍返回 running；idle
   时回落为 false。
4. 运行定向测试：

   ```bash
   JAVA_HOME=/Users/chenxiaofeng/software/jdk-21.0.9.jdk/Contents/Home \
     ./mvnw -pl byclaw-be -Dtest=DshSessionRuntimeStateServiceTest,SessionStreamEventRouterScopedSessionTest,RunningOutputStreamRegistryTest test
   ```

5. 最小实现后重复运行，再运行相关 chat 测试和 BE 编译。

## Task 4：FE 消费并展示服务端运行态

**Files**

- Modify: `byclaw-fe/src/utils/chatSessionRuntimeManager.ts`
- Modify: `byclaw-fe/src/utils/__tests__/chatSessionRuntimeManager.test.ts`
- Modify: `byclaw-fe/src/hooks/useGlobalChatRuntime.ts`
- Modify: `byclaw-fe/src/hooks/__tests__/useGlobalChatRuntime.test.tsx`
- Modify: `byclaw-fe/src/hooks/useChat/index.ts`
- Modify: `byclaw-fe/src/components/ChatLayoutComp/index.tsx`
- Modify: `byclaw-fe/src/components/WorkspaceSider/index.tsx`

**TDD**

1. 添加失败用例：运行事件建立服务端 runtime；旧 revision idle 不清状态；waiting_user 设置等待输入；
   新 revision idle 清理。
2. 添加失败用例：全局 hook 注册/注销 `SESSION_RUNTIME_STATUS` 并将消息应用到 manager。
3. 添加状态文案单元测试，覆盖根处理中、N 个成员处理中、等待用户。
4. 运行：

   ```bash
   npm test -- --runInBand \
     src/utils/__tests__/chatSessionRuntimeManager.test.ts \
     src/hooks/__tests__/useGlobalChatRuntime.test.tsx \
     src/hooks/__tests__/useChat.index.test.ts
   ```

5. 最小实现后重复运行，并执行 FE TypeScript/Jest 相关回归。

## Task 5：构建与端到端验收

1. 构建最新插件包并安装到本地 DSH profile。
2. 使用 JDK 21、`envs/229/.env` 启动 ByClaw BE/FE；先登录，再启动 DSH。
3. 确认 DSH master 与 `origin/master` 一致，并在依赖变动时执行 `pnpm install --frozen-lockfile`。
4. 在《测试研发项目》发送固定用例：

   ```text
   @ByClaw研发专家团 让各个成员做下自我介绍
   ```

5. 同时记录：

   - DSH 根/子 Agent status 与最终队长回合。
   - `byai_gateway:session:<sessionId>:data_stream` 的 runtime、子会话和终态事件顺序。
   - BE `runningStatus` 的 start → active members → idle 变化。
   - FE 当前会话、侧边栏、四个子会话和最终汇总。
   - `.sessions/<sessionId>` 四份落盘文件。

6. 执行最终验证：

   ```bash
   git diff --check
   pnpm --dir plugins/byclaw-integration verify
   JAVA_HOME=/Users/chenxiaofeng/software/jdk-21.0.9.jdk/Contents/Home ./mvnw -pl byclaw-be -DskipTests compile
   npm --prefix byclaw-fe test -- --runInBand <相关测试文件>
   npm --prefix byclaw-fe run build
   ```

7. 等待 CodeGraph 文件 watcher 更新后，分别检查 `byclaw-dsh`、`deepseek-harness` 和 ByClaw
   索引状态及新增符号可见性。
