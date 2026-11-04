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

### 企业技能名称兼容

个人技能发布到企业后，展示名、ZIP 文件名（不含 `.zip`）和 `SKILL.md.name`
统一为 `原名_企业`；发布时将原名中的非法字符替换为下划线并合并连续分隔符。
为与 OpenClaw 使用同一个技能包，Harness 不把包内名称转换成资源 ID。
业务镜像的 `prepare-dsh-skill-names-021.mjs` 仅对固定的 DSH `0.2.1-rc.2` 扩展名称语法：
Unicode 字母、数字可使用 `-` 或 `_` 分隔，仍拒绝路径、空白、括号和标签字符。
补丁覆盖原生注册表、`skill` 工具所用校验器以及 `/技能名` 识别，ByClaw 加载器使用相同规则。
工具权限、员工作用域、调用开关和撤销逻辑保持原有约束。

`Dockerfile`、`Dockerfile.extensions`、`Dockerfile.slim` 都重编译 `skill` 和 `tool-skill`，
将两包纳入 profile 的本地包覆盖，并复制 `src`、`lib`；只更新后端或插件文件不足以启用此兼容。
旧企业副本不会自动改名，需要重新发布并审核、安装新副本。

补丁与镜像接线检查：`node --test middleware/byclaw-harness/scripts/skill-names-021-patch.test.mjs`。
真实 SDK 集成测试：在隔离的固定版本 DSH 工作区先执行
`node middleware/byclaw-harness/scripts/prepare-dsh-skill-names-021.mjs "$DSH_ROOT"`，
再执行 `DSH_ROOT="$DSH_ROOT" node middleware/byclaw-harness/plugins/byclaw-integration/scripts/skill-runtime-verify.mjs`。
源码测试覆盖原名加载、个人/企业并存、原生工具和斜杠入口、跨员工拒绝及撤销；
它们不替代业务镜像构建和部署后的会话验收。

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

主 `Dockerfile` 在 `connector-tools` 阶段通过 npm 安装
`@wecom/cli@1.3.4` 和 `@larksuite/cli@1.0.85`，再把 CLI 及其平台包复制到最终运行阶段，
默认版本与 OpenClaw 主 Dockerfile 对齐。构建时精确检查 CLI 版本，企业微信允许官方的
`(wecom 构建时间 提交号)` 版本后缀；并以 `byclaw` 用户执行企业微信的离线 `--version`
和飞书的 `--help`。企业微信 1.x 的帮助命令会请求远端 discovery，不能作为未授权镜像的
构建探针。安装或检查失败会中断构建。共享技能继续使用 `middleware/builtin/skills`，
授权文件仍由运行时的用户私有目录提供。本次版本升级仅覆盖
`middleware/byclaw-harness/Dockerfile`、`middleware/openclaw/Dockerfile` 和 `byclaw-be/Dockerfile`；
其他 Dockerfile 变体保留原版本，不能据此视为已兼容 1.3.4 的共享技能。

从企业微信 0.1.9 升级时，授权命令改为 `wecom-cli auth init --noninteractive --no-browser`，
状态查询使用 `wecom-cli auth show --status`；业务命令使用资源层级及 `--json` 参数。
旧 `init --no-open`、`contact get_userlist '{}'` 不能继续调用，通讯录入口改为
`contact users search`，实际参数应在授权后通过该命令的 `--help` / `--doc` 核对。
企业微信 1.3.4 的私有配置目录使用 `WECOM_CLI_CONFIG_DIR`；CLI 会尝试将同目录下的
旧 `bot.enc` 迁移到 `credentials.enc`，应保留原加密密钥并复核迁移后的授权状态。
后台授权逻辑、共享技能和连接器命令清单须与镜像版本一起升级。

`WECOM_HOME` 仍是平台注入的用户专属 HOME，并未改名或移除。CLI 子进程继续使用
`HOME="$WECOM_HOME"`，同时显式设置 `WECOM_CLI_CONFIG_DIR="$WECOM_HOME/.config/wecom"`。
后者是 CLI 原生配置目录变量，优先于默认的 `$HOME/.config/wecom`；显式映射可防止继承其他配置目录，
同时保留现有凭据目录位置。另为子进程设置空的
`WECOM_CLI_ACCESS_TOKEN`，防止宿主或 `.env` Token 覆盖用户身份。`auth show --status`
只检查本地授权信息，不证明远端 Token 有效或业务权限已开放。撤销先删除该用户目录内的
`credentials.enc`、`bot.enc`、`token.enc`，再执行 `cache clear` 和 `unauthorized` 复核；
仅清 discovery 缓存不会撤销授权。

普通消息/聊天历史与 `message aibot` 的权限应分别判断。官方维护者确认
[`853006` 是当前服务端策略限制](https://github.com/WeComTeam/wecom-cli/issues/135)，
重复扫码不能自行解除。aibot 会话列表不是聊天历史；WebSocket 接收另需机器人长连接配置。

连接器模板更新位于 `deploy/migrations/versions/V0.6.0/V0.6.0__dml.sql` 的 WeCom CLI 1.3.4 段，
保留其他 manifest 配置。仓库 `.applied` 已记录 V0.6.0，普通 merge 会跳过该版本；
版本管理员发布前须处理新增 SQL 的应用状态，不能仅凭已有版本标记认定升级生效。
开发阶段只运行 `merge_migrations.py --dry-run`，不修改初始化 SQL 或 `.applied`。

回归测试入口为 `python3 -m unittest discover -s middleware/tests -p 'test_harness_connector_cli.py'`。
测试提取实际安装指令并使用本地桩覆盖成功、安装失败、显式飞书安装步骤失败、命令缺失、
版本错误、合法构建后缀和运行用户探针失败，同时检查最终阶段复制；
不下载 npm 包，也不验证真实容器权限。交付前还需构建目标架构镜像，并从 DSH 执行入口验证
`LARK_HOME`、`WECOM_HOME` 与用户凭证挂载一致，且 `WECOM_CLI_CONFIG_DIR` 指向该用户
`WECOM_HOME/.config/wecom`，完成测试账号的授权及只读业务验收。
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


## 共享宿主跨实例恢复会话

受管共享宿主可配置 `BYCLAW_MULTI_HOST_USER_ROOT=/data/byclaw-contexts`，将用户的
`<contextKey>/dsh-home` 放在所有共享宿主共用的 NAS 目录。`contextKey` 包含稳定的业务服务、
租户、用户身份，与宿主 ID、容量档位、分配 generation 无关。未设置该参数时保留旧目录布局；
非受管模式或与宿主根目录重叠的路径会拒绝启动。

`BYCLAW_MULTI_HOST_ROOT=/data/multi-host` 继续保存当前宿主的 profile 和 managed-fences。
共享模式下浏览器 socket 放在容器 `/tmp/byclaw-multi-host/<宿主及用户哈希>/browser`，不放 NAS。
JSONL、版本化/压缩会话、storages、附件、team-state 等随用户 home 保留。释放上下文不删除 home。
新宿主复用原 ByClaw session ID 和 `/by` 工作目录，调用现有 DSH resume；不保证恢复正在执行的
外部工具调用或浏览器进程。不要将宿主的 managed-fences/profile/socket 复制到另一宿主。

platform 的 `SHARED` 规格使用 `sharedStorageNamespace=byclaw-shared-dsh`，卷仍为 PRIVATE。
服务拥有一个独立 SERVICE NAS 空间，里面分别挂载 `hosts/${user_code}/multi-host` 和 `contexts`。
禁止使用 PUBLIC 卷绕过归属校验。当前空间配额沿用 NAS 默认配额，应按留存量监控和扩容。
共享存储启用时 Redis 占用键按 contextKey 互斥，generation 保留在持有者值内；释放原子校验持有者。
DSH 自身会话文件锁继续作为写入保护，NAS 跨 Pod 锁语义需要部署验收。

升级需更新 platform 和 Harness 镜像，并执行 platform V0.6.0 的 DDL/DML 增量。
新宿主使用新镜像；已有宿主保持运行，不为新增用户或挂载新池强制重启。新准入校验实际挂载清单，缺少目标池的旧宿主不接收该池的新上下文，已有上下文继续服务，空闲释放后才替换宿主。
本次不迁移旧宿主历史会话，旧 NAS 空间保留；新布局产生的会话支持后续跨共享宿主恢复。
若实际部署使用静态 PVC，路径前还有 `shared/byclaw-shared-dsh/`；使用 NAS pool 时平台会将
这一逻辑前缀替换为对应的 `spaces/<spaceKey>/`。

本地验证：

```bash
DSH_SOURCE_ROOT=/path/to/built/deepseek-harness node --test \
  middleware/byclaw-harness/scripts/byclaw-multi-host.test.mjs \
  middleware/byclaw-harness/scripts/byclaw-managed-host.test.mjs \
  middleware/byclaw-harness/scripts/byclaw-shared-storage-claims.test.mjs \
  middleware/byclaw-harness/scripts/byclaw-shared-session-resume.test.mjs
```

其中 Redis 测试启动独立临时 Redis；恢复测试使用指定 DSH 构建的真实 JSONL 后端，不调用模型。
云端需验证：A 宿主完成会话→排空释放→B 宿主恢复相同会话并正确回答历史信息；同时确认不同
租户/用户不可串读、双写被拒绝、NAS 不可用时启动失败、释放宿主后数据仍存在。

## Shared user NAS quotas (V0.6.0)

`BYCLAW_SANDBOX_SHARED_USER_NAS_ENABLED` is a business system parameter (default `0`), not a container environment switch. At `1`, only eligible shared DSH users prepare storage at login. Platform admits the context only after the user directory's enforcement quota and the shared parent's capacity budget are confirmed ready. Quota preparation is asynchronous; a pending quota does not reserve a shared host slot.

The deployment still uses **one resident Harness process per shared Pod**. Plugin modules are shared; contexts, credentials and mutable state remain user-scoped. Canonical identity includes source service, tenant and immutable user ID. Legacy session directories receive child quotas in place, with no migration utility. New users can spill into another pool when the original pool is full; users with legacy history cannot silently move to an empty directory.

New quota-capable hosts mount the SERVICE namespace's `contexts` directory from every READY pool, including prepared spare pools, at `/data/byclaw-context-pools/<parentSpaceKey>`. They never mount other services' roots or the whole filesystem. Each user's V2 `storageBinding` selects `<mount>/<contextKey>/dsh-home`. The legacy `/data/byclaw-contexts` mount and V1 binding remain supported. Host-local profiles, tokens and browser temporary files do not become shared session state.

Personal NAS bindings use the same home for shared and exclusive runtimes. V3 selects
`/data/byclaw-context-pools/<userNasPoolKey>/<spaceKey>/by/byclaw/.dsh` from the pool's
`/users` mount. V4 keeps exactly the same binding fields and virtual home, while Platform
overlays each existing `USER/global` registry root `/spaces/<spaceKey>` at
`<userNasPoolMount>/<spaceKey>`. It must mount each approved directory separately, never
the whole `/spaces` tree. Neither version moves files or migrates an older logical home.

For V4, the `USER_POOL` entry in `BYCLAW_MULTI_HOST_STORAGE_MOUNTS` must include `spaceKeys`:
a comma-separated string of 1–500 distinct, lowercase 64-hex space keys, with at most 64
exact overlays across all pool entries in one host snapshot. Pool entries without overlays
do not consume this limit. Empty entries,
whitespace, null, duplicates and extra fields are rejected. The original five-field
`USER_POOL` entries remain valid for V3; legacy SERVICE entries and V1/V2 bindings retain
their existing contracts. V4 admission requires an exact key match in this immutable mount
snapshot. A new legacy-root overlay therefore needs a newly provisioned host that includes
it; it cannot be inferred from the pool's `/users` mount or added by creating an empty home.

Before boot, V4 requires `/data`, the pool mount and the exact `<spaceKey>` overlay directory
to exist as real directories without symlinks. Existing parents through `.dsh` must also be
real directories without symlinks; missing `by/byclaw/.dsh` components can be created only
after the overlay is verified, allowing a user with existing drive files to start DSH for the
first time. A missing overlay fails admission. V3 keeps its existing lazy creation behavior.
The mount inventory is trusted Platform configuration; local path checks do not establish
that an arbitrary host-supplied manifest represents a real NFS mount. Session JSONL and
other durable state remain under the selected personal home; profiles and browser sockets
remain host-local. Deploy the matching Platform and rebuilt Harness image before sending
V4 bindings. Local tests cover parsing, missing/aliased paths, user boundaries and session
reopening; actual ACS overlay mounts and NAS persistence still require deployment acceptance.

Platform freezes each new host's mount snapshot before provisioning. ACS validates every parent owner, pool and subpath and derives `BYCLAW_MULTI_HOST_STORAGE_MOUNTS` from the mounted directories. Harness validates that proof and immutable user binding before boot. The allocator sends a new user only to a host covering that user's parent/pool. A future unmounted pool is handled by NEW hosts; no existing Pod is patched, restarted or drained to add mounts. ACTIVE and already reserved generations retain their mode/binding across policy changes and quota-control-plane delays. Disabling the flag stops new quota allocation; users already bound to NAS continue using the same home even after release and reacquisition.

Parent headroom is reserved once, so new users do not repeatedly enlarge the parent quota. Quota readiness gates NEW quota-mode admission only. Releasing a context never deletes its directory or quota. Start new hosts from the upgraded image before enabling the parameter; keep occupied older hosts running until their contexts naturally release. Resource exhaustion blocks new admissions rather than evicting active users.

Local tests exercise allocation, fixed mount snapshots, provider manifests, binding validation and real DSH JSONL reopen/write ownership using temporary local directories. ACS/NAS nested quota enforcement, cross-Pod file locking, actual mount behavior and concurrent chat latency still require deployment acceptance.

A NAS quota limits storage consumption. A shared process and UID are a trusted execution boundary; this is **not** an operating-system security boundary against malicious plugins or arbitrary code that can access other mounted directories. Browser temporary files remain ephemeral and host-local. Container restarts do not remove durable homes.

### Full-image VNC startup and MicroVM readiness

`Dockerfile` and `Dockerfile.extensions` default to `BYCLAW_BROWSER_STARTUP=eager`. The local browser and shared noVNC listener must start before a MicroVM's declared-port readiness check can succeed, including a declared HTTP `vnc` port at 8081. Do not override the full image to `on-demand` when 8081 participates in readiness. Slim/shared hosts and the separate slim tools image keep their own startup contracts.


### Persistent-profile extension build isolation

Full images validate the installed byCLI extension manifest, build metadata and
background-script SHA256 at build time, then copy the bounded, symlink-free
runtime tree into a root-owned build-ID directory. The browser supervisor passes
its canonical path to both Chrome extension flags. A different extension build
therefore uses a different unpacked-extension/service-worker identity instead of
reusing cached code at the package's stable installation path. The daemon's
installed package remains authoritative and the existing doctor build check is
still mandatory. Existing browser profiles, cookies and site login state are
preserved; this does not clear a user's profile or bypass extension verification.

### Unity tool image and WebGL support

`Dockerfile.tools.unity` is a repository-root purpose layer over the immutable
previously deployed Unity image. It preserves Editor 2022.3.62f3c1, its launchers,
SSH/PTC runtime, user, environment and entrypoint. It adds the matching official
China-release WebGL support package and the `byclaw.tool-sandbox/v1` manifest
required by the enabled `unity` template (`capabilities: ["unity", "games"]`).
The build checks the exact Editor version, module SHA256, WebGL extension DLL,
Emscripten version and existing SSH/helper executables before the image succeeds.
Source URL, China revision and digest are recorded in
`tool-sandbox/unity-webgl-source.json`. The release metadata is published at
https://unity.cn/api/releases?releaseType=full&major=2022 .

Build from the repository root:

```bash
docker build -f middleware/byclaw-harness/Dockerfile.tools.unity \
  --build-arg UNITY_IMAGE=your-registry/byclaw-harness-tools-unity@sha256:4e8a75098b97262957d85da69aea5ee6c68bbb90de9d4d2c0e23e411b05141c4 \
  -t byclaw-harness-tools-unity:candidate .
```

The existing `unity-build` launcher still defaults to Linux. A WebGL project
must invoke its own Editor `BuildPipeline.BuildPlayer` method targeting WebGL.
Installing the module does not activate or grant a Unity license. Actual Editor
builds require the deployment's valid license; do not embed credentials or license
files in this build context or claim successful game output from module checks.
