# Easel 应用模板

Easel 是 coding 沙箱内置的一个应用模板，不是独立的沙箱 purpose 或发布标签。
通用 Codex、Nginx、SSH、浏览器和应用预览由 coding 层提供。本目录只维护模板
源码版本、媒体环境安装、工作区初始化及 Easel 路径兼容规则。

## 使用

```bash
sandbox-template list
sandbox-template init easel
sandbox-template run easel -- web --port 7860
```

初始化为用户显式操作，不在沙箱启动时执行。运行命令占用前台；通过工具调用启动
长期进程时，需使用独立进程组并重定向标准输入、输出和错误。确认应用就绪后：

```bash
sandbox-app expose --name my-app --profile easel --port 7860 --sandbox-id <sandbox_acquire返回的ID>
```

应用名称可自定，`--profile easel` 显式选择此目录的 preview.conf。
不要把随机路径当作登录鉴权。链接、实例生命周期和平台入口见
[通用预览说明](../../tool-sandbox/APP_PREVIEW.md)。
镜像内通用说明路径为 `/etc/byclaw-tool-sandbox/APP_PREVIEW.md`。

## 源码、依赖与持久化

| 位置 | 用途 |
| --- | --- |
| `/opt/byclaw/templates/easel/source` | 镜像中的固定版本模板源码与构建产物 |
| `/opt/easel-venv` | 过渡期预装的 Python 环境 |
| `/opt/easel-runtime/remotion` | 过渡期预装、普通用户只读的 Remotion 依赖 |
| `/opt/easel-runtime/playwright` | 模板专属 Python 浏览器，不改动核心 browser 的目录和入口 |
| `/by/Easel` | 用户持久化项目；已有内容不自动升级或覆盖 |
| `/var/cache/easel` | 可重建的实例本地缓存 |

模板用 source.json 和 SHA-256 固定来源，不携带用户文件、凭证或 node_modules。
构建时 install.sh 准备媒体环境和前端生产包。它不安装另一份 Codex，也不改写
coding 的默认配置或 SSH 会话环境。Python、FFmpeg、Remotion 等重型依赖仍然
预装是当前过渡实现，不宣称已经支持通用的按需环境安装或独立模板在线更新。

运行模板时，只在该应用子进程中设置 PATH、PYTHONPATH、Easel 变量和缓存路径，
保留调用方的 CODEX_HOME、CODEX_AUTH。Codex 默认配置继续使用镜像的
`/home/byclaw/.codex/config.toml`；Harness 会话继续使用其专用 codex-home。
模板不创建或切换全局 `/by/.codex`。

首次初始化先检查空间和文件节点，再将不含依赖、Git 历史和缓存的源码复制到同一
文件系统的临时目录，完整校验后重命名为 /by/Easel。依赖通过链接引用镜像；
已有源码、配置、输出和自定义依赖保留。模板初始化不从网络安装包。

```bash
sandbox-template repair easel
sandbox-template migrate-dependencies easel
```

这两个显式维护命令不属于启动流程。repair 只补缺失源码，不覆盖现有文件。
依赖迁移仅在项目清单与镜像一致时进行：先压缩备份、校验目录项和原目录未变化，
再移除旧 Remotion node_modules 并链接镜像依赖。备份失败保留原依赖。
备份保存在 /by/Easel/.byclaw-dependency-backups，用户确认前不自动清理。

在 /by 直接执行 npm install 仍会占个人存储的文件节点；缓存改目录不会改变包的
安装目录。自定义依赖应使用实例本地环境并保留锁文件，实例重建后按锁文件重建。
镜像升级不覆盖已有项目；应用模板升级需要另行明确执行。

## 构建与验证

从仓库根目录构建 Dockerfile.tools.coding，默认最终阶段包含本模板及过渡期媒体
环境。`--target coding-core` 只构建通用环境，不含本模板。
父镜像沿用 LAN Harbor；发布时固定已验证 digest。日期候选标签及镜像 digest
记录在发布记录中，不作为代码对某次调试镜像的依赖。

```bash
python3 -m unittest discover -s middleware/tests -p 'test_easel*.py'
bash middleware/byclaw-harness/templates/easel/smoke.sh <已构建的coding镜像>
```

完整 smoke 需要 Docker/Podman，检查显式初始化、SSH、应用环境、浏览器、离线
渲染和重启后的文件保留。静态测试不等于镜像或线上业务验收。模板源码保留上游
版本信息，新的模板应自带清单、锁文件和环境要求，不能因此扩大全局环境副作用。
