# Slim Harness 与工具沙箱

新增构建链为 `Dockerfile.base_slim` → `Dockerfile.slim` → `Dockerfile.tool_slim`。
原有 `Dockerfile.base`、`Dockerfile`、`Dockerfile.extensions`、`Dockerfile.tools` 保持不变。
所有命令均从 **ByClaw 仓库根目录**执行。

## 镜像职责

| 镜像 | 内容 | 不包含/不启动 |
| --- | --- | --- |
| `base_slim` | Python 3.12、Node 22.19、pnpm、DSH 0.2.1-rc.2、CodeGraph、Git、SSH 客户端和基础运行库 | Chromium、桌面/VNC、Java、FFmpeg、Office；上游构建用的系统编译工具留在 builder |
| `slim`（A） | Harness Web、模型与会话、全部本仓库插件、共享 Skills、SSH 工具代理 | 本地浏览器、业务 Python CLI、企业连接器 CLI、Java/媒体/Office 工具、系统编译器 |
| `tool_slim`（B） | 从对应 A 镜像继承相同 Node/SSH helper/插件依赖；增加 SSH 服务、浏览器、byCLI、VNC、Java、FFmpeg、Office、字体、编译工具和业务 CLI | 不启动 Harness Web/模型服务；按需启动浏览器 |

`tool_slim` 的名字表示属于 slim 部署链，**它仍然是包含重型工具的沙箱镜像**。
A 的插件编译和 managed profile 安装都使用一次性 builder，避免原生模块（如 node-pty）在精简运行层中找不到编译器。
最终层保留 DSH 工作区依赖和加载所需的 TS/客户端源码，没有盲目执行 `pnpm prune --prod`。
这部分仍占空间，不能承诺镜像已缩到几百 MB。

## 构建顺序

```bash
# 1. 可复用轻量基础镜像；业务插件改变时通常不必重建这一张。
docker build -f middleware/byclaw-harness/Dockerfile.base_slim \
  -t 192.168.0.81:8080/byclaw/dsh-base:0.2.1-rc.2_slim .

# 2. 默认 BASE_IMAGE 已设置为上述地址。
docker build -f middleware/byclaw-harness/Dockerfile.slim \
  -t 192.168.0.81:8080/byclaw/byclaw-harness:D0.6.0_slim .

# 3. 从刚构建的 A 制作 B，保持 helper 路径、内容和插件版本一致。
docker build -f middleware/byclaw-harness/Dockerfile.tool_slim \
  --build-arg HARNESS_IMAGE=192.168.0.81:8080/byclaw/byclaw-harness:D0.6.0_slim \
  -t 192.168.0.81:8080/byclaw/byclaw-harness:D0.6.0_tool_slim .
```

可将 `docker` 替换为正常运行的 `podman`。发布时建议让 B 的 `HARNESS_IMAGE` 指向此次 A 的不可变 digest，避免并行构建覆盖标签。
三张镜像使用相同 CPU 架构；不要把以前的完整 Harness 标签当成 slim 基础镜像。
`DSH_REF`、镜像源和版本参数沿用原构建方式，`NPM_REGISTRY` 可覆盖插件安装源。

## 启动与部署配置

A 必须设置 `BYCLAW_DSH_TOOL_ENV=static`、`opensandbox` 或 `byclaw-be`，其余参数沿用
[工具环境配置](plugins/dsh-tool-env/README.md#configuration)。未选择远程工具环境时，slim 入口直接报错。
A 默认 `BYCLAW_BROWSER_ON_TOOL_ENV=1`，只启动本地私有 RPC 代理，不创建本地 Chromium/Xvfb。
单用户和 `multi-host` 都走同一远程浏览器分支。

将 B 的沙箱服务规格镜像改为 `D0.6.0_tool_slim`，保持原有 SSH 身份配置、用户工作区 `/by` 挂载及读写权限。
B 以 root 启动 SSH/监督进程，浏览器和用户命令降权为 `byclaw`（UID 1001）。每个用户上下文配自己的 B；不要让多个用户上下文共用一个 B 的浏览器端口。
以下是已有规格需要采用的字段，卷和密钥配置仍沿用原规格：

```json
{
  "image": "192.168.0.81:8080/byclaw/byclaw-harness:D0.6.0_tool_slim",
  "startup": { "entrypoint": ["/usr/local/bin/byclaw-dsh-entrypoint", "tools"] },
  "ports": [
    { "port": 22, "instance": "ssh", "protocol": "tcp" },
    { "port": 8081, "instance": "bycli-browser", "protocol": "http" },
    { "port": 8082, "instance": "browser", "protocol": "http" }
  ]
}
```

新 B 镜像中的兼容入口也指向工具沙箱启动器，因此 BE/OpenSandbox 使用原来的 `byclaw-dsh-entrypoint tools` 不会跳过浏览器监督进程。
A 的启动入口则应使用镜像默认 `byclaw-lean-entrypoint`；若现有规格显式覆盖 A 的 entrypoint，需要一并改成这个入口。
现有工具环境的 SSH-over-WebSocket 接入（通常端口 8022）仍可用，按原部署另行声明该端口。

**浏览器访问地址必须切换到 B 的 endpoint**，A 不再提供 8081 浏览器服务。
原生 `browser` 默认使用 B:8082；`bycli` 使用 B:8081。它们有独立 profile、显示号和端口，不共享登录态，旧 A 上的登录态也不会自动复制。
原生浏览器可在 A 上设置 `BYCLAW_TOOL_BROWSER_VIEWER=none` 关闭桌面，或设置 `BYCLAW_TOOL_BROWSER_VIEWER_PORT` 改端口。
B 上 `BYCLAW_BYCLI_ENABLED=false` 可关闭 byCLI 浏览器监督，只保留原生远程浏览器。
noVNC 仍应经过现有用户身份鉴权网关；本次未修改线上服务规格、数据库或前端入口路由。

## 浏览器执行与生命周期

- A 通过上下文的 SSH subprocess 服务启动 B 中的 `tool-environment-bridge.js`；本地 Unix socket 首帧先认证，随后透传原有 broker 请求/取消/响应。
- secret 经 SSH stdin 和 B 的匿名 FD 传递，不放入命令行或环境变量；连接断开不重放已执行的浏览器操作。
- 首次浏览器调用才创建/唤醒 B 和浏览器进程。最后一个原生 lease 关闭后，空闲超时（默认 30 秒）退出桥接进程，释放 SSH 活跃流，让工具环境原有 idle 策略生效；有活动 lease、goal 或待完成请求时不会因此退出。`idleBrowserMs=0` 关闭该桥接空闲退出。
- 截图、普通下载保留在 B 的 `/by/.browser/<context-id>/r/<generation>/`；goal 下载复制到 B 的 `/by/.browser/<context-id>/artifacts/`。A 不再用本地文件 API 复制远程路径。
- 原生持久化 profile 位于 `/by/.browser/<context-id>/browser/user-data`；byCLI profile 位于 `/by/.bycli/browser/user-data`。持久化 `/by` 才能跨 B 重建保留这些数据。
- byCLI 使用原有 on-demand supervisor 和 managed wrapper。原生浏览器不加载 byCLI 扩展，避免两个浏览器争抢 byCLI daemon。goal 的 start/state/暂停接管协议仍在原生 browserd 中执行。
- B 删除/重启会丢失正在运行的 browser lease；原有控制器清理失效状态，后续调用重新打开浏览器。

## 体积证据与验证范围

2026-10-23 对旧 Harbor `D0.6.0` 的 linux/amd64 manifest 进行只读检查：
压缩层合计 **3150.27 MiB（约 3.08 GiB）**，不是容器解压后占用。
其中 OS 工具层约 746.79 MiB，浏览器安装层约 468.78 MiB；另有两个依赖/构建层约 776.34、629.42 MiB。
这些数值只能用于定位主要来源，不能直接相加当作新镜像的节省量。
旧镜像 digest：`sha256:328a2518ed65e85703c55322d3204c9538dc0b4be260279cf7013d83c13437cb`。

本地检查命令：

```bash
node middleware/byclaw-harness/scripts/lean-harness-verify.test.mjs
bash middleware/byclaw-harness/scripts/docker-browser-layout-verify.sh --dockerfile Dockerfile
bash middleware/byclaw-harness/scripts/docker-browser-layout-verify.sh --dockerfile Dockerfile.extensions
python3 -m unittest discover -s middleware/tests -p 'test_shared_builtin.py'
node --test middleware/tests/shared-builtin-portability.test.mjs
```

浏览器插件在 DSH 0.2.1-rc.2 工作区内执行 `tsc` 和 Vitest；
`BYCLAW_TEST_CHROMIUM=<本机 Chromium 路径> pnpm exec vitest run tests/tool-environment-browser.e2e.spec.ts`
执行真实浏览器子进程测试。该测试模拟 SSH subprocess 接口，**不等同于实际 SSH、Linux noVNC 或 byCLI 联调**。
现有 owned-runtime 孤儿回收测试依赖 Linux `/proc`，macOS 不能据此确认通过。

本次 macOS 验证：插件 TypeScript 编译通过；Vitest **306 通过、2 跳过**（Linux `/proc` 孤儿回收和未启用的 goal 实浏览器用例）。真实 Chromium 的远程桥接、截图、下载、goal 控制、空闲退出及重连用例已执行通过；两张旧 Dockerfile 布局检查、slim 启动/FD 检查、共享资源 7 项 Python 和 1 项 Node 测试通过。

当前没有实际构建新镜像，也没有测量新镜像大小或验证模型调用；Dockerfile 内的 native-module/profile/工具检查需在构建机实际执行。
部署验收应覆盖 A 启动、首次 SSH 冷启动、两种浏览器入口、下载取回、noVNC 接管、B 重启及退出清理，并分别比较 registry 压缩大小和本地解压大小。
