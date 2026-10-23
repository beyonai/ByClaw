# ByClaw Harness 模块

本目录与 `middleware/openclaw/` 一样，由 ByClaw 仓库直接管理源码，不使用 Git 子模块。

## 来源

- 上游仓库：https://github.com/beyonai/byclaw-harness.git
- 分支：`2026.9.8`
- 提交：`fe42f0391b6b3679a1945364b3b6aebb137ba9fe`
- 同步日期：2026-10-15

本次导入上游已提交文件，不包含 `.git`、本地环境配置、依赖目录或其他未跟踪文件；
上游误跟踪的 22 个 Python 字节码缓存文件也不纳入模块。
原工作副本 `/Users/chenxiaofeng/code/open/byclaw-dsh` 保留。

## 构建

构建上下文统一为 ByClaw 仓库根目录。共享资源位于 `middleware/builtin`，
本目录的 `builtin` 为兼容本地工具的相对符号链接；Docker 直接复制共享目录。

在 ByClaw 仓库根目录执行：

```bash
docker build -f middleware/byclaw-harness/Dockerfile.base -t byclaw/harness-base:2026.9.8 .
docker build -f middleware/byclaw-harness/Dockerfile \
  --build-arg BASE_IMAGE=byclaw/harness-base:2026.9.8 \
  -t byclaw/byclaw-harness:2026.9.8 .
```

`Dockerfile.extensions` 使用同样的根目录上下文。两个业务 Dockerfile 各自配有
`Dockerfile*.dockerignore`，仅发送 harness 与共享 builtin，排除依赖、缓存及本地环境配置。

上述命令先构建基础镜像，再显式传入业务镜像，覆盖上游 Dockerfile 的基础镜像缺省值。
基础镜像构建需要访问上游 DSH 源码和依赖源，详见 `Dockerfile.base`。
模块使用方式见 [README.zh.md](README.zh.md)；本地开发前置条件见 [LOCAL-START.md](LOCAL-START.md)。

### 插件依赖来源

两个业务 Dockerfile 在安装插件依赖前执行 `scripts/docker-workspace-prepare.mjs`。
该脚本读取基础镜像的工作区包清单，为宿主已有的全部 `@deepseek-ai/*` 包建立根级
`link:` overrides，覆盖插件的直接依赖、传递依赖和 peer 依赖，包含 `plugins/*/packages/*`
内的嵌套包。Cordis、Schemastery 和 DSH 服务因此使用同一份宿主包及类型声明，避免
`Context` 缺少服务属性或事件声明不兼容。日志打印统一的宿主包数量；基础镜像缺少
Cordis 源码包时立即失败。

规则只写入构建阶段的临时工作区，不改写插件独立开发、发布时的版本约定；第三方包
及非宿主包沿用原配置。最终 profile 继续使用已有的官方初始化和模块回退机制，
不会复制构建目录的 `link:` overrides。

回归入口为 `node middleware/byclaw-harness/scripts/docker-workspace-prepare.test.mjs`，
需要可解析的 `js-yaml`、TypeScript 和 pnpm。测试执行离线安装，验证顶层、嵌套、传递和
peer 依赖的实际链接及 `Context` 声明合并，并检查重复执行与现有构建脚本策略。
这些测试不替代完整镜像构建和容器启动验证。

本次接入仅纳入源码及原有构建入口；未注册新的部署服务或修改现有中间件镜像流水线。

## 飞书与企业微信 CLI

两个业务 Dockerfile 在最终运行阶段通过 npm 安装 `@wecom/cli@0.1.9` 和
`@larksuite/cli@1.0.85`，默认版本与 OpenClaw 主 Dockerfile 对齐。构建时检查 CLI 版本，
并以 `byclaw` 用户执行帮助命令；安装或检查失败会中断构建。共享技能继续使用
`middleware/builtin/skills`，授权文件仍由运行时的用户私有目录提供。

回归测试入口为 `python3 -m unittest discover -s middleware/tests -p 'test_harness_connector_cli.py'`。
测试提取实际安装指令并使用本地桩覆盖成功、安装失败、命令缺失、版本错误和帮助命令失败；
不下载 npm 包，也不验证真实容器权限。交付前还需构建目标架构镜像，并从 DSH 执行入口验证
`LARK_HOME`、`WECOM_HOME` 与用户凭证挂载一致，完成测试账号的授权及只读业务验收。
版本和帮助命令通过只表明 CLI 可执行，不能据此认定连接器已经授权或业务可用。

## 后续同步

在独立工作副本获取指定上游分支，确认提交后，将已提交源码同步到本目录，排除 Git 元数据、
依赖和缓存。同步前先检查本目录的 ByClaw 定制改动，保留本说明，并更新这里记录的来源提交。

共享资源后续应同步到 `middleware/builtin`，不要覆盖兼容符号链接。

### Web 插件组成图启动优化

业务镜像执行 `prepare-dsh-client-modules.mjs`，仅支持固定的 DSH `0.1.5-rc.2`，
然后执行 `tsc -b packages/client/modules/tsconfig.json` 和
`tsdown --env.DSH_BUILD_FACE client --filter packages/client/modules`。
该包的 host 阶段会跳过构建，因此必须使用 client 阶段同时产出 Node 与浏览器端文件。
两个 Dockerfile 都复制最新 `src`/`lib`。无需调整运行 `.env`。

在已有编译工作区中执行验证（`DSH_ROOT` 指向该工作区）：

```bash
node --test middleware/byclaw-harness/scripts/startup-client-patch.test.mjs
node middleware/byclaw-harness/scripts/startup-client-modules-verify.mjs
```

原版与候选都可附加 `--oracle` 输出脱敏夹具的四代 JS/map 摘要，用于字节等价对照；
该模式不执行性能计数断言，正常验证必须再运行不带此参数的命令。
[完整结果及 ACS 验收边界](docs/startup-2026-10-22/client-composition-report.md)。

### 构建末尾的 Browser Bridge 检查

`browser-supervisor-verify.py` 在 supervisor 确认重连完成后才结束恢复测试，
不会把 daemon/status 的调用计数当成就绪信号。构建失败会保留实际错误检查；
无需关闭该校验或调整 byCLI 版本。[竞态原因与验证记录](docs/startup-2026-10-22/build-supervisor-race.md)。

### 浏览器启动时加载并验证本地扩展

每次 Chromium 启动都从 `BYCLAW_BROWSER_EXTENSIONS` 指向的本地目录加载扩展，镜像默认
为 `/opt/nvm/current/lib/node_modules/@sovovs/bycli/extension`。扩展随本地 byCLI 安装包更新，
启动流程不联网安装或升级，不需要手动执行 reload 命令。

`shared-novnc` 下，supervisor 在扩展连接后自动运行 `bycli doctor --json`，确认运行中的
构建与当前本地安装文件一致（`extensionBuildVerified: true`）、`uploadReady: true`、
能力包含 `dialog-policy-v1`，并检查 daemon 非陈旧和实际连通性。只有全部通过才记录
`local extension verified` 并将浏览器标为就绪；缺失字段、旧构建或能力缺失都会在超时后
明确报错，不把“已连接”当作“已加载本地最新构建”。这些检查不执行平台上传验收。

默认 `on-demand` 仍在首次浏览器调用时启动和校验；`eager` 在容器启动阶段完成后才启动
DSH。浏览器意外退出后自动拉起的新实例也重新校验本地构建。容器内替换扩展文件不会改变
已经运行的 Chromium；本机制在下次浏览器启动时加载替换后的文件。

两个 Dockerfile 的基础镜像缺省统一为 `byclaw/harness-base:2026.9.8`，可通过
`BASE_IMAGE` 覆盖；byCLI/扩展版本与安装步骤按主 Dockerfile 对齐，主文件的版本锁定
保持不变。“最新”指本地已安装的代码，不指 npm 仓库最新版。旧安装包缺少所需
构建元数据或能力时会校验失败，需要另行更新本地安装包。

回归入口为 `python3 middleware/byclaw-harness/scripts/browser-supervisor-verify.py`。
测试覆盖普通/按需启动、扩展构建与能力门禁、连接恢复、超时和退出清理；使用模拟
browserd/byCLI，不替代完整业务镜像构建和真实扩展验收。


### 持久目录解析与首用浏览器初始化

镜像启动仍保留 supervisor 管理私密 FD、首用 browser/byCLI 激活和子进程回收；
`on-demand` 模式不再提前创建/锁定 NAS 浏览器 profile，首次调用时才取得独占锁。
日志增加 `startup phase=prepared` 和 `startup phase=cli-spawned`，可区分 CLI 之前的准备开销。

编译 CLI 自动加载镜像内的 `startup-module-resolver.cjs`：只在 entrypoint 管理的两个
`node_modules` 链接布局匹配时启用。普通包解析改用对应的本地镜像目录，保留 Node
exports/conditions、包优先级、相对模块和自定义祖先目录回退；不改变持久配置和业务数据路径。
Typert 的 manifest 解析在构建时补丁并编译；client source map 按已有字节快照缓存序列化结果。
两个 Dockerfile 均包含新产物，不需要补充运行环境配置，也不需要修改只读上游 DSH 源码。

新增验证入口（在 `middleware/byclaw-harness` 目录执行，`DSH_ROOT` 指向测试/构建工作区）：

```bash
node --test scripts/startup-module-resolver.test.cjs scripts/startup-extra-patches.test.mjs
node scripts/startup-client-modules-verify.mjs --maps-optimized --oracle
node scripts/startup-typert-verify.mjs
python3 scripts/browser-supervisor-verify.py
```

完整结果见[启动优化与验收边界](docs/startup-2026-10-22/startup-extreme-report.md)。
