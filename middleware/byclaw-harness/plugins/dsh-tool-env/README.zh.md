# @byclaw/dsh-tool-env

[English](README.md) | 中文

DSH 运行时（A）保留 Web 界面、Agent、模型、会话和配置；工具执行（文件、Bash 等进程、终端、PTC、沙箱策略）放到单独的工具沙箱（B）里。

**默认关闭。** 只有 `BYCLAW_DSH_TOOL_ENV` 为 `static`、`opensandbox` 或 `byclaw-be` 时才生效。未设置时 profile 仍用原来的本地 provider，行为不变。

## 工作方式

- **Provider 替换：** profile 补丁把基础行 `fs-sandbox`、`subprocess`、`sandbox`、`ptc-runtime` 换成 DSH 自带的 SSH provider。
- **`ctx.ssh` 就是本插件：** 一个稳定、可重连的连接租约。B 被暂停、删除或重建后，下一次操作会自动重连。
  - 不重放：B 消失瞬间正在执行的那一步会失败一次。
- **租约：** 第一次远程操作时创建 B，B 已暂停时则恢复它。
- **空闲：** 超过 `BYCLAW_TOOL_ENV_IDLE_MS`（默认 10 分钟）没有操作、也没有打开的流，就暂停 B。正在跑的命令和后台任务会占着流，所以不会被中途暂停。
- **消失：** B 已删除或过期时，下次自动重建。
  - `/by` 是与 A 共用的宿主机卷，暂停、重建都不丢用户文件。
- **身份：** A 在自己的私有 DSH 目录里生成客户端密钥和 B 的主机密钥，所以 A 能锁定 B 的主机密钥。`opensandbox` 模式随创建请求交给 B；`byclaw-be` 模式把 A 的这个目录只读挂进 B（`BYCLAW_TOOL_ENV_SEED_DIR`，默认 `/etc/byclaw-tool-env`）。
  - B 的 sshd 只接受这把钥匙登录 `byclaw` 用户。
- **密钥隔离：** 所有远程进程的环境变量都会去掉 `BYCLAW_TOOL_ENV_*`。A 的会话、凭据、profile 不会挂进 B。
- **沙箱：** 拆分模式下默认 `DSH_PERMISSION_MODE=danger-full-access`。
  - B 本身就是隔离边界。
  - 宿主机禁止用户命名空间时，容器里用不了 bwrap/Landlock，`workspace-write` 会拒绝所有命令。

## 三种后端

- `static`：连固定的 sshd，用于开发和测试。
- `opensandbox`：A 直接调 OpenSandbox 创建、暂停、恢复 B，OpenSandbox 的 key 在 A 手里。
- `byclaw-be`：A 以用户身份调 ByClaw BE 的 `POST /sandbox/launchByUserCode`，让 BE 按 `sandbox_service_spec` 里 `serviceKey`（默认 `byclaw-dsh-tools`）的规格创建或复用 B，再从返回的 `instanceEndpoints.ssh` 取 B 的 sshd 地址（规格里把 22 端口声明为 `tcp`）。A 只用 BE 注入给它的 `USER_CODE` 和 `BEYOND_TOKEN`，不再持有 OpenSandbox 的 key。返回地址连不上时，A 会 `removeSandbox` 一次再重新 launch。
  - 暂不做：空闲暂停/恢复（BE 没有 pause 接口），以及 A 释放时回收 B。两项都另行处理。
  - 已接受的现状：`launchByUserCode` 会把 `serviceKey` 记为用户首选规格；它按 body 里的 `userCode` 切换用户上下文。

A 和 B 必须用**同一个镜像**，否则 helper 摘要校验会拒绝连接。

配置项、限制说明见 [README.md](README.md)。
