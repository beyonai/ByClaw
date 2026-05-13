# src 全量单元测试计划（修订完整版）

## 1. 修订说明

旧版 `docs/unit-test-plan.md` 只覆盖了部分高 ROI 文件，重点放在 `src/pages/manager/` 的纯函数、少量 hooks/models/services，没有把整个 `src/` 的模块范围纳入统一汇总，导致：

- `src/utils/`、`src/service/`、`src/models/`、`src/hooks/` 的存量与增量任务没有统一登记
- `src/components/`、`src/pages/` 只按少量样本列举，没有形成全量模块盘点
- 文档中的文件数量、测试基础设施状态和验证口径已落后于当前仓库

本次修订目标：

- 把 `src/` 下全部源码文件纳入计划汇总
- 将“按文件列”与“按子模块列”结合，兼顾完整性与可维护性
- 明确优先级、测试类型、产出方式和验收口径
- 保留 3 阶段推进思路，但不再把范围错误地限制在少量样本文件

## 2. 当前仓库快照

基于当前仓库实际统计：

| 区域 | 源文件数 | 测试文件数 | 说明 |
|---|---:|---:|---|
| `src/utils` | 50 | 43 | 纯函数密集，适合高覆盖 |
| `src/service` | 25 | 20 | 薄封装多，适合快速补齐 |
| `src/models` | 11 | 13 | Store / model 逻辑少但关键 |
| `src/hooks` | 41 | 30 | 有较大补测空间 |
| `src/components` | 303 | 1 | UI 组件多，需按子模块拆分 |
| `src/pages` | 374 | 19 | 页面级逻辑需按业务域拆分 |
| `src/pages/manager` | 192 | 19 | 管理端已补齐一批高价值测试 |
| `src/pages/manager/utils` | 19 | 6 | 已覆盖主要纯函数 |
| `src/pages/manager/components` | 41 | 4 | 已覆盖一批工具函数组件 |
| `src/pages/manager/models` | 10 | 3 | 已覆盖高价值辅助函数 |
| `src/pages/manager/service` | 13 | 5 | 已覆盖核心 manager service |

总计：

- 非测试源码文件：`897`
- 测试文件：`126`

## 3. 计划原则

### 3.0 状态定义

文档中的状态字段统一使用以下口径：

| 状态 | 含义 |
|---|---|
| `已覆盖` | 已有稳定测试，当前阶段无需补测或只需零星维护 |
| `部分覆盖` | 已有部分测试，但仍有明显空白，需要继续补齐 |
| `未覆盖` | 当前几乎没有有效测试，需要纳入后续批次 |
| `不建议做单测` | 更适合集成测试 / E2E / 人工验证，单测收益低 |

### 3.1 优先级

按以下顺序推进：

1. 纯函数 / 数据转换函数
2. service 薄封装
3. zustand / model 辅助函数
4. hooks
5. 组件内独立工具函数
6. 复杂交互组件
7. 页面级容器与集成行为

### 3.2 计划粒度

为了同时满足“全量汇总”和“计划可执行”，文档采用两种粒度：

- 纯逻辑目录：按文件逐一列出
  - 适用目录：`src/utils`、`src/service`、`src/models`、`src/hooks`
  - 适用子域：`src/pages/manager/utils`、`src/pages/manager/models`、`src/pages/manager/service`
- 重 UI 目录：按子模块 / 子目录全量汇总
  - 适用目录：`src/components`、`src/pages`、`src/pages/manager/components`
  - 这些目录文件数量大、组件耦合度高，逐文件硬列会迅速失真，不利于维护

### 3.3 验收标准

- 每一轮新增测试都必须跑通：`npx jest --passWithNoTests --runInBand`
- 服务层、纯函数层优先追求高覆盖率
- 页面与复杂 UI 不强求逐文件 80%+，以关键行为和高风险逻辑为目标
- 覆盖率报告统一使用：

```bash
npx jest --coverage --coverageReporters=text --coverageReporters=lcov
```

## 4. 三阶段执行方案

## Phase 1：基础设施 + 高 ROI 纯函数 / service

目标：

- 建立稳定 Jest 基础设施
- 优先吃掉纯函数、service 薄封装、manager 高价值逻辑

已完成范围：

- Jest 基础设施
- `src/pages/manager/utils` 核心纯函数
- `src/pages/manager/components` 中的工具函数组件
- `src/pages/manager/pages/ModelMgr/components/modelFormUtils.ts`
- `src/pages/manager/models/common/useAppStore.ts`
- `src/pages/manager/models/session.ts`
- `src/pages/manager/models/modelMgr.ts`
- `src/pages/manager/components/Ellipsis/index.tsx`
- `src/pages/manager/service/{ModelMgr,session,layout,OrgMgr,DigitalEmployeeMgr}.ts`

## Phase 2：基础逻辑目录全量补齐

目标：

- 补齐 `src/utils`、`src/service`、`src/models`、`src/hooks` 中未测或低覆盖文件
- 优先消除“纯逻辑文件无测试”的情况

重点：

- `src/utils`: `auth.ts`、`json.ts`、`monitoring.ts`、`system.ts`、`session.ts` 等
- `src/hooks`: `useCountDown.ts`、`usePersistFn.ts`、`usePlatform.ts`、`usePolling.ts` 等
- `src/models`: store 行为、state 迁移、边界值
- `src/service`: 统一补齐剩余薄封装及特殊配置项

已推进范围：

- `src/utils`
  - `auth.ts`
  - `json.ts`
  - `session.ts`
  - `system.ts`
  - `common.ts`
  - `http.ts`
  - `errorHandler.ts`
  - `broadcastChannel.ts`
  - `sseRequestManager.ts`
  - `monitoring.ts`
  - `SharedState.ts`
  - `websocket.ts`
  - `bot.ts`
  - `agent.tsx`
- `src/hooks`
  - `useCountDown.ts`
  - `usePlatform.ts`
  - `usePolling.ts`
  - `useAbortRequest.ts`
  - `useDelayedHover.ts`
  - `usePersistFn.ts`
  - `useSticky.ts`
  - `useVirtualHeight.ts`
  - `useLoading.tsx`
  - `useGlobal.ts`
  - `useModuleEvent.ts`
  - `useModal/index.tsx`
  - `useRelativeDrawer/index.tsx`
  - `useLazyImage.ts`
  - `useTracker.ts`
  - `useLocateMessage.ts`
  - `useCollect.ts`
  - `useKnowledge.ts`
  - `useVirtualScroll.ts`
  - `useAgentUploadFileConfig.ts`
- `src/models`
  - `common/user.ts`
  - `task.ts`
  - `useChatBIStore.ts`
  - `useKnowledgeStore.ts`
  - `useMessageStore.ts`
  - `bot.ts`
  - `notice.ts`
  - `useEmployees.ts`
  - `session.ts`

## Phase 3：组件 / 页面行为测试

目标：

- 将测试从纯逻辑层扩展到可验证的交互层
- 对 `src/components`、`src/pages`、`src/pages/manager/components` 采用“模块化分批”推进

重点：

- 先测组件内工具函数、状态切换、渲染分支
- 再测表单容器、弹窗、列表、树、分页、上传等复杂交互
- 页面级以 smoke + 关键行为为主，不做无价值快照堆砌

## 5. 全量范围汇总

### 5.1 顶层模块计划

| 模块 | 文件数 | 当前策略 | 测试粒度 | 优先级 | 状态 |
|---|---:|---|---|---|---|
| `src/utils` | 50 | 全量补齐 | 按文件 | P0 | `部分覆盖` |
| `src/service` | 24 | 全量补齐 | 按文件 | P0 | `部分覆盖` |
| `src/models` | 11 | 全量补齐 | 按文件 | P0 | `已覆盖` |
| `src/hooks` | 41 | 全量补齐 | 按文件 | P1 | `部分覆盖` |
| `src/components` | 303 | 按子模块分批推进 | 按子目录 | P2 | `部分覆盖` |
| `src/pages` | 374 | 按业务域分批推进 | 按子目录 | P3 | `部分覆盖` |
| `src/pages/manager` | 192 | manager 已作为专项推进 | 文件 + 子模块 | P0/P1 | `部分覆盖` |

### 5.2 `src/components` 全量子模块汇总

| 子模块 | 文件数 | 建议测试方式 | 优先级 | 状态 |
|---|---:|---|---|---|
| `src/components/MessagesComp` | 67 | 先测工具函数、状态标题、任务流程渲染 | P2 | `未覆盖` |
| `src/components/QueryInput` | 54 | 先测 drag/upload/format/helper，再测输入交互 | P1 | `未覆盖` |
| `src/components/MessageList` | 30 | 先测 AnswerActions、条件渲染、消息操作 | P2 | `未覆盖` |
| `src/components/QuerySources` | 18 | 先测纯渲染分支与 source 转换 | P2 | `未覆盖` |
| `src/components/ChatLayoutComp` | 17 | 先测 util / hooks，再测容器行为 | P2 | `未覆盖` |
| `src/components/Markdown` | 9 | 工具函数优先，渲染器其次 | P1 | `未覆盖` |
| `src/components/Preview` | 8 | 文件类型分支、错误分支、展示分支 | P2 | `未覆盖` |
| `src/components/wisdomPen` | 7 | 工具与 service 交互边界 | P2 | `未覆盖` |
| `src/components/LoginModal` | 6 | 表单提交、切换逻辑 | P2 | `未覆盖` |
| `src/components/OrgSelect` | 5 | 选择器与树形渲染 | P2 | `未覆盖` |
| `src/components/OrgUserSelector` | 5 | 列表与选择行为 | P2 | `未覆盖` |
| `src/components/PersonnelModel` | 5 | 树、checkbox、render 工具 | P2 | `未覆盖` |
| 其余单文件/小模块 | 131 | 按业务风险滚动补测 | P3 | `未覆盖` |

### 5.3 `src/pages` 全量业务域汇总

| 子模块 | 文件数 | 建议测试方式 | 优先级 | 状态 |
|---|---:|---|---|---|
| `src/pages/manager` | 192 | 管理端专项，优先逻辑文件与公共组件 | P0 | `部分覆盖` |
| `src/pages/mobile` | 23 | 移动端容器 smoke + 关键分支 | P3 | `未覆盖` |
| `src/pages/workSpace` | 22 | 文件列表、任务流、操作入口 | P2 | `未覆盖` |
| `src/pages/digitalEmployees` | 19 | 列表、过滤、详情交互 | P2 | `未覆盖` |
| `src/pages/notice` | 18 | 消息流、已读、懒加载 | P2 | `未覆盖` |
| `src/pages/searchAndQuery` | 10 | 聊天布局、输入输出、搜索流程 | P2 | `未覆盖` |
| `src/pages/knowledgeDetail` | 9 | 权限、上传、详情容器 | P2 | `未覆盖` |
| `src/pages/chat` | 8 | 核心聊天页 smoke + 关键交互 | P2 | `未覆盖` |
| `src/pages/employees` | 8 | 列表、抽屉、iframe、任务操作 | P2 | `未覆盖` |
| `src/pages/knowledgeCenter` | 8 | 列表、可见范围、分享/新增 | P2 | `未覆盖` |
| `src/pages/objectModule` | 8 | 列表与 modal 交互 | P2 | `未覆盖` |
| `src/pages/skillModule` | 8 | 技能资源相关页面行为 | P2 | `未覆盖` |
| `src/pages/toolModule` | 8 | 工具资源页面行为 | P2 | `未覆盖` |
| 其余页面子模块 | 64 | 以 smoke + 关键业务流推进 | P3 | `未覆盖` |

## 6. 纯逻辑目录完整清单

## 6.1 `src/utils`（50）

建议：全部纳入单元测试范围，按纯函数 / 浏览器 API / 加密 / 网络工具分批推进。

```text
src/utils/SharedState.ts
src/utils/agent.tsx
src/utils/antdAppModal.ts
src/utils/auth.ts
src/utils/bot.ts
src/utils/broadcastChannel.ts
src/utils/browser.ts
src/utils/chat.ts
src/utils/common.ts
src/utils/cookie.ts
src/utils/copy.ts
src/utils/createReactLazy.ts
src/utils/datacloud/getWhaleSysCode.tsx
src/utils/date.ts
src/utils/dom.ts
src/utils/encrypt/aes.ts
src/utils/encrypt/rsa.ts
src/utils/encrypt/sm/gm-crypt/crypt.js
src/utils/encrypt/sm/gm-crypt/sm4.ts
src/utils/encrypt/sm/index.ts
src/utils/errorHandler.ts
src/utils/eventEmitter.ts
src/utils/file.ts
src/utils/flexible.ts
src/utils/http.ts
src/utils/index.ts
src/utils/json.ts
src/utils/language.ts
src/utils/loadJS.ts
src/utils/math.ts
src/utils/messgae.ts
src/utils/monitoring.ts
src/utils/openClaw/const.ts
src/utils/openClaw/openclawHistoryHook.ts
src/utils/openClaw/openclawMessage.ts
src/utils/openClaw/openclawWebSocket.ts
src/utils/openClaw/utils.ts
src/utils/pageInfo.ts
src/utils/performance.ts
src/utils/polyfill.ts
src/utils/qs.ts
src/utils/sandboxDynamicUrl.ts
src/utils/security.ts
src/utils/session.ts
src/utils/signature.ts
src/utils/sseRequestManager.ts
src/utils/system.ts
src/utils/tools.ts
src/utils/tracker/index.ts
src/utils/websocket.ts
```

## 6.2 `src/service`（24）

建议：全部纳入单测范围，统一按 GET/POST 参数、queryOpt、responseCfg、multipart、cancelToken 分类补齐。

```text
src/service/agent.ts
src/service/assistantSetting.ts
src/service/auth.ts
src/service/bot.ts
src/service/chatBI.ts
src/service/common/request.ts
src/service/digitalEmployees.ts
src/service/feedback.ts
src/service/file.ts
src/service/knowledgeCenter.ts
src/service/layout.ts
src/service/memberMgr.ts
src/service/memory.ts
src/service/message.ts
src/service/notice.ts
src/service/orgMgr.ts
src/service/search.ts
src/service/session.ts
src/service/showcase.ts
src/service/system.ts
src/service/task.ts
src/service/user.ts
src/service/wisdomPen.ts
src/service/workSpace.ts
```

## 6.3 `src/models`（11）

建议：全部纳入单测范围，store 与纯转换逻辑优先。

```text
src/models/bot.ts
src/models/common/useAppStore.ts
src/models/common/useSystemStore.ts
src/models/common/user.ts
src/models/notice.ts
src/models/session.ts
src/models/task.ts
src/models/useChatBIStore.ts
src/models/useEmployees.ts
src/models/useKnowledgeStore.ts
src/models/useMessageStore.ts
```

## 6.4 `src/hooks`（41）

建议：按“纯状态 hooks -> 浏览器依赖 hooks -> SSE / 上传 / 滚动 hooks”顺序推进。

```text
src/hooks/useAbortRequest.ts
src/hooks/useAgentUploadFileConfig.ts
src/hooks/useChat/index.ts
src/hooks/useChat/useHandler.ts
src/hooks/useChat/useLoopGroup.ts
src/hooks/useChat/useMessage.ts
src/hooks/useChat/util.ts
src/hooks/useCollect.ts
src/hooks/useCountDown.ts
src/hooks/useDelayedHover.ts
src/hooks/useEcharts.ts
src/hooks/useFileTookit.ts
src/hooks/useGlobal.ts
src/hooks/useKnowledge.ts
src/hooks/useLazyImage.ts
src/hooks/useLoading.tsx
src/hooks/useLocateMessage.ts
src/hooks/useModal/index.tsx
src/hooks/useModuleEvent.ts
src/hooks/usePersistFn.ts
src/hooks/usePlatform.ts
src/hooks/usePolling.ts
src/hooks/useRegBotEventHooks.tsx
src/hooks/useRelativeDrawer/index.tsx
src/hooks/useRequest.ts
src/hooks/useResourceDetail.tsx
src/hooks/useShowModal.ts
src/hooks/useSseSender/agent/typescript.ts
src/hooks/useSseSender/agent/util.ts
src/hooks/useSseSender/fetchPureText.ts
src/hooks/useSseSender/openclaw/sendHelper.ts
src/hooks/useSseSender/sendHelper.ts
src/hooks/useSseSender/useSend.ts
src/hooks/useSseSender/util.ts
src/hooks/useSseSender/wisdomPen/sendHelper.ts
src/hooks/useSseSender/wisdomPen/util.ts
src/hooks/useSticky.ts
src/hooks/useTracker.ts
src/hooks/useUpload.ts
src/hooks/useVirtualHeight.ts
src/hooks/useVirtualScroll.ts
```

## 7. manager 专项完整清单

### 7.0 manager 专项状态汇总

| 子模块 | 文件数 | 当前状态 | 说明 |
|---|---:|---|---|
| `src/pages/manager/utils` | 19 | `部分覆盖` | 核心纯函数已覆盖，剩余浏览器/API/副作用文件待补 |
| `src/pages/manager/components` | 41 | `部分覆盖` | 已覆盖工具函数组件，复杂交互组件仍未补 |
| `src/pages/manager/models` | 10 | `部分覆盖` | 已覆盖高价值辅助函数，effects/reducers 仍有空白 |
| `src/pages/manager/service` | 13 | `部分覆盖` | 已覆盖核心 service，剩余边缘 service 待补 |
| `src/pages/manager/pages` | 109 | `未覆盖` | 页面级容器与业务流程仍待分模块推进 |

## 7.1 `src/pages/manager/utils`（19）

建议：全部纳入单测范围，优先级最高。

```text
src/pages/manager/utils/agent.tsx
src/pages/manager/utils/antdAppModal.ts
src/pages/manager/utils/auditConfirm.tsx
src/pages/manager/utils/auth.ts
src/pages/manager/utils/cookie.ts
src/pages/manager/utils/copy.ts
src/pages/manager/utils/encrypt/sm/gm-crypt/crypt.js
src/pages/manager/utils/encrypt/sm/gm-crypt/sm4.ts
src/pages/manager/utils/encrypt/sm/index.ts
src/pages/manager/utils/eventEmitter.ts
src/pages/manager/utils/file.ts
src/pages/manager/utils/index.ts
src/pages/manager/utils/managerRequest.ts
src/pages/manager/utils/managerUtils.tsx
src/pages/manager/utils/menu.ts
src/pages/manager/utils/publishConfirm.tsx
src/pages/manager/utils/qs.ts
src/pages/manager/utils/requestDownload.ts
src/pages/manager/utils/signature.ts
```

## 7.2 `src/pages/manager/components`（41）

建议：按“组件工具函数 -> 纯渲染组件 -> 交互组件”推进。

```text
src/pages/manager/components/AntdIcon/icon.tsx
src/pages/manager/components/AntdIcon/index.tsx
src/pages/manager/components/AuthListDrawer/AddAuthModal/index.tsx
src/pages/manager/components/AuthListDrawer/AddAuthModal/useGetData.js
src/pages/manager/components/AuthListDrawer/AddAuthModal/useSearch.js
src/pages/manager/components/AuthListDrawer/AuthList/index.tsx
src/pages/manager/components/AuthListDrawer/index.tsx
src/pages/manager/components/CardList/Card.tsx
src/pages/manager/components/CardList/index.tsx
src/pages/manager/components/CardRadio/index.tsx
src/pages/manager/components/ChatAvatar/index.tsx
src/pages/manager/components/DigitalEmployeeAuthor/index.tsx
src/pages/manager/components/Ellipsis/index.tsx
src/pages/manager/components/Empty/index.tsx
src/pages/manager/components/FillTable/index.tsx
src/pages/manager/components/Image/index.tsx
src/pages/manager/components/InfiniteScroll/index.tsx
src/pages/manager/components/InfiniteScroll/utils/threshold.ts
src/pages/manager/components/InputNumberRange/index.js
src/pages/manager/components/KnowledgeBaseAuthor/index.tsx
src/pages/manager/components/MobileComponents/BottomDrawer/index.tsx
src/pages/manager/components/ModalDrawer/index.tsx
src/pages/manager/components/OrganizationTree/index.tsx
src/pages/manager/components/Pagination/index.tsx
src/pages/manager/components/PersonnelModel/CheckboxRender.tsx
src/pages/manager/components/PersonnelModel/PersonnelModel.tsx
src/pages/manager/components/PersonnelModel/RightItemRender.tsx
src/pages/manager/components/PersonnelModel/const.js
src/pages/manager/components/PersonnelModel/index.js
src/pages/manager/components/ResizeTable/index.tsx
src/pages/manager/components/SkillDetailDrawer/SkillDetailDrawer.tsx
src/pages/manager/components/SkillDetailDrawer/SkillDetailDrawer.utils.tsx
src/pages/manager/components/SkillDetailDrawer/useSkillDetailDrawer.tsx
src/pages/manager/components/TextHighlight/index.tsx
src/pages/manager/components/TreeFilter/FieldFilter.tsx
src/pages/manager/components/TreeFilter/SourceFilter.tsx
src/pages/manager/components/TreeFilter/index.tsx
src/pages/manager/components/TreeFilter/utils.ts
src/pages/manager/components/ausong/Flex/index.tsx
src/pages/manager/components/ausong/Layout/index.tsx
src/pages/manager/components/ausong/Size/index.tsx
```

## 7.3 `src/pages/manager/models`（10）

建议：全部纳入单测范围，先测纯辅助函数与 reducers/effects 的无副作用片段。

```text
src/pages/manager/models/AuthorizeMgr.ts
src/pages/manager/models/common/useAppStore.ts
src/pages/manager/models/employeeMgr.ts
src/pages/manager/models/memberMgr.ts
src/pages/manager/models/menu.ts
src/pages/manager/models/modelMgr.ts
src/pages/manager/models/orgMgr.ts
src/pages/manager/models/postManage.ts
src/pages/manager/models/resourceMgr.ts
src/pages/manager/models/session.ts
```

## 7.4 `src/pages/manager/service`（13）

建议：全部纳入单测范围，路径、payload、responseCfg、multipart、GET query 严格校验。

```text
src/pages/manager/service/AuthorizeMgr.ts
src/pages/manager/service/ConversationMgr.ts
src/pages/manager/service/DigitalEmployeeMgr.ts
src/pages/manager/service/DigitalResourceMgr.ts
src/pages/manager/service/ModelMgr.ts
src/pages/manager/service/OrgCenter.ts
src/pages/manager/service/OrgMgr.ts
src/pages/manager/service/System.ts
src/pages/manager/service/dashboard.ts
src/pages/manager/service/knowledgeCenter.ts
src/pages/manager/service/langfuse.ts
src/pages/manager/service/layout.ts
src/pages/manager/service/session.ts
```

## 8. 执行批次建议

### 批次 A：纯逻辑全量补齐

- `src/utils`
- `src/service`
- `src/models`
- `src/hooks`
- `src/pages/manager/utils`
- `src/pages/manager/models`
- `src/pages/manager/service`

状态目标：

- 从 `部分覆盖 / 未覆盖` 推进到 `部分覆盖`
- 对纯函数、service 薄封装优先推进到 `已覆盖`

### 批次 B：manager 组件专项

- `src/pages/manager/components`
- `src/pages/manager/pages/**/components`

状态目标：

- `src/pages/manager/components` 从 `部分覆盖` 提升为更高比例的 `部分覆盖`
- manager 页面级组件从 `未覆盖` 进入可持续维护状态

### 批次 C：通用组件专项

- `src/components/QueryInput`
- `src/components/MessagesComp`
- `src/components/MessageList`
- `src/components/Markdown`
- `src/components/Preview`
- `src/components/ChatLayoutComp`

状态目标：

- 将 `src/components` 从“几乎无测试”推进到“关键子模块部分覆盖”

### 批次 D：页面专项

- `src/pages/workSpace`
- `src/pages/digitalEmployees`
- `src/pages/notice`
- `src/pages/searchAndQuery`
- `src/pages/chat`
- `src/pages/employees`
- `src/pages/knowledgeCenter`
- `src/pages/knowledgeDetail`
- `src/pages/objectModule`
- `src/pages/skillModule`
- `src/pages/toolModule`
- `src/pages/mobile`

状态目标：

- 将页面级核心业务域从 `未覆盖` 推进到 `部分覆盖`

## 9. 报告与维护要求

- 每次新增测试后必须更新本文件中的“已覆盖文件 / 待覆盖模块”
- 覆盖率报告固定输出到：
  - `coverage/coverage-summary.json`
  - `coverage/lcov.info`
  - `coverage/lcov-report/index.html`
- 文档中的文件数如发生变化，需要重新统计并同步更新
- 以后新增 `src` 文件时，必须在本计划中登记到对应模块
- 每轮执行结束后，应至少更新以下状态字段：
  - 顶层模块状态
  - manager 专项状态
  - 已完成批次 / 未完成批次

## 10. 当前结论

后续单元测试计划不应再写成“挑选少量高 ROI 文件”的局部清单，而应维护为：

- 一份覆盖整个 `src/` 的主计划
- 一份按优先级推进的执行清单
- 一份随仓库演进持续更新的模块盘点

本文件即作为后续单元测试工作的统一汇总基线。
