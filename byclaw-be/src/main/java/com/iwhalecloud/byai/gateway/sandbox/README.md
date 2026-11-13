# Sandbox Worker Agent Type Extension

本文说明沙箱类型如何通过 `sandbox_service_spec.spec_json` 声明 Worker AgentType，以及沙箱启动路由常量的维护约定。

租户资源规格以 `sandbox_service_spec.owner_scope=TENANT` 标记，个人启动入口会拒绝该规格；登录自动启动和个人实例查询仅处理 `owner_scope=USER`。租户 DB/Node 实例须经独立开通流程创建，不能保存为个人首选规格后启动。

## 平台企业专享 Harness

在「沙箱配置管理 → 租户沙箱」创建规格，`Service Key` 和 `Service Type` 均为 `tenant-harness`。
在「服务规格配置」为该类型启用一个带资源限制的档位。镜像使用包含租户 Worker 的 Harness 构建和现有
`web` 启动入口，端点和挂载按所用 Provider 配置。Slim 镜像在仅注册 Worker 的场景可设置
`BYCLAW_DSH_TOOL_ENV=none`。

Spec JSON 的 `env` 使用以下占位符，由启动服务填入实例身份和 BE 所用的 Redis 配置。Redis Cluster 使用
数据库 `0` 和 `REDIS_KEY_SCHEMA_VERSION=v2`。

```json
{
  "env": {
    "BYCLAW_HARNESS_TENANT_ID": "${envVars.BYCLAW_HARNESS_TENANT_ID}",
    "BYCLAW_HARNESS_WORKER_ID": "${envVars.BYCLAW_HARNESS_WORKER_ID}",
    "REDIS_MODE": "${envVars.REDIS_MODE}",
    "REDIS_HOST": "${envVars.REDIS_HOST}",
    "REDIS_PORT": "${envVars.REDIS_PORT}",
    "REDIS_DATABASE": "${envVars.REDIS_DATABASE}",
    "REDIS_USERNAME": "${envVars.REDIS_USERNAME}",
    "REDIS_PASSWORD": "${envVars.REDIS_PASSWORD}",
    "REDIS_CLUSTER_HOST": "${envVars.REDIS_CLUSTER_HOST}",
    "REDIS_CLUSTER_NODES": "${envVars.REDIS_CLUSTER_NODES}",
    "REDIS_TLS": "${envVars.REDIS_TLS}",
    "REDIS_KEY_SCHEMA_VERSION": "${envVars.REDIS_KEY_SCHEMA_VERSION}"
  }
}
```

平台管理员在「租户资源」选择「启动平台租户 Harness」和已启用的档位。接口
`POST /byaiService/admin/tenants/1/harness/ensure` 接收 `{"profileKey":"s"}`，请替换为实际档位。
`GET /byaiService/admin/tenants/1/harness` 返回任务状态、实例 ID 和 `workerReady`。

企业 `1` 的 Harness 启动任务和实例记录保存在平台库，分别沿用 `tenant_task`、`tenant_task_step` 和
`ss_sandbox_record`。部署侧 Worker 领取任务，`BE_ENV=development` 的进程会拒绝提交启动。
重复提交沿用原任务和档位。Provider 确认模板仍在准备时自动重试。创建结果无法确认时保留实例占位，需人工核对
Provider 和记录。当前实例的 Worker 以 `BYCLAW_DSH_TENANT_1` 和 `tenant-harness-1-<recordId>`
注册后，管理页显示就绪。企业群任务需要后续接入授权、工作区和 Gateway 路由。

## 管理页当前引擎清单

用户资源与租户资源只展示**当前执行引擎仍存在的实例**，不展示数据库中孤立的运行记录或已删除实例的历史。
remote 模式从平台 `/internal/platform/sandbox/runtime/list` 读取实际运行时清单；legacy 模式读取本地选中的
`SandboxRuntimeProvider`。不回退查询其他引擎。切换 ACS 后不再展示 OpenSandbox 实例，切回后重新读取 OpenSandbox。

实时实例 ID 与状态先参与筛选，再关联最新业务记录、搜索、分页和计数；数据库生命周期状态不会被管理页改写。
引擎不可达或分页中断时返回空列表、总数 0，服务端记录告警。单次完整清单最多读取 100 页、每页 500 条；
超限或分页不前进会放弃本次结果，避免返回残缺清单。

`BUSINESS_MAN` 与 `PLAT_MAN` 可查看相同的用户资源清单；租户资源仍要求 `PLAT_MAN`，
释放与修改仍校验原有企业归属。访问地址展示 endpoint 的 key 链接，较多或较长时可点“更多”，
仅 HTTP(S)/同源路径可点击，OpenClaw 的 gatewayUrl 覆盖保留。

更新时先部署平台新接口，再更新 BE/FE。新 BE 对尚未升级的平台也会返回空列表。
修复证据记录于仓库 `docs/implementation/sandbox-manager-2026-10-22.md`。

## Redis 服务发现

BE 本地沙箱和资源服务的 endpoint 注册、注销共用服务发现清理逻辑。清理按网关 SDK 的
`REDIS_KEY_SCHEMA_VERSION` 生成实例详情、活跃实例和服务索引键，并逐键执行 Redis 命令。
单机连接借用后归还连接池，Cluster 复用 SDK 管理的共享句柄。排查沙箱启动成功但网关无路由时，
应同时检查 endpoint 注册日志和对应服务发现键。

## Worker Agent Type Configuration

每种沙箱可以在 Spec JSON 的 `env` 中声明固定的基础 Worker AgentType：

```json
{
  "env": {
    "BYAI_WORKER_AGENT_TYPE": "BYCLAW_DSH"
  }
}
```

`BYAI_WORKER_AGENT_TYPE` 只填写基础类型，不包含用户编码。后端在查询 Worker 注册状态时自动拼接
`_<userCode>`，上例对用户 `0027021534` 最终解析为 `BYCLAW_DSH_0027021534`。

解析流程如下：

1. 根据沙箱记录的 `sandboxType` 和 `profileKey` 读取合并后的 `SandboxServiceSpec`。
2. 读取并清理 `env.BYAI_WORKER_AGENT_TYPE`。
3. 配置非空时拼接用户编码，并以结果调用 Worker Registry 的 AgentType 在线查询。
4. Registry 返回动态 Worker ID 后，继续使用真实 Worker ID 查询最近心跳和租约 TTL。

同一环境变量也会沿用现有 Spec 渲染流程注入沙箱容器。新增沙箱实现只需维护 Spec，不需要为每个
Worker AgentType 增加 Java 枚举分支。

## Compatibility Fallback

未配置或配置为空时，继续使用原有兼容映射：

| Sandbox type | Worker AgentType base |
| --- | --- |
| `openclaw` | `BYCLAW_EXE` |
| `byclaw-code-agent` | `BYCLAW_CODE` |
| `byclaw-dsh` | `BYCLAW_DSH` |
| 其他类型 | Sandbox type 原值 |

这保证旧 Spec 无需立即更新；新类型应优先声明 `BYAI_WORKER_AGENT_TYPE`，不要继续扩展兼容分支。

## Sandbox Launch Routing

内置沙箱类型常量统一由 `SandboxLaunchRouting` 维护，包括：

- `DEFAULT_SANDBOX_TYPE`
- `BYCLAW_CODE_AGENT_SANDBOX_TYPE`
- `BYCLAW_DSH_SANDBOX_TYPE`

启动路由、记录查询、Worker 状态采集和服务注册必须复用这些常量，避免同一个沙箱类型在多个类中重复定义。

## Verification

修改 Spec AgentType 解析或路由逻辑后，至少运行：

```bash
mvn -B -f byclaw-be/pom.xml \
  -Dtest=SandboxServiceTest,SandboxLaunchContextFactoryTest,SandboxLaunchRoutingTest test
```

发布前按仓库规范运行完整后端验证：

```bash
mvn -B -f byclaw-be/pom.xml verify
```

## 按工号启动的自动释放策略

`POST /sandbox/launchByUserCode` 接受必填 `userCode`，可选 `serviceKey` 和 `autoRelease`。
`autoRelease` 为整数 `0`（手动释放）或 `1`（自动空闲释放），也兼容字符串 `"0"`/`"1"`；缺失或 null 沿用全局默认策略，其他值返回参数错误。
显式值仅影响本次新建的独占沙箱，同步设置记录的 `auto_release` 和 `lease_policy`；复用已有沙箱不修改原设置。
remote 模式透传到平台 `POST /internal/platform/sandbox/business/launch`，legacy 本地创建采用同样规则。
共享用户上下文仍由宿主/共享池管理，不通过该参数修改宿主回收策略。
手动释放模式会按既有机制持续续约；基础设施故障或续约失败仍可能导致远端实例过期。
`dsh-tool-env` 插件调用此接口时显式发送 `autoRelease: 1`。

## 常驻（共享）DSH 宿主

系统参数 `BYCLAW_SANDBOX_SHARED_POLICY`（`byai_system_config`）统一控制平台共享池和常驻 DSH 宿主的用户资格，替代 `BYCLAW_SANDBOX_SHARED_ALL` 和 `BYCLAW_SHARED_DSH_HOST_USERS`，旧参数不再参与判断。

```json
{"defaultMode":"shared","excludedUsers":["adminvip","zte"]}
```

字符串先解析为策略对象，再判断：排除名单内用户始终独享，其他用户按 `defaultMode`（`shared` 或 `exclusive`）处理。
配置使用 Fastjson 直接映射为对象。`excludedUsers` 使用字符串数组，工号去除首尾空白并区分大小写精确匹配，`*` 不作为通配符。
参数不存在、为空、模式不为 `shared` 或排除名单显式为 null 时不授予共享资格；读取或 JSON 解析失败时记录错误堆栈并返回无共享资格。省略排除名单时默认为空名单；空名单配合 `shared` 表示全部有效用户共享，`exclusive` 表示全部独享。
旧白名单不能直接迁移为排除名单，否则用户运行模式会反转；部署时需重新确认策略。
失去共享资格后的平台映射清理沿用既有流程及错误处理。

配置 `byclaw.sandbox.shared-dsh-host.base-url`/`token`/`web-base-url` 且未启用平台共享配置时，符合共享资格用户的 `byclaw-dsh`
使用常驻宿主进程中的用户上下文，BE 不为它写 `ss_sandbox_record`。

- 启动（登录自启动、问答前的 worker 就绪检查、`launchByUserCode`）= 对宿主做一次幂等的 `PUT /v1/users/{user}`，
  带上 `byclaw-dsh` 规格渲染后的环境；上下文已在时毫秒返回，不在时由宿主加载后返回。问答仍经 Gateway worker 注册转发，
  宿主重启后下一次请求会重新 PUT，不会出现指向失效上下文的记录。每次 PUT 的环境都重新渲染，`BEYOND_TOKEN` 是新签发的
  JWT：常驻上下文的生命周期远长于 `jwt.token.expired.hour`，宿主把每次 PUT 的 token 交给运行中的上下文，工具沙箱（B）
  以用户身份调 BE 时用的始终是最近一次问答的 token。
- 释放（`removeSandbox` 不带 resourceId、类型为 `byclaw-dsh` 或不指定）= 宿主 `DELETE`；其他类型照旧走平台或本地。
- 查询（`sandboxInfo`）把宿主上的上下文作为一条 `byclaw-dsh` 条目并入结果（宿主 `GET`），不读记录。
- 心跳/续约/空闲回收对这类上下文不做任何事：宿主按自己的空闲规则回收。
- 工具沙箱（B）由宿主上的运行时在第一次工具调用时经 `launchByUserCode` 按工具规格（`enabled=0`）启动；
  这类规格不会被记为用户首选规格，读取首选规格时也会忽略未开放的规格。新建 B 由插件显式开启自动空闲释放，复用已有实例保留原策略。
- 指定用户的工具沙箱：系统参数 `BYCLAW_TOOL_SANDBOX_BY_USER` 为 `userCode=service_key` 列表（逗号、分号或空白分隔，
  例如 `u1=byclaw-dsh-unity,u2=byclaw-dsh-unity`）。名单内用户 PUT 的环境里会带 `BYCLAW_TOOL_ENV_SERVICE_KEY`，宿主据此
  为该用户的上下文选 B 的规格；不在名单内或参数读取失败时用宿主默认的 `BYCLAW_TOOL_ENV_SERVICE_KEY`。上下文启动时读取，
  改参数后需该用户的上下文重建（“重启助理”或宿主回收后再次进入）才生效。

宿主路由通过 `SharedDshHostContexts.routes(userCode, sandboxType)`，复用 `SharedSandboxPolicy.eligible`，
两种执行模式（本地 / 平台远程）相同。名单每次决策时读取，改参数后下一次请求即生效。


### ACS 失败启动后的释放

平台托管模式下，管理页允许重试释放 `FAILED` 和 `RELEASING` 的个人沙箱记录。
Platform 必须确认该记录的远端实例消失、记录为 `RELEASED` 且执行占用已清除后，
管理接口才返回成功。取消请求仍在等待创建结果时，接口返回“释放尚未完成”，可稍后重试。
启动失败且没有 `sandbox_id` 时，按 `userCode + serviceKey + recordId` 定位残留，
删除前重新核对身份并使用 Kubernetes UID 前置条件，防止删除同名的新实例；NAS 数据不随之删除。

BE 两种 Docker 镜像的健康检查使用 `/byaiService/actuator/health`，默认端口 `8086`。
端口依次取 `SERVER_PORT`、`BE_SERVER_PORT`、默认值；上下文路径可由
`SERVER_SERVLET_CONTEXT_PATH` 覆盖（空值表示根路径）。

### 登录时配额准备中的自动恢复

个人独享沙箱在创建启动记录前调用 Platform 的 `storage/quota-check`，配额准备中返回
`StoragePreparingException`，交互调用保持等待语义，不生成失败的启动记录。
登录自启动仅对明确的存储准备状态每 15 秒重试，最多 80 次；等待期间同一用户的重复登录合并，
已成功的服务不重复启动。调度线程只提交任务，实际调用使用异步执行器并保留登录上下文。
手动按用户释放会取消本 BE 实例中排队的登录重试；新登录使用独立任务代次。
此调度状态不跨 BE 实例持久化；进程重启后由下一次登录或聊天重新触发。

### 提前申请新账号的个人配额

管理员新增账号和手机号、Apple、CAS 注册在账号事务提交后异步申请个人 NAS 配额。
复用 Platform 的 quota-check/reserve 与后台协调流程，任务不等待云端生效，不阻塞账号创建，
回滚事务不申请配额。失败由首次登录/聊天继续补偿；legacy 模式及关闭 NAS admission 时不申请。
仅预开通个人存储，不创建沙箱，也不批量扫描历史账号。目录配额的云端初始化仍可能需要数分钟；
提前创建账号可以把这段等待移到首次登录之前，刚注册立即聊天仍使用原有等待流程。

文件上传能力探测兼容较早版本 Platform：仅在分片上传能力接口返回 HTTP 404 或显式 `resumable=false` 时告知前端使用既有 multipart 上传接口；认证、网络和服务端错误继续上报。该兼容不会将远程存储切换为 BE 本地存储。

## Instance presentation context

A spec may declare `ports[].presentation: {viewer, label}` and `instanceBindings: {capability: [instance]}`. Publishing validates unique instance names, valid ports and existing binding targets. Runtime readers tolerate damaged optional presentation metadata; it must not stop sandbox execution.

Legacy specs that declare neither valid presentation metadata nor instance bindings keep a null creation context, preserving existing tool viewer behavior. Explicit empty bindings (`{}` or a capability with `[]`) and presentation-only specs opt into version 1; an empty target list is not treated as missing metadata.

Newly created runtimes return credential-free `instanceContext` (version 1, normalized sandboxId, optional mappingId, instanceBindings and instanceDescriptors). The launch CAS persists it separately in `ss_sandbox_record.instance_context_snapshot`; apply the authorized V0.6.0 migration before deploying this reader. Directory and allocation responses restore this snapshot and filter it to authorized endpoint keys. Existing NULL records and provider recovery without an actual creation snapshot remain legacy; current templates never reinterpret them. Shared context projection must not expose physical-host-only endpoints.

Restoration also validates nested descriptor types. A damaged optional snapshot disables its presentation context while preserving existing endpoints and runtime reuse; it does not rewrite the saved record.

Tool events carry optional root `AnswerDelta.instanceRefs` identities. Missing values retain legacy behavior; present invalid values become an explicit empty list. MessageContext unions valid identities by the exact sandbox/mapping/instance tuple and preserves them through streamed snapshots and stored messageStruct history. References never contain URLs, headers or tokens.


### 工具沙箱会话租约

`POST /sandbox/toolLease/{acquire,renew,release}` 将登录身份与工具会话身份分开处理。调用者只能为自身申请或归还租约，不能提交身份投影或替其他用户操作。BE 通过 Platform 协调租约，不再用断开 SSH 代表释放计算实例；Platform 不可用时请求失败，不回退到无租约启动。

工具实例为用户全局资源，每个活跃会话单独持有租约。最后一个租约归还或过期后，默认闲置 300 秒释放；Harness 的 `BYCLAW_TOOL_ENV_IDLE_MS` 可配置空闲时长。共享用户上下文释放携带宿主、映射和代次身份，连带清理对应工具实例；旧上下文不能释放替代上下文的资源。
