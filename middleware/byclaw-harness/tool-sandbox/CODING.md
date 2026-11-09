# Codex 工具沙箱（暂不安装 Claude）

在 `coding-sandbox-hs` 上制作独立工具沙箱 B。父镜像沿用 browser 的 SSH、文件和浏览器能力；不修改 Harness 路由及前后端。

## 1. 本次文件

| 文件 | 用途 |
|---|---|
| `../Dockerfile.tools.coding`、同名 `.dockerignore` | 构建镜像；只允许必要源码进入构建上下文 |
| `codex.release.json` | 固定 Codex 0.167.0、国内制品地址、SHA-512；升级时整体核验更新 |
| `../scripts/install-codex.py` | 下载并校验官方 npm 启动包和 Linux x64 包，拒绝海外重定向与不安全归档；不执行 npm 生命周期脚本 |
| `codex.config.toml` | 镜像内置的 Codex 默认模型、网关及密钥变量名，安装到 `/home/byclaw/.codex/config.toml` |
| `coding.capabilities.json` | 工具沙箱握手能力声明，purpose 为 coding |
| `coding.platform.spec.example.json` | 后台 Spec 示例；填写真实发布地址与已有启动上下文变量后使用 |

## 2. 本地检查与平台构建

在 ByClaw 仓库根目录运行：

```bash
python -m unittest discover -s middleware/tests -p 'test_coding_sandbox.py' -v
git diff --check
```

本机有 Docker 时可构建（父镜像由构建机从 81 Harbor 拉取）：

```bash
docker build --platform linux/amd64 \
  -f middleware/byclaw-harness/Dockerfile.tools.coding \
  -t byclaw-coding:D0.6.0_coding-r2 .
```

按《工具沙箱全流程教程》步骤 02—10：提交并推送分支 → 平台“拉取 ByClaw” → “构建 Harness 镜像”选择本 Dockerfile → Tag `D0.6.0_coding-r2` → 推送北京 ACR。若下拉框没有本文件，需给构建平台补选项。记录提交号、镜像 digest、CLI 版本。

两个 Codex 包由国内镜像下载并校验锁定的 SHA-512，安装目录 `/opt/byclaw/codex`。失败即中止，不回退其他来源。固定版本不等于已通过业务兼容验收；首次发布需完成后面的真实请求测试。

## 3. 后台配置

按教程步骤 12—21 新建工具市场配置：服务键可用 `byclaw-tools-coding`，`ownerScope=USER`，`serviceType` 选择实际 Provider。使用示例 Spec，并替换 `image` 为本次 ACR 发布地址。Spec 的 `toolSandbox.purpose=coding` 和能力列表应与能力声明一致。

在个人参数界面配置并启用以下变量：

| 变量 | 含义 |
|---|---|
| `CODEX_AUTH` | 网关密钥 |

`CODEX_AUTH` 是本项目配置的认证变量名，避开平台禁用的命名片段；Codex 通过配置文件中的 `env_key` 读取它。

后端创建沙箱时从 Redis 读取当前用户的个人参数，再按 Spec 中的 `${envVars.CODEX_AUTH}` 注入环境。只会注入 Spec 声明的变量。真实凭证不写进 Git、Dockerfile 或构建参数。

保留有效 browser Spec 的 SSH 身份、网络、持久卷和资源配置。8080 是私有 SSH-over-WebSocket，8081 是平台认证浏览器。保存后重建云模板，用新实例验证；旧实例不会自动更新。共享主环境场景继续按教程步骤 22—24 检查宿主映射和目标用户准入。

Spec 使用原工具入口 `/usr/local/bin/byclaw-tool-slim-entrypoint tools`。模型和地址在构建时写入配置文件，启动时不再生成配置：

```text
构建镜像：复制 codex.config.toml → /home/byclaw/.codex/config.toml
启动沙箱：平台注入 CODEX_AUTH → 原工具入口启动 SSH、浏览器
执行任务：sandbox_exec 调用 codex → 读取配置文件和密钥环境变量
```

`CODEX_HOME` 默认 `/home/byclaw/.codex`，随现有环境传递机制进入 SSH 会话；配置目录及文件归 byclaw 所有，权限分别为 0700、0600。默认模型为 `gpt-6.1-sol`，网关为 `https://api.ikuncode.ai/v1`，协议为 Responses API。文件通过 `env_key="CODEX_AUTH"` 指定密钥变量名，不保存真实 Key。缺少密钥时工具服务仍可启动，调用 Codex 时会认证失败。

直接执行使用文件中的默认值；命令行参数优先，未传的字段沿用文件配置。例如：

```bash
codex exec --skip-git-repo-check '分析当前目录'
codex exec --skip-git-repo-check --model '其他模型ID' \
  -c 'model_providers.byclaw.base_url="https://other-gateway.example.com/v1"' \
  '分析当前目录'
```

仅配置 `CODEX_BASE_URL`、`CODEX_MODEL` 环境变量不会覆盖本文件；后续执行器若提供这两个可选变量，须在值非空时转换为上面的命令行参数。修改镜像默认值需要更新 `codex.config.toml` 并重新构建。

原生会话保存在 `CODEX_HOME`，当前示例未持久化该目录，重建实例后会话可能丢失。当前 `/by` 卷保存工作文件；若另行挂载 `CODEX_HOME`，需预置 `config.toml`，因为空卷会遮盖镜像内置配置。

这是独立工具镜像：不要直接替换当前 `none + web` 的 Harness 镜像。`CODEX_AGENT_IDS` 属于后续 Harness 路由配置，不配置到本工具镜像来实现自动分流。

### 从 r1 更新到 r2

旧镜像内置配置仍引用原认证变量名，仅修改个人参数不会更新镜像。发布本次代码后，使用 `D0.6.0_coding-r2` 重新构建并推送镜像；个人参数新增并启用 `CODEX_AUTH`，值填写原网关密钥。后台用本示例更新 image 和 env 占位符，保存后重建云模板，使用新实例验收。不要把旧实例仍可运行当作新配置已生效。

## 4. 同一租约内验收

按教程步骤 25—30：`sandbox_templates` 找到 coding → `sandbox_acquire` → 使用同一租约调用 `sandbox_exec`。检查：

```bash
id
codex --version
cat /etc/byclaw-tool-sandbox/capabilities.json
cd /by
codex exec --skip-git-repo-check --json '只回复 CODEX_READY'
```

`codex --version` 应显示 0.167.0；以实际工具用户 byclaw 验证。随后在授权工作区做一次文件读写，并核对网关收到的 URL、模型及最终回复。不要打印 API Key。

镜像已内置配置，直接调用原生 **`codex`**，不提供包装命令或配置生成入口。入口不设置权限放开参数，沿用 CLI 默认权限；工作目录及权限策略由调用者明确传入。验收时再用 `--model` / `-c` 覆盖一次，并核对网关实际收到的地址和模型；指定员工的固定路由与参数约束由后续 4.1 实现。本次不开发群上下文交接。

安装验收通过后，再开发 4.1 的指定员工路由、流式输出和停止链路；镜像上架本身不会自动把用户消息交给 Codex。

## 5. 本次验证范围

- 测试覆盖内置配置的 TOML 解析与认证引用、镜像配置打包、归档路径、版本与校验拒绝、离线安装及平台声明一致性。
- 两个实际 npm 制品已从国内源下载，SHA-512、包版本和解包检查通过；尚未在 Linux 中运行。
- 本机无 Docker，镜像构建、SSH 会话、浏览器继承和真实网关调用均待构建平台/沙箱验收。
- 既有 `docker-browser-layout-verify.sh` 在本机 Windows 的路径匹配处失败；需在 Linux 构建机补跑两个原镜像布局检查。运行时下载源检查依赖 Linux/Bash，也需在该环境补跑。
