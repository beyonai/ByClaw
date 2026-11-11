# Coding 工具沙箱：Codex、应用预览与项目模板

在 `coding-sandbox-hs` 上制作独立工具沙箱 B。父镜像沿用 browser 的 SSH、文件和浏览器能力。本节只说明工具镜像；Harness 固定路由见 [实施说明](../plugins/byclaw-integration/CODING-ROUTING.zh.md)。

通用层提供 Codex、Nginx 和 `sandbox-app` 预览，purpose 继续为 `coding`。
`templates/` 保存内置应用的源码声明、初始化逻辑和环境要求；Easel 是其中一个模板，
没有独立的 Easel 沙箱契约或日期版镜像依赖。默认构建包含其过渡期媒体环境，
`--target coding-core` 可构建不带应用模板的通用层。增加模板不要求修改执行路由。

沙箱启动仅准备 Nginx，再进入原 SSH/browser 启动流程；不会自动复制任何应用到
用户工作区，也不在启动时安装包。使用 `sandbox-template list` 查看内置模板，
`sandbox-template init easel` 显式创建项目。详见 [应用预览](APP_PREVIEW.md) 和
[Easel 模板](../templates/easel/README.md)。

## 1. 本次文件

本次 Skill 升级需同时发布 coding 工具镜像与 Harness 主镜像。coding 镜像包含完整内置 Skill、共享 Python CLI 和 `by-framework==0.2.2.dev10`；执行前由 `prepare-agent-skills.mjs` 按当前 `employeeId` 查询关联资源，复用版本缓存并下载完整 Skill 目录，再生成会话专用的原生 Skill 引用。准备发生在每次任务中，原启动入口不变。认证沿用当前用户执行环境，失败不继续调用 Codex。

本次 Skill 升级先使用独立候选 tag，例如 `D0.6.0_coding-skills-r1`，验证后按正式标签 `D0.6.0_coding` 发布。主镜像也使用新 tag；更新两个模板后释放目标旧实例。内置 Skill 的脚本文件随镜像提供，专门依赖或后端服务连接仍须按该 Skill 的要求验收。

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
IMAGE='<candidate-image:tag>'
docker build --platform linux/amd64 \
  -f middleware/byclaw-harness/Dockerfile.tools.coding \
  -t "$IMAGE" .
```

按《工具沙箱全流程教程》步骤 02—10：提交并推送分支 → 平台“拉取 ByClaw” → “构建 Harness 镜像”选择本 Dockerfile → 使用独立候选 Tag 验证，再按正式标签 `D0.6.0_coding` 发布 → 推送北京 ACR。若下拉框没有本文件，需给构建平台补选项。记录提交号、镜像 digest、CLI 版本。

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

Spec 使用 `/usr/local/bin/byclaw-coding-entrypoint tools`，准备 Nginx 后委托原工具入口
`/usr/local/bin/byclaw-tool-slim-entrypoint tools`。模型和地址在构建时写入配置文件，启动时不再生成配置：

```text
构建镜像：复制 codex.config.toml → /home/byclaw/.codex/config.toml
启动沙箱：平台注入 CODEX_AUTH → 准备 Nginx → 原工具入口启动 SSH、浏览器
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

直接手工调用的原生会话保存在镜像默认 `CODEX_HOME`，当前示例未持久化该目录。Harness 固定路由现已使用 `/by/.sessions/{sessionId}/executors/{agentId}/codex-home`，每轮从镜像默认配置生成专用配置并按 threadId 续聊；原生状态随 `/by` 持久卷保留。详见 [上下文交接](../plugins/byclaw-integration/CODING-CONTEXT.zh.md)。

这是独立工具镜像：不要直接替换 Harness 主镜像。`BYCLAW_AGENT_EXECUTION_MAP` 配置在处理请求的 Harness 主环境，通过已有沙箱目录选择 coding；不放到本工具镜像实现分流。

8082 为应用预览网关。IP/域名入口通过部署参数 BYCLAW_APP_PUBLIC_BASE 配置，
不写死服务器地址。ByClaw 和 byclaw-middleware 分别维护部署模板时，两边都需包含
对应路由。现有 5 分钟空闲回收策略不变，应用链接不表示永久发布。

当前正式标签与 runtimeVersion 统一为 `D0.6.0_coding`，与仓库
`D0.6.0_<purpose>` 约定一致；这不是新产物已发布的证明。原 r1/r2 产物不含
新预览入口，不可仅将新版 Spec 的启动命令套用在旧镜像上。必须完成候选构建、
验证和推送，再更新明确选定的服务与云模板，使用新实例验收。候选标签、源码
提交和镜像 digest 记录在发布记录中，不依赖调试日期标签；已有实例不自动更新。

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

镜像已内置配置，可直接调用原生 **`codex`**；工具启动入口不生成配置。手工调用沿用 CLI 默认权限或明确传入参数；Harness 固定路由通过随插件分发的 Python runner 准备专用配置，使用原有免交互权限策略，并接收上下文、共享 Skill 和文件回传。验收时用 `--model` / `-c` 覆盖一次，并核对网关实际收到的地址和模型。

指定员工固定路由的部署配置与验收见 [Codex 固定路由](../plugins/byclaw-integration/CODING-ROUTING.zh.md)。本次 Skill 准备改动需重新构建两类镜像；镜像上架本身不会自动把用户消息交给 Codex。

## 5. 本次验证范围

- 测试覆盖内置配置的 TOML 解析与认证引用、镜像配置打包、归档路径、版本与校验拒绝、离线安装及平台声明一致性。
- 两个实际 npm 制品已从国内源下载并校验，在 Linux 运行锁定的 Codex 0.167.0，
  通过原生 exec/resume、专用配置、结构化结果和 Skill 发现/撤销测试；使用本地
  Responses 测试服务，不代表真实网关或模型验收。
- 原分支的路由/上下文源码测试及 Python 工作区测试通过。本地缺少完整插件依赖，
  前者通过临时模块映射加载仓库真实 group-context.ts，没有替换业务函数；不等于
  完整插件安装、类型检查或构建通过。
- Coding 配置/制品、网关启动、模板初始化、环境隔离与预览路由测试通过；两项
  Docker 布局检查通过。本机无 Docker，新镜像构建、SSH/browser/Nginx 联合启动、
  模板渲染和真实平台会话仍需在构建机与临时实例验收。历史 Easel 镜像的线上通过
  记录不能代替本次 coding 结构调整后的验收。
