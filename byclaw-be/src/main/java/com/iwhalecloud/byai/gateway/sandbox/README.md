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

## 常驻（共享）DSH 宿主

配置 `byclaw.sandbox.shared-dsh-host.base-url`/`token`/`web-base-url` 后，系统参数 `BYCLAW_SHARED_DSH_HOST_USERS`
（`byai_system_config`，逗号、分号或空白分隔的 userCode；不存在、为空或 `*` 表示全部用户）名单内用户的 `byclaw-dsh`
不再是沙箱：它是常驻宿主进程里的一个用户上下文，BE 不为它写 `ss_sandbox_record`，也不做启动/探测/复用。

- 启动（登录自启动、问答前的 worker 就绪检查、`launchByUserCode`）= 对宿主做一次幂等的 `PUT /v1/users/{user}`，
  带上 `byclaw-dsh` 规格渲染后的环境；上下文已在时毫秒返回，不在时由宿主加载后返回。问答仍经 Gateway worker 注册转发，
  宿主重启后下一次请求会重新 PUT，不会出现指向失效上下文的记录。
- 释放（`removeSandbox` 不带 resourceId、类型为 `byclaw-dsh` 或不指定）= 宿主 `DELETE`；其他类型照旧走平台或本地。
- 查询（`sandboxInfo`）把宿主上的上下文作为一条 `byclaw-dsh` 条目并入结果（宿主 `GET`），不读记录。
- 心跳/续约/空闲回收对这类上下文不做任何事：宿主按自己的空闲规则回收。
- 工具沙箱（B）由宿主上的运行时在第一次工具调用时经 `launchByUserCode` 按工具规格（`enabled=0`）启动；
  这类规格不会被记为用户首选规格，读取首选规格时也会忽略未开放的规格。经 `launchByUserCode` 拉起（或复用）的
  未开放规格沙箱在拉起后被改为手动释放（`auto_release=0`，平台远程模式经平台 `update-id`）：宿主通过 SSH 使用 B
  不会刷新 `last_access_time`，否则空闲回收会在任务执行中途把 B 释放掉。B 的自动回收另行设计，目前由人工释放。

决策点只有 `SharedDshHostContexts.routes(userCode, sandboxType)`（`SandboxAutoConfiguration#sharedDshHostContexts`），
两种执行模式（本地 / 平台远程）相同。名单每次决策时读取，改参数后下一次请求即生效。
