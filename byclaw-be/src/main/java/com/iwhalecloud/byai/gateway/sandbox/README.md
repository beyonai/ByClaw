# Sandbox Worker Agent Type Extension

本文说明沙箱类型如何通过 `sandbox_service_spec.spec_json` 声明 Worker AgentType，以及沙箱启动路由常量的维护约定。

租户资源规格以 `sandbox_service_spec.owner_scope=TENANT` 标记，个人启动入口会拒绝该规格；登录自动启动和个人实例查询仅处理 `owner_scope=USER`。租户 DB/Node 实例须经独立开通流程创建，不能保存为个人首选规格后启动。

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

配置 `byclaw.sandbox.shared-dsh-host.base-url`/`token`/`web-base-url` 后，系统参数 `BYCLAW_SHARED_DSH_HOST_USERS`
（`byai_system_config`，逗号、分号或空白分隔的 userCode；不存在、为空或 `*` 表示全部用户）名单内用户的 `byclaw-dsh`
不再是沙箱：它是常驻宿主进程里的一个用户上下文，BE 不为它写 `ss_sandbox_record`，也不做启动/探测/复用。

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

决策点只有 `SharedDshHostContexts.routes(userCode, sandboxType)`（`SandboxAutoConfiguration#sharedDshHostContexts`），
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
