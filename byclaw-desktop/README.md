# ByClaw 桌面端

Electron 桌面客户端 + 本地 Agent 执行体，连接线上 ByClaw 平台。

- **桌面端**：Electron 壳加载 byclaw-fe 完整门户（鲸智百应），本地静态服务 + API 代理到线上网关
- **本地 Agent**：OpenClaw（npm 裸装，非容器）+ byai-channel worker，通过 Redis Stream 消费线上任务，执行在本地
- **数据/治理全线上**：会话、知识、任务、审计都在平台侧；模型凭证从线上 Redis 解析，不落本地
- **方案 A（全托管）**：桌面端启动 = Agent 上线，桌面端退出 = Agent 下线（窗口关闭仅最小化到托盘）

## 架构

```
本地机器 ────────────────┐
 ① Electron 桌面端（门户+代理+托盘+sidecar）
 ② OpenClaw worker（纯 JS 启动器 worker-launcher.mjs + openclaw 本地依赖）
 └──── Redis Stream（BYCLAW_EXE_<userCode>）────┐
线上平台（byclaw-be / byclaw-super / 数据层）──────┘
```

## 目录结构

```
byclaw-desktop/
├── main.mjs / preload.cjs     # Electron 主进程（配置化、worker 托管、代理加固）
├── lib/                       # config.mjs（配置加载）、icons.mjs（托盘图标）
├── worker/                    # worker-launcher.mjs（纯 JS 启动器）、login.mjs（登录换 token）
├── config/                    # 配置模板（config.json.example / openclaw.json.example / local-agent spec）
├── patches/                   # by-framework 补丁（任务消费灵敏度）
└── scripts/                   # 构建与部署脚本
```

## 快速开始

前置：Node.js ≥ 22.19（worker 由 launcher 自动探测 nvm node）

```bash
# 1. 安装依赖（含 openclaw@2026.6.6 本地依赖）
npm install

# 2. 一键部署（构建前端 + 扩展 + 生成配置模板）
npm run deploy

# 3. 填写用户配置（业界惯例：用户配置目录，可被 XDG_CONFIG_HOME 重定向）
#    ~/.config/byclaw/config.json
#    { apiBaseUrl, userCode, redis{host,port,password}, auth{username,password} }

# 4. 启动桌面端（Agent 自动跟随上线）
npm start
# 或独立启动 worker 调试
npm run worker
# 或打包分发（全平台 target，GitHub Releases 发布）
npm run dist
```

## 目录布局（XDG 标准，全平台一致）

```
~/.config/byclaw/config.json     ← 配置（唯一来源，严格模式；XDG_CONFIG_HOME 可重定向）
~/.local/share/byclaw/           ← 运行数据（XDG_DATA_HOME 可重定向）
  ├── runtime/                   ← OpenClaw 状态 / workspace / 会话历史
  ├── extensions/                ← 构建产物（npm run deploy 生成）
  ├── config/openclaw.json       ← OpenClaw 插件/通道配置（模板渲染）
  └── logs/                      ← 桌面端/worker 日志
```

## 配置说明（~/.config/byclaw/config.json）

| 字段 | 说明 |
| --- | --- |
| `apiBaseUrl` | 线上网关（如 `http://<host>:8080`，API 前缀 `/byaiService`） |
| `userCode` | 用户编码（worker 注册 agentType `BYCLAW_EXE_<userCode>`） |
| `redis` | 线上 Redis（host/port/password/mode/keySchemaVersion） |
| `worker.localRoot` | 本地数据根目录（默认 `~/.local/share/byclaw`，XDG_DATA_HOME 可重定向） |
| `worker.readBlockMs` | 任务消费灵敏度（默认 100ms） |
| `auth` | 登录账号/密码（仅 `login.mjs` 换 token 用；token 不落配置——凭证最小化） |
| `env` | 附加环境变量（可选，透传给 worker） |

## 运维

- 换 token：`node worker/login.mjs`（读配置账号）→ 更新 `config.json` 的 `auth.token`
- 重启 Agent：托盘 → 重启本地 Agent（崩溃 3s 自动拉起）
- 本地独占执行：管理页建 `local-agent` 沙箱规格（spec 模板见 `config/`），并设用户首选 serviceKey——云端容器不再注册 worker，任务全部由本地执行
- 清理残留：`rm -f /tmp/openclaw-1000/gateway.*.lock` + `DEL byai_gateway:registry:worker:agent_types:byai-channel-worker-*`

## 多平台分发（lobehub 同款模式）

- **构建**：electron-builder 三平台 target（win: nsis/portable、mac: dmg/zip、linux: AppImage/deb），`npm run dist:win|dist:mac|dist:linux`
- **CI**：GitHub Actions 三平台矩阵（macos/windows/ubuntu），tag 触发发布
- **分发**：GitHub Releases（`build.publish` 已配置 github provider），electron-updater 自动更新
- **签名**：macOS 需 Developer ID + 公证；Windows 建议代码签名证书
- **worker 跨平台**：纯 JS 启动器（worker-launcher.mjs），openclaw 为本地依赖；Windows 无需 nvm PATH 注入

## 已知边界

- 本地关机 = 数字员工下线（方案 A 语义）
- 线上 WS 网关未配置时，桌面端快速失败（502），不影响主功能
- 公网 Redis 明文部署时建议安全组白名单 + TLS
