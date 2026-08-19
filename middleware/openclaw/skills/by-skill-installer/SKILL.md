---
name: by-skill-installer
description: 按 skillCode 在 byclaw 平台查找内置技能并绑定到数字员工，让 agent 能使用该技能。当用户要求给 agent 启用、绑定、解绑平台内置技能，或查询某个技能是否已关联到当前数字员工时使用。
---

# By Skill Installer

按 skillCode 找到 byclaw 平台上的内置技能（`skillType=inner`），把它和数字员工建立关联，agent 随后即可调用该技能。

内置技能随运行时镜像一起提供，本地不需要下载任何文件，缺的只是数字员工与技能之间的关联关系，本工具补的就是这一层。

所有命令统一入口：

```bash
node scripts/by-skill-installer.mjs <command> [options]
```

输出恒为 JSON。`ok: false` 时进程退出码为 1。

## 解析链路

平台没有按 skillCode 直查的接口，skillCode 要先换成资源ID：

1. `POST /byaiService/auth/privilegeGrant/listResourceUseAuth` —— 传 `resourceBizTypeList: ["SKILL"]` 与 skillCode 作 keyword，返回结果里 `resourceCode` 即 skillCode，`resourceId` 即资源ID。只取 `skillType=inner` 的条目
2. `POST /byaiService/digitalEmployeeController/installRelResources` —— 用 `{digitalEmployeeId, relIds}` 建立关联

绑定接口是增量语义：后端把 `relIds` 与已有关联取并集，不会覆盖数字员工已绑定的其他资源。解绑接口只移除传入的 ID。

## 数字员工的确定顺序

1. `--digital-employee-id <id>`
2. 环境变量 `BAIYING_DIGITAL_EMPLOYEE_ID` / `DIGITAL_EMPLOYEE_ID` / `RESOURCE_ID`
3. 工作目录名 `workspace-baiying-agent-<id>`
4. 环境变量 `BYAI_WORKER_ID=openclaw-<usercode>`
5. JWT `BAIYING_AGENT_AUTH` 的 `sub` claim
6. Beyond-Token 里的 `defaultDigitalEmployeeId`

都拿不到时报错，不做猜测。OpenClaw 运行时通常会注入第 3/4/5 项之一。

## 命令

### bind

绑定技能到数字员工。已绑定的跳过，不重复调接口。

```bash
node scripts/by-skill-installer.mjs bind --skill-code fol-auto-biztravel
node scripts/by-skill-installer.mjs bind --skill-code a --skill-code b        # 批量
node scripts/by-skill-installer.mjs bind --skill-code demo --dry-run          # 只解析不改关联
node scripts/by-skill-installer.mjs bind --skill-code demo --digital-employee-id 123
```

| 选项 | 说明 |
| --- | --- |
| `--skill-code <code>` | 技能编码。可重复传入批量绑定 |
| `--skill-id <id>` | 可选，直接给资源ID绕过 skillCode 解析。与 `--skill-code` 同传时数量须一致 |
| `--digital-employee-id <id>` | 可选，目标数字员工，默认按上面的顺序推导 |
| `--owner-type <type>` | 可选，限定权限查询的归属范围 |
| `--dry-run` | 只解析目标并报告将要变更的技能 |
| `--timeout-ms <ms>` | 单次请求超时，默认 30000 |

一个 skillCode 命中多个内置技能条目时会报错并列出候选ID，此时用 `--skill-id` 指定。

写入后会重新查询绑定关系做校验。接口返回成功但关系没落库的技能进入 `verifyFailed`，同时整体 `ok: false`、退出码 1，不会算进 `changed`。

### unbind

解除关联，选项同 `bind`。未绑定的跳过。

```bash
node scripts/by-skill-installer.mjs unbind --skill-code demo
```

### list

列出数字员工当前已绑定的技能。`inner: true` 是内置技能，`false` 不是，`null` 表示 skillType 没拿到、无法判断。

```bash
node scripts/by-skill-installer.mjs list
node scripts/by-skill-installer.mjs list --digital-employee-id 123
node scripts/by-skill-installer.mjs list --owner-type enterprise
```

绑定关系接口不返回 skillType，缺失时用权限列表补一层，`skillTypeEnrichment` 说明这层的结果：`auth-list` 正常，`auth-list-truncated` 命中分页上限可能没覆盖全，`unavailable: <原因>` 补全失败。补全失败只会让部分条目的 `inner` 变成 `null`，`list` 本身照常返回。

### status

对指定 skillCode 报告解析结果与绑定状态，附带后端地址来源与鉴权可用性，便于排查连不通或没登录的情况。

```bash
node scripts/by-skill-installer.mjs status --skill-code fol-auto-biztravel
```

## 约束

- 只接受 `skillType=inner` 的内置技能。非内置技能不在本工具范围内，解析阶段就会报“未找到”
- skillCode 限 `[A-Za-z0-9._-]`，不允许 `.`、`..` 或以 `.` 开头
- 解析不到 skillCode 时列出当前可见的内置技能，便于确认是权限问题还是拼写问题
- 每个 skillCode 独立解析，单个失败不阻塞其余目标；有失败项时整体 `ok: false`

## 环境变量

| 变量 | 用途 |
| --- | --- |
| `BYAI_SERVICE_BASE_URL` / `SKILL_INSTALLER_URL` | 显式后端地址，优先级最高 |
| `REDIS_HOST` + `BE_DOMAINNAME` | Redis 服务发现（默认服务名 `ByaiService`） |
| `BE_PROTOCOL` / `HOST` / `BE_SERVER_PORT` | 兜底组装地址 |
| `BAIYING_DIGITAL_EMPLOYEE_ID` | 默认数字员工ID |
| `BAIYING_AUTH_FILE` / `BEYOND_TOKEN` / `USER_CODE` | 鉴权来源 |

后端地址优先级：显式环境变量 → Redis 服务发现 → HOST 兜底。

鉴权从 OpenClaw auth 文件读取，环境变量可覆盖；带 `beyond-token`、`X-User-Id`、session cookie 与 HMAC 签名头。
