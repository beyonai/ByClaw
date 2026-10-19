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
