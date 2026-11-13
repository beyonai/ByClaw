# 通用 coding 工具镜像

`Dockerfile.tools.coding` 从仓库根目录构建，最终产物只有通用开发环境：Codex、Git、
Python/Node、基础编译工具、SSH/browser、Nginx 预览、内置 Skill 和共享 CLI。
默认父镜像沿用工具家族的 `byclaw-harness:D0.6.0_browser`，可用 BROWSER_IMAGE
显式指定已验证的父镜像 digest。发布标签和能力清单为 `D0.7.0_coding`。

镜像不包含应用源码、Easel 专属依赖、应用初始化/修复/迁移命令或应用专属 Nginx
响应替换规则。应用从上传文件或 Git 仓库进入持久化工作空间，依照项目自身的锁文件、
构建和启动说明安装环境；不使用历史镜像中的路径。源码、Git 历史、锁文件和交付物
保存在 /by，依赖和缓存尽量放实例本地目录并能重建。多任务修改同一仓库须协调写入。

## 构建和发布

```bash
docker build --platform linux/amd64 \
  -f middleware/byclaw-harness/Dockerfile.tools.coding \
  -t byclaw-harness:D0.7.0_coding .
```

在 47 用 bydevops 拉取确定提交后选择此 Dockerfile 构建；记录源码提交、镜像 digest
和父镜像。构建成功后更新现有 coding 服务配置并重建模板，再用新实例验收。
不修改共享主环境的用途，不扩大员工映射，不修改五分钟空闲回收策略。

配置沿用 `coding.platform.spec.example.json` 的 coding 契约及既有 SSH 身份、网络、
持久卷和资源规格。模型连接复用平台模型管理和本轮选择，由 Harness 通过本次进程环境传递；不再读取个人 CODEX_AUTH、CODEX_MODEL、CODEX_BASE_URL。密钥不进入镜像、源码或持久配置。
Codex 默认配置在 /home/byclaw/.codex/config.toml；Harness 每个员工会话使用专属
codex-home，并通过原有执行路由运行和续聊。

## 项目执行与预览

1. 明确用户要求处理的附件或仓库，在所属项目中建立可编辑源码目录。
2. 检查已有 Git 历史；无仓库时初始化并提交导入基线，不对整个 /by 建仓。
3. 按项目说明恢复依赖，完成修改、测试并记录 Git 版本。
4. 启动应用，使用 `sandbox-app expose --name my-app --port <应用端口>` 获取临时链接。
   应用自己支持路径前缀；细节见 [预览说明](APP_PREVIEW.md)。
5. 用户已授权正式部署时，使用 [服务器部署流程](SERVER_DEPLOY.md) 发布确定的项目版本。

工具实例销毁后，源码和 Git 历史须能在新实例中继续使用；实例里的环境和预览路由
需要重建。正式部署的服务应在用户服务器独立运行，不依赖开发实例的生命周期。

## 验证

```bash
python3 -m unittest discover -s middleware/tests -p 'test_coding*.py'
python3 -m unittest discover -s middleware/tests -p 'test_sandbox_app.py'
```

静态及模拟检查不能代替镜像构建、SSH/browser/Nginx 启动和真实 Codex 任务。
上线验收需核对实际实例不含应用预装环境、上传源码能建仓开发、销毁后 Git 保留，
并且新实例可恢复依赖、部署后应用独立运行。未实测的项目不得记为通过。
