# 共享内置资源

Harness 与 OpenClaw 的共享源码集中于本目录，以 harness 的 `2026.9.8 / fe42f03` 为基准。
同名资源采用 harness 版本；OpenClaw 独有文件补入共享目录。资源版本统一不代表两边旧内容逐字相同。

目录包括 `skills/`、`python-clis/`、`runtime-tools/`、`cli/` 和 `skills-registry.json`。
原 harness 的 `builtin` 以及 OpenClaw 的对应目录保留相对符号链接，仅用于本地脚本与旧路径兼容。
后续只编辑本目录，不再维护两份资源。

所有业务 Dockerfile 从 ByClaw 仓库根目录构建，直接 COPY 本目录的真实路径。
Harness 仍安装到 `/opt/byclaw/builtin` 与 `/opt/byclaw/dsh-managed/skills`；
OpenClaw 仍使用 `/app/skills`、`/tmp/byclaw-python-clis` 和 `/usr/local/lib/byclaw/runtime-tools`。
COPY 的所有权参数、Python 安装步骤、运行时环境变量、启动入口保持原有设置。
OpenClaw 的主 Dockerfile 仍沿用原有 DWS 安装来源；cubesandbox 使用本目录的 DWS 二进制。

共享目录变化会触发现有 OpenClaw 镜像构建。Harness 的构建命令见
[接入说明](../byclaw-harness/INTEGRATION.md)。

验证：在仓库根目录执行 `python3 -m unittest discover -s middleware/tests -p 'test_shared_builtin.py'`。
静态构建契约和本地资源测试不能替代真实容器镜像构建及启动验证。

路径规范：跨技能调用使用 `import.meta.url` / `__file__` 所在目录定位相邻资源，
不依赖调用者的工作目录或 `/app/skills` 等固定部署位置。数据、凭据和会话文件以
`BYCLAW_DATA_ROOT` 为根；未配置时以当前目录为根。两个镜像在最终运行阶段显式设置
`BYCLAW_DATA_ROOT=/by`，保持既有挂载与安全边界。技能开发目录从 `OPENCLAW_STATE_DIR`
或 `DSH_HOME` 获取，未配置时使用当前目录。外部命令通过 PATH 查找；SearXNG 自定义
Python 模式可用 `ONLINE_SEARCH_SCRIPT` 指定脚本，否则使用相对路径 `searxng_cli.py`。

原 OpenClaw 源文件逐项对比见 [RESOURCE_COMPARISON.json](RESOURCE_COMPARISON.json)：
598 个源文件全部保留，同名差异采用 harness 基线及路径兼容修订。旧 build/release 产物、
缓存和旧锁文件不合入共享源码。兼容链接意味着两种运行时读取同一份技能与脚本。

搬迁测试：`node --test middleware/tests/shared-builtin-portability.test.mjs`。
