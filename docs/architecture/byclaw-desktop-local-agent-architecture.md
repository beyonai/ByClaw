# ByClaw 桌面端 + 本地 Agent + 线上平台：完整链路方案与实施记录

> 2026-08-13 · Linux 本机 · 状态：核心链路已跑通并打包（`byclaw-desktop/` 已入库，分支 `feat/desktop-app`）

## 一、目标链路

```
┌─ 本地机器（Linux，非容器）──────────────────────────────────┐
│ ① 桌面端：Electron 壳 + byclaw-fe 完整门户（鲸智百应）          │
│    ├─ 本地静态服务 127.0.0.1:38080                            │
│    ├─ HTTP/WS 代理 → 线上网关（/byaiService/*）                │
│    ├─ 托盘：Agent 在线/离线状态（10s 轮询 Redis）              │
│    └─ sidecar：随应用启停本地 Agent worker                    │
│ ③ 本地 Agent：OpenClaw 2026.6.6（npm 裸装）                  │
│    ├─ byai-channel 扩展（by-framework worker）                │
│    ├─ baiying-enhance 扩展（数字员工同步 + baiying_call）       │
│    └─ byclaw-sqlite 扩展                                     │
└──────────────┬───────────────────────────────────────────┘
               │ Redis Stream（byai_gateway:ctrl:agent_type:BYCLAW_EXE_*）
               ▼
┌─ 线上服务（数据/治理全托管）──────────────────────────────────┐
│ byclaw-be（认证/会话/知识/文件/任务/审计）                      │
│ byclaw-super（编排调度，openclaw-by-framework connector）     │
│ 数据层：OpenGauss / Redis / MinIO                           │
└──────────────────────────────────────────────────────────┘
```

**分工**：数据、知识、会话、任务状态、审计全在线上；只有执行发生在本地（OpenClaw 读本地文件、跑本地命令、调线上工具）。模型凭证从线上 Redis 解析（`baiying-aimodel-redis`），不落本地。

## 二、组件清单（仓库视角）

| 组件 | 位置 | 说明 |
| --- | --- | --- |
| 桌面端工程 | `byclaw-desktop/` | Electron 33 + http-proxy，入口 `main.mjs` |
| 前端产物 | `renderer/`（构建产物，不入库） | byclaw-fe `pnpm build` 产物，`scripts/build-renderer.sh` 构建 |
| Worker | `byclaw-desktop/worker/` | `start-worker.sh`（配置化启动）、`login.mjs`（登录换 token） |
| OpenClaw | npm 全局 `openclaw@2026.6.6`（node ≥ 22.19） | 与线上镜像同版本，协议耦合 |
| 扩展 | 部署目录 `extensions/`（从 `byclaw-exe/extensions/` 构建） | baiying-enhance / byai-channel / byclaw-sqlite |
| 配置 | 用户配置目录 `~/.config/byclaw/config.json`（XDG 惯例） | 含线上连接、Redis、账号；`.example` 模板入库 |
| 运行时状态 | `~/.local/share/byclaw/runtime/` | OpenClaw state + workspace + 日志 |
| 分发产物 | `dist/ByClaw-*.AppImage`（构建产物，不入库） | electron-builder 打包 |

## 三、实施记录（含踩坑）

### M0 环境基线

- 本地 nvm 有 node v22.23.1（满足 openclaw/byclaw-super 的 >=22.19.0）
- 线上真实入口是 **网关端口**（`/byaiService/*`），后端内网端口不对公网
- 线上 Redis 明文 + 密码（`REDIS_TLS=false` 实测确认），Redis 7.4.9

### M1 本地 OpenClaw 裸装

- `npm install -g openclaw@2026.6.6`（对齐线上镜像版本，worker 协议耦合）
- 官方 npm 包**不含** ByClaw 扩展，需从仓库 `byclaw-exe/extensions/` 构建
- 扩展构建：`npm install && npm run build` → dist/，复制到本地目录并 chmod 755

### M2 方案 A POC（核心闭环）

- 关键发现：`byai-channel` 扩展就是 OpenClaw 侧的 by-framework worker（agentType=`BYCLAW_EXE_<USER_CODE>`，与线上 connector 默认投递目标完全对齐）
- 配置要点：
  - env：`USER_CODE`、`REDIS_HOST/PORT/PASSWORD`、`REDIS_MODE=standalone`、`REDIS_KEY_SCHEMA_VERSION=v1`
  - `openclaw.json`：`plugins.load.paths` 指向本地扩展目录；`secrets.providers.baiying-aimodel-redis` 需 `source:"exec"` + command=node + args=resolver CLI
  - 配置路径 env 是 `OPENCLAW_CONFIG_PATH`（不是 OPENCLAW_CONFIG_FILE）
- 验证：send-inbound-message.mjs 投递 → 本地执行 → 19 个流式事件回传 ✅
- 踩坑：插件目录 world-writable（777）会被安全策略拒绝 → 复制到 755 目录

### M3-M4 桌面端

- byclaw-fe 构建（`pnpm install && pnpm build`，dist 56MB）
- Electron 壳：本地静态服务 + `/byaiService` 代理线上网关 + WS 代理（线上 WS 未配置时快速失败 502，与 Web 端一致，不影响主功能）
- 线上前端页面在 `/beyond/`，API 前缀 `/byaiService/`
- 登录接口 `POST /byaiService/system/session/loginByUsername`：accountCode=AES-CBC、accountPwd=SM4-ECB（密钥硬编码在前端源码），响应顶层 `token`（JWT，24h）
- 托盘 + sidecar：随应用启停 worker、10s 轮询 Redis online key、崩溃自动重启、关窗最小化到托盘

### M6 打包

- AppImage 单文件（~127MB）✅；deb 未打（electron-builder 需 fpm，可选）
- 坑：`set -u` 下 source nvm.sh 必炸 → 改为直接注入 nvm node 目录到 PATH

### 经典坑清单

1. `pkill -f "xxx"` 会匹配执行命令的 shell 自身 → 用 `[x]xx` 方括号技巧
2. 并行文件编辑有写回竞态（后写的覆盖先写的）→ 敏感修改串行执行
3. SIGKILL 杀 openclaw 会残留 `/tmp/openclaw-1000/gateway.*.lock` → 重启前删除
4. worker_id 残留注册 → `DEL byai_gateway:registry:worker:agent_types:byai-channel-worker-*`
5. openclaw 网关 `--bind=lan` 强制要求 auth，本地用 `--bind=loopback`
6. shell 花括号展开 `a/{b,c}` 在 sh 下不生效 → 逐个 mkdir

## 四、端到端验证矩阵

| # | 验证项 | 方法 | 结果 |
| --- | --- | --- | --- |
| 1 | 线上 API 可达 | curl 网关 | ✅ 200/401 正常 |
| 2 | 登录换 token | login.mjs（AES+SM4 复现） | ✅ code=0 |
| 3 | token 认证 | currentUser 接口 | ✅ code=0 |
| 4 | 数字员工同步 | worker 日志 | ✅ 10 个 agent 全部同步，模型从 Redis 解析 |
| 5 | worker 注册 | Redis EXISTS online key | ✅ :1 |
| 6 | 端到端对话 | send-inbound-message.mjs | ✅ 19 chunks 流式回传 |
| 7 | 门户服务 | curl 38080 | ✅ 200（鲸智百应） |
| 8 | 代理链路 | 38080 → 网关 | ✅ 认证响应正常 |
| 9 | 桌面端+sidecar | AppImage 全流程 | ✅ ONLINE + 门户 200 |
| 10 | 断线恢复 | connector resumable:true + cursor | 架构具备（未专项测试） |

## 五、运维手册

```bash
# 启动（配置自动读取 ~/.config/byclaw/config.json，无需任何 env / --no-sandbox）
./dist/ByClaw-0.1.0.AppImage &

# 开发模式
cd byclaw-desktop && npx electron .

# 配置（业界惯例：用户配置目录）
# ~/.config/byclaw/config.json（XDG_CONFIG_HOME 优先）；兜底兼容旧 online.env；BYCLAW_CONFIG_FILE 可自定义路径
# 字段：apiBaseUrl / userCode / redis{host,port,password,mode} / worker{script,localRoot,readBlockMs,groupChatContextBaseUrl} / auth{token} / env{}

# 换 token
node worker/login.mjs   # 读配置账号；成功后更新 config.json 的 auth.token

# 清理残留
for pid in $(pgrep -f "[b]yclaw-desktop"); do kill -9 $pid; done
pkill -9 -x openclaw
rm -f /tmp/openclaw-1000/gateway.*.lock
```

## 六、遗留事项与后续路线

### 已确认可用

- 方案 A（Redis Stream 直连）全链路 ✅
- AppImage 分发 ✅（依赖外部：node22 + 全局 openclaw + 部署目录）

### 待办

1. **M5 反向 SSE connector**（生产化最优解）：本地 agent 出站注册到 byclaw-super，替代 Redis 直连，企业防火墙友好。方案已验证可行（`third-party-interface-sse` 是平台出站 fetch，需新增反向连接器；connector SPI 在 `byclaw-super/packages/connectors/`，实现 `AgentConnector` 接口 + app 注册即可）。**阻塞**：需线上 byclaw-super 部署配合。
2. **内网端口放行**：若安全组放行本机公网 IP，baiying-enhance 的 workspace 远程恢复将正常（当前超时跳过，不影响功能）。
3. **Redis 安全**：线上 Redis 明文公网 + 弱密码，建议安全组白名单 + TLS（需线上运维）。
4. **deb 打包**：electron-builder 装 fpm 后 `--linux deb`。
5. **桌面通知**：任务完成/需确认时系统通知（byai-channel 事件流已有，接 Notification API 即可）。
6. **多机**：桌面端可在任何机器跑（连同一线上服务），worker 唯一性靠 Redis 注册保证（同 userCode 多 worker 会争抢，注意 BYAI_WORKER_ID 区分）。

### 风险

- 本地关机 = 数字员工下线（桌面端侧边栏/托盘可见）
- 凭证最小化已落地：模型 key 在线上 Redis、Beyond-Token 24h 短期、真实配置不进仓库

## 七、延迟排查与优化记录（2026-08-13）

### 沙箱竞争与本地独占

- 线上沙箱 worker 与本地 worker 同 agentType 同消费组，Redis Stream 轮询分发；沙箱自愈（SandboxReconcileJob 60s 对账 + 登录拉起 + 定时预启动）无法从本地阻止
- 解法（已实施）：管理页新建沙箱规格 `service_key=local-agent`，spec_json 复用 openclaw 默认，template_json 禁用 byai-channel → 云端容器不注册 worker；通过 `launchByUserCode` 设用户首选 serviceKey → 本地独占执行
- 规格模板：`byclaw-desktop/config/spec-local-agent.*.json`

### 两处本地延迟优化（已生效）

- `BY_FRAMEWORK_READ_BLOCK_MS=100`：本地 XREADGROUP 阻塞 2000ms→100ms（补丁：`patches/by-framework-read-block.patch`），投递→消费实测 155ms
- `BYAI_GROUP_CHAT_CONTEXT_BASE_URL`：默认走 Redis 服务发现→内网地址（本地不可达）干等 10s 超时（elapsedMs=10284）；直连网关后 120ms——每轮省 10.2s

### 剩余固定开销

- OpenClaw run 启动 ~1.7s（内核固定成本）；模型/上下文构建 ~1s
- 线上 connector 读事件流 BLOCK 1000ms（平均 0.5s，需平台方在 byclaw-super 加 readBlockMs 配置：`app/config/index.ts` 加字段 + `app/runtime/index.ts` 传入 `??100`）
- 公网 Redis RTT ~46ms × 多跳

## 八、方案 A：桌面端全托管 worker（2026-08-13）

- 语义：桌面端启动 = worker 启动，桌面端退出 = worker 退出（窗口关闭仅最小化，托盘驻留 worker 继续跑）；崩溃 3s 自动拉起；托盘可重启
- 单一管理者原则：启动时探测 Redis worker online key——外部 worker 在线则跟随显示（不重复拉起，避免 gateway 锁冲突 78）；不在线则由桌面端 spawn 托管（workerManaged 标志）
- worker 不再手动启动（独立 nohup 方式废弃）
- 代理加固（同版本）：上游 keep-alive 连接复用（maxSockets 64）+ 30s 超时 + WS 快速失败（线上未配置 WS，直接 502 避免 read ETIMEDOUT 挂起）
