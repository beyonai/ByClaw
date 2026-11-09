# Easel Codex 工具沙箱

用于在 ByClaw 中修改、运行和验收固定版本的 Easel。镜像继承 browser 工具镜像的 SSH、VNC、浏览器与执行通道，使用 `byclaw.tool-sandbox/v1`，purpose 为 `easel-codex`。源码版本和压缩包校验记录见 `tool-sandbox/easel-codex.source.json`。

## 镜像与个人工作区

| 路径 | 内容与生命周期 |
| --- | --- |
| `/opt/easel-source` | 随镜像发布的源码模板、前端生产包、技能和资源 |
| `/opt/easel-venv` | 镜像内 Python 环境 |
| `/opt/easel-runtime/remotion` | 镜像内固定锁文件对应的 Remotion 依赖；普通用户只读 |
| `/by/Easel` | 用户可修改、持久化的源码、配置和任务输出 |
| `/by/Easel/.venv` | 指向镜像 Python 环境的链接 |
| `/by/Easel/.../deps/remotion/node_modules` | 清单与镜像一致时，指向镜像依赖的链接 |
| `/by/.codex` | 持久化的 Codex 配置和认证，权限 0700 |
| `/var/cache/easel` | 实例本地缓存；不计入个人工作区，重建实例后需要重新生成 |

个人存储同时限制容量和文件节点数量。将数千个依赖文件复制到 `/by` 会影响使用同一份个人存储的基础共享沙箱；重新创建实例不会释放这些文件节点。

首次启动会先检查剩余字节和文件节点，再在 `/by/.Easel-init-*` 复制源码，排除所有 `node_modules`、虚拟环境、Git 历史与 Python/测试缓存。配置、依赖引用和必需文件检查成功后，同文件系统重命名为 `/by/Easel`，没有第二次完整复制。复制失败会清理本次临时目录，不会发布半份工作区。进程被强制终止时可能留下临时目录，维护时检查后再清理；不会自动删除来历不明的目录。

初始化使用个人工作区上的文件锁串行化操作。预检查不能代替实际写入结果；遇到 EDQUOT/ENOSPC 会明确提示个人存储配额问题。现有 `/by/Easel` 不会被覆盖；如果缺少必需文件，启动失败并提示恢复或先移走该目录，不将残缺源码作为成功初始化。

源码由工作区导入，依赖由镜像提供。镜像里的环境需要随镜像升级；不允许普通用户修改预装 Remotion 依赖。新工作区的 Remotion 配置默认关闭 Webpack 持久缓存；镜像依赖目录中的 `.cache` 也指向实例本地 `/var/cache/easel/remotion`，兼容已有工作区继续启用缓存的配置。npm、uv、pip、Matplotlib 和 XDG 缓存默认放在 `/var/cache/easel`，这些设置也随现有 SSH 会话环境导出。

## 已有工作区升级

重新启动时保留用户源码、`.env`、`outputs`、画像及已有 Agent 配置。缺少的依赖链接会在清单与镜像匹配时补齐。已经存在的真实 `node_modules`、自定义依赖链接与自定义 Python 环境不会自动删除或覆盖。

如果旧版初始化复制了 Remotion 的真实依赖目录，停止该工作区正在运行的安装和渲染任务后，在新版 Easel 沙箱中执行：

```bash
/usr/local/bin/byclaw-easel-codex-entrypoint migrate-dependencies
```

此命令只处理内置 Remotion 的 `node_modules`。只有工作区 `package.json` 和 `package-lock.json` 都与镜像一致时才允许迁移。先在 `/by/Easel/.byclaw-dependency-backups/` 生成压缩备份，验证归档目录项数量并确认备份期间原目录未变化，输出备份路径与 SHA-256；成功后才删除真实依赖目录并建立镜像引用。源码、配置和输出不参与删除。

备份保留在个人存储中，可用于恢复自定义包内容。需要至少几个空闲文件节点以及容纳压缩包的字节余量；如果已经完全超限，应先将备份导出到受控的其他存储、确认备份后再释放节点，或调整配额。备份失败时保留原始依赖。删除途中退出时备份继续保留，剩余依赖也不会被自动覆盖；检查备份后重新执行迁移。不要对整个 `/by` 运行递归删除。

修改过 Remotion 清单的项目会保留自己的依赖，迁移命令会拒绝替换。其他沙箱镜像可能没有这些 `/opt` 路径，因此可以在基础共享沙箱查看、编辑源码，但应在 Easel 工具沙箱运行预装的 Python/Remotion 工具。

对旧版复制中断留下的残缺源码，先执行独立维护命令：

```bash
/usr/local/bin/byclaw-easel-codex-entrypoint repair-workspace
```

它只补齐镜像模板中缺失的普通文件，排除依赖与缓存，拒绝跟随用户目录中的符号链接；已有源码、配置和产物不被覆盖。必需文件检查通过后，再正常启动。该修复和依赖迁移都不属于正常启动流程。

## 用户新增依赖

普通 `npm install`/`npm ci` 仍按项目位置创建 `node_modules`。改变 npm 缓存路径不会改变依赖安装目录。在 `/by` 直接安装仍会占个人文件节点，修改镜像依赖链接指向的内容则会因只读权限失败。

对 Easel 自带前端这样使用普通 registry 依赖、没有本地路径依赖或自定义安装钩子的项目，可以在实例本地创建依赖目录后链接回来：

```bash
cd /by/Easel/web/frontend
# 如果已有真实 node_modules，先备份处理；这里要求安装位置原本不存在。
test ! -e node_modules && test ! -L node_modules || exit 1
frontend_deps=$(mktemp -d /var/cache/easel/frontend.XXXXXX)
cp package.json package-lock.json "$frontend_deps/"
(cd "$frontend_deps" && npm ci) || exit 1
ln -s "$frontend_deps/node_modules" node_modules
npm run build
```

包清单和锁文件继续保存在工作区，实例重建后根据锁文件重建本地依赖，再更新对应链接。含 `file:`/workspace 依赖或需要项目源码的安装脚本，应在实例本地准备完整项目再安装，不能仅复制两个清单。不要在预装 Remotion 链接存在时直接执行 `npm ci`：它可能删除该链接并在个人目录重新创建整套依赖。

渲染中间文件也应放在实例本地，最终视频、图片和需要保留的项目文件写到 `/by`。浏览器登录态与认证按用户持久化，不将它们作为可随意清理的缓存。

镜像为 SSH WebSocket 桥接程序在 Easel Python 环境中显式安装 `websockets`，并在构建时验证导入。Playwright 安装完成后，浏览器入口链接同步到其当前 Chromium 路径，避免父镜像旧版本被清理后留下失效链接。

## 构建与验收

从 ByClaw 仓库根目录构建独立候选标签；父镜像、npm/pip/浏览器下载沿用已配置的国内源，不隐式回退海外地址：

```bash
docker build --platform linux/amd64 \
  -f middleware/byclaw-harness/Dockerfile.tools.easel-codex \
  -t byclaw-harness-tools:easel-codex-candidate .

bash middleware/byclaw-harness/scripts/tool-easel-codex-smoke.sh \
  byclaw-harness-tools:easel-codex-candidate
```

Podman 可通过 `CONTAINER_ENGINE=podman` 运行验收。完整 smoke 记录导出 rootfs 字节数，并检查真实 SSH、Python 导入、Playwright、通过镜像依赖链接离线渲染一帧、首次工作区低于 3000 个目录项，以及重启后用户文件保留。如部署环境有明确的镜像体积预算，可通过 `EASEL_ROOTFS_MAX_BYTES` 设置；默认不套用其他工具镜像的 4 GiB 预算。导出 tar 大小、容器引擎显示大小和压缩传输量需分别记录。该文件数预算检查使用不跟随链接的 `find`，不是读取依赖链接后的全部镜像文件数。

本地工作区行为测试不需要启动容器：

```bash
python3 -m unittest discover -s middleware/tests -p 'test_easel*.py'
```

发布候选镜像、更新市场 Spec、重建云模板与真实用户实例验收是后续独立步骤。修改仓库文件不会自动改变已有云模板或实例。静态与本地文件系统测试不代表镜像构建、全部国内来源实际下载、云端共享注册或真实渲染已经通过，交付时分别记录。
