# 已下线资源能力说明（OBJECT / VIEW / ONTOLOGY_BASE / SCENE）

> **本文件是四类资源下线能力、响应行为、部署复验与未覆盖清单的唯一事实来源。**
> 其它文档只保留**指针**（"去哪看"）；一旦某处指针里出现具体类型码、错误码或命令，即视为**漂移**，应删除并改回链接。

## 定责表

| 文档 | 角色 | 冲突时以谁为准 |
|---|---|---|
| **本文件**（`docs/disabled-resource-capabilities.md`） | 能力停用事实、响应行为、部署复验与未覆盖清单的**唯一事实来源** | **本文件** |
| `docs/features.md`、`docs/api/*.md` | 各自领域的事实来源；其中**停用相关段落是指针** | 领域内容以各自为准；**停用语义以本文件为准** |
| `docs/deployment/09-verification.md` | 部署验证的事实来源；其「能力下线复验」小节是**指针** | 部署验证以它为准；**停用复验以本文件为准** |
| `CHANGELOG.md` | 变更记录的事实来源 | 变更历史以它为准 |

**反漂移约束**：指针只写"去哪看"，**不复制**类型码、错误码、命令。本文件是唯一可以承载这些具体值的地方。

---

## 1. 基线

| 项 | 值 |
|---|---|
| 仓库 | `beyonai/ByClaw`（本工作树 `/by/projects/11220811/worktrees/0010-disable-docs-and-legacy-skills`） |
| 分支 | `devflow/0010-disable-docs-and-legacy-skills` |
| 基线 | `D0.5.0` / `30f1a195af914e1eb990b0c02f62c2bc62dfc31a` |
| 本文件归属 | 卡片 `0010-disable-docs-and-legacy-skills`（父卡 `0006-byclaw-disable-ontology-conversation`，GitHub `beyonai/ByClaw#267`） |

**复核命令**（只读）：

```bash
git -C <repo> rev-parse D0.5.0
git -C <repo> log --oneline -1
```

> **重要**：本文件描述的**行为事实**分别落在下表各分支上。**这些分支均尚未合并进 `D0.5.0`**，因此本工作树内**看不到**对应实现代码；每条事实都同时给出"分支 @ commit + 文件:行"，复核时请 `git -C <worktree-of-that-branch> show` 或直接到该分支工作树查看。

---

## 2. 停用类型与判定规则

**停用类型码恰为四类**：

| 类型码 | 中文名 |
|---|---|
| `OBJECT` | 对象 |
| `VIEW` | 视图 |
| `ONTOLOGY_BASE` | 本体库 |
| `SCENE` | 场景 |

**判定规则（两侧语义一致，实现各自独立、不共享源码）**：

1. 判定输入**只有资源业务类型字段值**（`resourceBizType` / `resourceType` / `resource_type`），**不按名称、描述或 `targetContent` 关键词过滤**；
2. 归一化 = `trim` + 大写（Java `Locale.ROOT`；插件侧复用 `normalizeResourceType`，并对小写标签 `object` / `view` 等价接受）；
3. `null` / `undefined` / 空串 / 纯空白 / **未知或伪造类型**（如 `OBJECTX`）⇒ **非停用**（保持既有空值语义，不借此取用停用资源）；
4. **历史别名集合为空**（已核实：后端 `ONTOLOGY` 零命中，`SCENE` 仅作为 `resourceCode` 前缀出现；插件侧 `ONTOLOGY` 仅作为测试夹具资源名出现）；扩展位保留，新增别名只改一处；
5. 正常类型**不得误伤**：`DOC` / `ATOM` / `KG_DOC` / `KG_DB` / `KG_QA` / `KG_TERM` / `SKILL` / `TOOLKIT` / `TOOL` / `MCP` / `MCP_TOOL` / `AGENT` / `DIG_EMPLOYEE` / `DB_DATASET` / `TAG` 的既有映射与过滤语义不变；
6. JSON Schema 的 `type: "object"` **不是**资源类型 ⇒ 不得被判定为停用。

**两侧的单一事实来源**：

| 侧 | 分支 @ commit | 文件 |
|---|---|---|
| 后端（Java） | `devflow/0007-resource-query-disable` @ `675dd51be` | `byclaw-be/src/main/java/com/iwhalecloud/byai/common/constants/resource/DisabledResourceBizTypes.java`（类型码 `:48`、原因码 `:28`、别名空集 `:39`） |
| 插件（TypeScript） | `devflow/0008-conversation-path-disable` @ `c8214a701` | `byclaw-exe/extensions/baiying-enhance/src/executor/disabled-resource-type.ts` |

**统一原因码 / 错误码**：`RESOURCE_TYPE_DISABLED`（Java 侧为 `DisabledResourceBizTypes.REASON_CODE`；插件侧为 `RESOURCE_TYPE_DISABLED` 常量）。两侧**同名同义、载体不同**（Java 出现在运行时查询响应的 `reason` 字段，插件出现在工具/执行器返回值的 `error_code` 字段）。

---

## 3. 响应行为

### 3.1 列表类入口 —— 过滤结果

列表类入口在**查询阶段**排除停用类型（不放进任何可选分支条件，保证 `count` 与 `select` 同源、不产生空页与总数偏差）：

- 授权列表 / 员工关联资源授权列表 / 分页资源列表 / 目录资源列表：SQL 层无条件排除；
- 开放接口的资源列表：MyBatis-Plus 条件构造器 `notIn`；
- 目录树：节点类型集合改为规则派生（本次派生结果为**空集**，即不再返回停用类型节点，目录层级本身保留）。

事实来源（`devflow/0007` @ `675dd51be`）：`manager/mapper/auth/PrivilegeGrantMapper.xml`、`manager/mapper/resource/SsResourceMapper.xml`、`manager/mapper/resource/SsResourceCatalogMapper.xml`、`manager/domain/resource/service/SsResourceService.java`、`manager/domain/resource/service/SsResourceCatalogService.java:349`。

### 3.2 详情类入口 —— 停用与"不存在"同形

- `POST /resource/queryResourceDetail`：命中停用类型时返回 `null`（不构造详情），对外与"资源不存在"**同形**；
- `GET|POST /tool/queryResourceDetail`：复用同一服务方法，因此拿到同样的 `null` ⇒ 走既有 `resource.notfound` 失败分支（`state/interfaces/controller/resource/ToolManController.java` 的 `resourceDetailVo == null → ResponseUtil.fail(...)`），**与不存在资源的响应逐字节相同**。

**这样设计的目的**：不通过"该资源已停用"这类差异化响应泄露资源存在性（见 §4）。

事实来源（`devflow/0007` @ `675dd51be`）：`state/domain/resource/service/ResourceApplicationService.java:174-176`（停用 ⇒ 返回 `null` + WARN 日志带 `REASON_CODE`）。

### 3.3 Redis 运行时查询入口 —— 条目级原因

运行时资源查询（`POST /api/v1/resources/query`）不删除 `RESOURCE_KEY_PREFIXES` 表项，而是在条目级判定：

- 授权 id 集合：停用类型条目被短路排除；
- 单资源查询：命中停用 ⇒ `allowed=false` 且 `reason` 为统一原因码；
- 批量查询：逐条给出 `allowed=false` + `reason`；
- 类型解析兜底分支：停用类型也能解析出真实类型，使裸前缀与 JSON 两种形态得到**同一原因**。

事实来源（`devflow/0007` @ `675dd51be`）：`state/domain/resource/service/RedisResourceQueryService.java:52`、`:68-70`、`:92`、`:106-107`、`:173`。

### 3.4 插件对话路径 —— 明确下线反馈

- `baiying_call` 入口在**任何 Redis / Langfuse / 网络访问之前**判定停用类型；命中即返回 `error_code = RESOURCE_TYPE_DISABLED`；
- capability 解析在 **MCP 工具发现之前**短路（入口关卡 + 解析后关卡），停用类型不产生 MCP `tools/list` 请求，也不进入 `callAgent` 业务调用；
- 显式指定但未关联的 `resource_id` 返回 `RESOURCE_NOT_FOUND`，**不再回退**到第一个关联资源；
- 工具描述与托管提示文件（`TOOLS.md` / `SUBAGENT_ROUTING.md`）已移除对象/视图调用指引，改为"已下线"说明；
- 正常 `BYCLAW_DATA` / MCP / 正常 Agent / 知识库 / 技能 / 工具路径不受影响。

事实来源（`devflow/0008` @ `c8214a701`）：`byclaw-exe/extensions/baiying-enhance/src/baiying-call-tool.ts`、`src/executor/disabled-resource-type.ts`、`src/executor/capability-resolver.ts`、`src/executor/executor.ts`、`src/executor/index.ts`、`src/executor/resource-types/mcp.ts`、`src/agent-adapter.ts`、`src/workspace-seed.ts`、`src/subagent-routing-seed.ts`、`src/resource-metadata-context.ts`。

---

## 4. 鉴权语义（先鉴权、后停用提示）

**规则**：停用判定**不得**早于鉴权/授权上下文的建立，也**不得**成为独立于授权结果的"前置提示"。

| 入口类型 | 既有鉴权/授权上下文 | 停用判定位置 |
|---|---|---|
| 授权列表类 | 先设置当前用户授权上下文、目录范围、组织范围 | 与授权谓词**同一条 SQL 的 WHERE**，无独立查询、无独立响应 |
| 运行时资源查询 | 先解析用户身份、再读取授权 hash | 判定只作用于**已授权条目**；未授权资源仍返回既有的 `allowed=false`（**不带 reason**），停用条目返回 `allowed=false` + `reason`，两者不产生新的存在性提示 |
| 详情类（6/7） | 现状**无资源级鉴权**（既有事实，非本次变更引入） | 判定发生在取到资源之后、构造响应之前；对外与"不存在"同形 |

**结论**：`allowed=false + reason=RESOURCE_TYPE_DISABLED` **不得**被解读为"该资源存在但已停用"。结合 §3.2 的"同形"语义，调用方**不能**据此推断资源是否存在。

事实来源：`devflow/0007` @ `675dd51be` 的 `ResourceApplicationService.java`、`RedisResourceQueryService.java`、`PrivilegeGrantMapper.xml`。

---

## 5. 正常能力保留范围

以下能力**不受本次下线影响**，行为与 `D0.5.0` 基线一致：

| 类别 | 类型码 |
|---|---|
| 知识 | `KG_DOC`、`KG_DB`、`KG_QA`、`KG_TERM`（及别名 `DOC`、`ATOM`） |
| 技能 | `SKILL`（关联资源中的 SKILL 过滤语义不变） |
| 工具 | `TOOLKIT`、`TOOL`、`MCP`、`MCP_TOOL` |
| 数字员工 / 智能体 | `AGENT`、`DIG_EMPLOYEE` |
| 数据 | `BYCLAW_DATA`、`DB_DATASET` |
| 其它 | `TAG`、模型查询与管理、`ACTION`（动作，见 N-4） |

**不整体关闭**：`BYCLAW_DATA` 目标类型、MCP 发现与调用、正常 Agent 路径、知识库问答、技能与工具执行均保持可用。

---

## 6. 历史会话限制

**旧会话中复述已有内容，不等同于再次调用接口。**

- 历史会话里出现过的对象/视图数据，是**当时**调用结果的文本记录；它不构成"现在仍可查询/可调用"的证据；
- 判断"能力是否已下线"必须**以新的接口调用结果为准**，不得以历史消息内容为准；
- 下线后仍可能在历史会话中看到四类资源的名称或数据，这属于历史记录，**不是**接口泄漏。

事实来源：父卡 `0006` 非目标条款（"不把旧会话复述已有内容等同于再次调用接口"）。

---

## 7. 交付状态（按开发时点实测）

> 本节状态由本卡开发时点实测 `devflow_list` 与各分支 `git log` 得出，**不沿用设计阶段的快照**。
> **四条分支均尚未合并进 `D0.5.0`，也尚未发布到任何运行实例。**

| 卡片 | 状态 | 分支 @ commit | 作用范围 |
|---|---|---|---|
| `0007-resource-query-disable` | **已交付**（评审/测试通过，卡片 done） | `devflow/0007-resource-query-disable` @ `675dd51be` | 后端 14 个查询/关联入口停用、`DisabledResourceBizTypes`、`DigitalEmployeeOutputSanitizer` |
| `0008-conversation-path-disable` | **已交付**（评审/测试通过，卡片 done） | `devflow/0008-conversation-path-disable` @ `c8214a701` | 插件对话执行路径与上下文注入停用、工具描述改写 |
| `0009-employee-detail-config-disable` | **已交付**（评审/测试通过，卡片 done） | `devflow/0009-employee-detail-config-disable` @ `75898a918`（含 `0007` 提交） | 员工详情/保存兼容、运行配置导出、发布快照、关联资源写路径收口 |
| `0011-chat-param-resource-disable` | **已交付**（评审/测试通过，卡片 done） | `devflow/0011-chat-param-resource-disable` @ `08a4b7c60`（含 `0007` 提交） | 聊天参数解析路径（MCP 白名单旁路）停用 |

**必须并列声明的两件事**：

1. **"已交付"= 已在各自分支上完成开发并冻结提交**，**不等于**"已合并进 `D0.5.0`"，**更不等于**"已发布上线"。当前主检出与任何基于 `D0.5.0` 构建的镜像**都不包含**上述实现。
2. 因此，在**未包含这些分支**的部署实例上：停用**尚未生效**。验收必须按 §8 的复验步骤在**已包含这些分支**的构建上执行。

**部署顺序提示**：四条分支共享 `DisabledResourceBizTypes` 等文件，合入时需要按依赖顺序处理（`0007` 最先，`0009`/`0011` 已包含 `0007` 的提交）。

---

## 8. 部署与配置刷新

> 本节是**面向发布方的运行态步骤**。本文件所在工作树**没有** PostgreSQL / Redis / OpenClaw worker，因此 R1~R6 **无法在此环境实跑**，本节只保证**命令与路径可解析、行为描述可复核**。

### 8.1 构建

| 目标 | 命令 | 事实来源 |
|---|---|---|
| 后端 | `mvn -B -f byclaw-be/pom.xml package -DskipTests` | `CLAUDE.md:29-33`、`byclaw-be/pom.xml` |
| 插件 | `cd byclaw-exe/extensions/baiying-enhance && npm install && npm run build` | `byclaw-exe/extensions/baiying-enhance/package.json` 的 `scripts.build` |
| 前端（**仅当改动时**） | **非修改型**：`pnpm run lint:js && pnpm run lint:style:check && pnpm run lint:prettier`，另 `pnpm run test`、`pnpm run build` | `byclaw-fe/package.json` 的 `scripts` |

> **禁止**用 `pnpm run lint` 做只读验证：它包含 `lint:style` 的 `--fix`，会修改 Less 文件。

### 8.2 实例更新顺序

1. **先后端、后插件**：插件对话路径依赖后端的查询/关联入口。
2. **后端必须全实例覆盖**：停用发生在服务端各实例，任一未更新的后端实例仍会返回四类资源。
3. **插件必须全实例覆盖**：任一未更新的插件实例仍会产出四类占位符与调用指引。
4. **技能文件**：仓库内**未找到** `middleware/openclaw/skills` 的分发/挂载清单（见 N-11），因此本节**不给出具体"技能刷新"步骤**。发布方必须按自身分发方式把 `crm-demo-showcase` 的改动发布到运行实例，并以 §8.4 的 R4 判据确认——该判据**不依赖分发机制**。

### 8.3 员工配置刷新

| 刷新对象 | 触发点 | 状态 |
|---|---|---|
| 员工 JSON 快照 `ss_res_ext_dig_employee.target_content` | `DigitalEmployeeApplicationService.doSyncOpenClawWorkSpace` | 代码已交付（`0009` @ `75898a918`）；**未合并，未生效** |
| Redis 员工配置键 | 同路径的配置同步与逐关联资源同步 | 同上 |
| 托管提示文件（`SOUL.md` / `TOOLS.md` / `SUBAGENT_ROUTING.md`） | 插件侧 workspace seed（受托管标记约束，不覆盖用户手工文件） | 代码已交付（`0008` @ `c8214a701`）；**未合并，未生效** |
| 启动全量同步 | `InitDigEmployeeRedisRunner`、`StartupTargetContentPreloader` | 同上 |

> 上表"未生效"三处**不得**被表述为"已过滤/已生效"——它们依赖尚未合并的分支。

### 8.4 复验（R1~R6）

| # | 复验项 | 命令 / 判据 | 预期 |
|---|---|---|---|
| R1 | 后端列表停用生效 | 对 `POST /open/api/v1/getUserAuthResource` 不传类型，检查返回中不含四类 `resourceBizType` | 不含 |
| R2 | 详情与"不存在"同形 | 对 `POST /resource/queryResourceDetail` 传一个已停用资源 id，与一个不存在 id 的响应比对 | **逐字节相同** |
| R3 | 插件工具描述 | 取 `baiying_call` 的 `description`，检查不含 `call_object_ids` / `call_view_ids` / `file_url` 指引 | 不含 |
| R4 | **技能文件已更新**（机制无关） | 在**运行实例上**读该技能文件：`grep -cE 'resource_type=(OBJECT\|VIEW)\|"resource_biz_type": *"VIEW"\|CRM 对象与视图演示' <已部署>/crm-demo-showcase/SKILL.md` | 输出 `0` |
| R5 | 挂载端点 | 对 `POST /open/api/v1/mountDigEmployeeResource` 挂载一个四类资源 id，观察是否被忽略 | **已包含 `0009` 的构建**：不写库；**未包含**：仍会成功（见 N-10） |
| R6 | 全实例覆盖 | 逐实例执行 R1~R5 | **任一实例未通过 ⇒ 整体不通过** |

### 8.5 未更新实例与回退

> **未更新实例不能作为验收通过**：只要存在任一个未更新的后端或插件实例，该实例仍可能返回或执行已停用能力。验收必须在**全部实例**上通过 R1~R6 后才成立；部分实例通过不构成"部分修复"。

> **回退风险**：回退到旧代码（后端或插件）会**恢复**四类资源的查询与调用能力。因此回退**不得**被标记为"已修复"；回退后必须重新执行 §8.4 的 R1~R6 并如实记录结果。

---

## 9. 未覆盖清单

> 本清单是父卡 `0006` 集成复核的**边界声明**。以下各项**未**被本次下线覆盖，**不得**被表述为"已覆盖"。

| # | 未覆盖项 | 为什么无法覆盖 | 依据 |
|---|---|---|---|
| N-1 | **动态 TOOL / MCP / AGENT 包装调用** | 运行时按真实定义动态生成；本卡**未取得任何实际定义** | 父卡非目标 + issue §5 |
| N-2 | `scriptView`（脚本采集模块） | 名称含"视图"但**不是**资源业务类型 | 父卡非目标；`byclaw-be/.../datacloud/DataCloudScriptViewService.java`、`entity/datacloud/DataCloudScriptView.java` |
| N-3 | Devloop 对象文件接口 | 与知识文件共用路径，属另一条产品线 | 父卡非目标；`common/constants/devloop/ProjectResourceType.java` |
| N-4 | `ACTION`（动作） | 同属本体域但**不在四类清单** | 父卡表格只列四类；`manager/domain/resource/enums/ResourceBizTypeEnum.java` |
| N-5 | 关系 / 数据源 / 本体树 / 场景成员管理 | 未在四类清单内 | 同上；`docs/features.md` 第 9 节相关条目**保留原状态** |
| N-6 | DataCloud 侧接口契约 | 跨服务边界 | `docs/api/datacloud-digital-employee-resource-openapi.md` 只加停用标注，**契约未变** |
| N-7 | 前端 `byclaw-fe` | 判定为无需改动（见下） | 见"前端判定"小节 |
| N-8 | **（状态更新）** `0009` / `0011` 的行为 | 原设计快照记为"未交付"；**开发时点实测二者均已交付到各自分支**，但**均未合并进 `D0.5.0`** | 见 §7；在未包含这些分支的实例上，其行为仍未生效 |
| N-9 | 历史会话复述 | 非"再次调用接口" | 父卡非目标；见 §6 |
| N-10 | `POST /open/api/v1/mountDigEmployeeResource` | 该端点的写入路径**由 `0009` 的写路径收口点覆盖**（证据见下）；但 `0009` **尚未合并**，因此**在未包含该分支的实例上仍会接受并持久化四类资源** | `OpenApiController.java:101-104` → `OpenApiApplicationService.java:150/158` → `DigitalEmployeeApplicationService.java:1274/1334/1368`（`devflow/0009` @ `75898a918` 的 `compareSsResourceRelDetail` 新增挂载守卫，`isDisabled ⇒ 跳过写库`，`:3554-3557`） |
| N-11 | 技能分发机制 | 仓库内**未找到** `middleware/openclaw/skills` 的分发/挂载清单（`middleware/openclaw/Dockerfile` 无 `COPY skills`；`deploy/**` 无引用）⇒ 无法断言"改文件即在运行实例生效" | §8.2 第 4 点、§8.4 R4 的机制无关判据 |

### 前端判定（N-7 的依据）

| 检查点 | 实测 | 判定 |
|---|---|---|
| 员工详情关联列表 | `byclaw-fe/src/pages/digitalEmployees/index.tsx:403-406` 已有 `['ONTOLOGY','ONTOLOGY_BASE','SCENE']` 防御性过滤 | 已有过滤 |
| 资源卡片安装 | `byclaw-fe/src/components/Resources/components/ResourceCard/index.tsx:320-322` 对 `ONTOLOGY_BASE` 返回 `false` | 已有拦截 |
| 资源类型常量 `OBJECT` | `byclaw-fe/src/constants/resource.ts:17-19` 注释说明其为"引用元素通用类型" | **同形不同义**，保留 |
| 埋点 `'VIEW'` | `byclaw-fe/src/utils/tracker/index.ts:9` 的 `eventType: 'CLICK' \| 'VIEW'` | 埋点事件类型，保留 |
| 后端是否还会返回四类 | `0007` 已停用 14 个查询/关联入口；`0008` 已去插件侧指引 | 前端不会再收到 |

**可推翻条件**：若发现 `0007` 的停用未覆盖前端实际调用的某个入口，或前端存在**新增**的四类渲染/装配路径（本卡未穷举），则本判定被推翻。推翻后按 §8.1 的**非修改型**前端命令验证并登记原始输出。

---

## 10. 事实来源索引

> 复核方式：对标注了"分支 @ commit"的条目，`git -C <该分支工作树> show <commit>:<文件>` 或直接查看该工作树。

| 陈述 | 分支 @ commit | 文件:行 |
|---|---|---|
| 四类类型码恰为 4 项、别名集合为空 | `devflow/0007` @ `675dd51be` | `common/constants/resource/DisabledResourceBizTypes.java:39,48` |
| 统一原因码 `RESOURCE_TYPE_DISABLED` | `devflow/0007` @ `675dd51be` | `DisabledResourceBizTypes.java:28` |
| 列表类 SQL 层排除 | `devflow/0007` @ `675dd51be` | `manager/mapper/auth/PrivilegeGrantMapper.xml`、`manager/mapper/resource/SsResourceMapper.xml`、`manager/mapper/resource/SsResourceCatalogMapper.xml` |
| 资源列表 Wrapper `notIn` | `devflow/0007` @ `675dd51be` | `manager/domain/resource/service/SsResourceService.java:735` |
| 目录树节点类型派生（结果为空集） | `devflow/0007` @ `675dd51be` | `manager/domain/resource/service/SsResourceCatalogService.java:349` |
| 详情停用 ⇒ 返回 `null` | `devflow/0007` @ `675dd51be` | `state/domain/resource/service/ResourceApplicationService.java:174-176` |
| Redis 运行时条目级 `allowed=false` + `reason` | `devflow/0007` @ `675dd51be` | `state/domain/resource/service/RedisResourceQueryService.java:52,68-70,92,106-107,173` |
| 详情入口 7 的"不存在同形"响应 | `D0.5.0` @ `30f1a195a`（本工作树可见） | `state/interfaces/controller/resource/ToolManController.java:866-897` |
| 插件停用规则单一事实来源 | `devflow/0008` @ `c8214a701` | `byclaw-exe/extensions/baiying-enhance/src/executor/disabled-resource-type.ts` |
| 插件入口关卡与精确匹配 | `devflow/0008` @ `c8214a701` | `.../src/baiying-call-tool.ts` |
| 插件 MCP 发现前短路 | `devflow/0008` @ `c8214a701` | `.../src/executor/capability-resolver.ts`、`.../src/executor/executor.ts`、`.../src/executor/index.ts` |
| 插件 `callAgent` 阻断 | `devflow/0008` @ `c8214a701` | `.../src/executor/resource-types/mcp.ts` |
| 插件上下文注入剔除 | `devflow/0008` @ `c8214a701` | `.../src/agent-adapter.ts`、`.../src/workspace-seed.ts`、`.../src/subagent-routing-seed.ts`、`.../src/resource-metadata-context.ts` |
| 关联资源写路径收口（新增挂载不写库） | `devflow/0009` @ `75898a918` | `manager/application/service/digitemploy/DigitalEmployeeApplicationService.java:3554-3557`（同一方法另保留历史停用关联 `:3582`、删除阶段 `:3649`） |
| 挂载端点到写路径的调用链 | `D0.5.0` @ `30f1a195a` + `devflow/0009` @ `75898a918` | `OpenApiController.java:101-104` → `OpenApiApplicationService.java:150,158` → `DigitalEmployeeApplicationService.java:1274,1334,1368` |
| 发布快照/运行配置导出过滤 | `devflow/0009` @ `75898a918` | `manager/application/service/digitemploy/EmployeePublicationApplicationService.java:467` |
| 聊天参数解析侧（MCP 白名单旁路）停用 | `devflow/0011` @ `08a4b7c60` | `state/domain/chat/service/ParamService.java:608,734-740,768-777,797-815` |
| 构建命令 | `D0.5.0` @ `30f1a195a`（本工作树可见） | `CLAUDE.md:29-33`、`byclaw-be/pom.xml`、`byclaw-exe/extensions/baiying-enhance/package.json`、`byclaw-fe/package.json` |
