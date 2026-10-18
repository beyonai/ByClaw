# 发布后对话冒烟测试（数字员工与技能）

测试从实际浏览器登录指定环境和用户，冻结 @ 面板“全部”列表前五位**单个数字员工**，跳过员工组。依次创建五个独立对话，逐个 @、发送简短问候、等待最终回复。验证请求只包含目标员工、响应属于本轮、最终消息来自目标员工且已完成、正文非空并显示在网页上。服务错误、权限异常和超时均失败；可用员工不足五位报告“覆盖不足”。

同时增加技能组：在固定的单个员工上下文打开“＋ → 技能”，按真实面板顺序冻结前五个可选技能。两组列表均在发送测试对话前固定，每项新建独立对话，合计要求员工 5 项、技能 5 项。技能任务从配置文件按资源 ID（或目录路径）、员工上下文和可选包哈希匹配，不按名称猜测同名技能，也不会为了凑足五项改取后续资源。

技能测试同时校验实际请求中的员工与唯一技能标识、完整测试文字、服务端加载/读取证据和任务结果。DSH 的持久化 `inferLog` 工具记录需匹配当前会话、当前回答消息、技能名和文档特征；技能目录或模型自称已加载不算成功。要求执行脚本的用例还检查成功的工具执行记录。只保留证据类型及文档内容哈希，不归档原始执行日志、系统上下文或技能文档正文。

每项结果先落盘，再通过现有会话删除接口删除成功的测试会话；失败会话保留并提供链接。清理失败单独记录，整体返回非零。每轮通过和失败都向“百应AI原生实验室【内部】”群发送普通文本报告。没有自动回滚。

代码放在 `tests/integration/release-smoke/`，统一入口为 `scripts/run-release-smoke.sh`。`byclaw-qa` 是知识模块，不参与此次实现。

## 安装

执行机需要 Node.js 20 以上、pnpm 9，以及目标环境和钉钉的网络访问权限。

```sh
cd tests/integration/release-smoke
pnpm install --frozen-lockfile
pnpm run install:browser
pnpm test
```

Linux 执行机可使用 `pnpm exec playwright install --with-deps chromium` 安装系统依赖。已有 Chrome 的机器可设置 `BYCLAW_SMOKE_BROWSER_CHANNEL=chrome`。

## 配置与手动执行

密码由 CI Secret 或执行机环境变量注入。私有配置文件不要提交，不要使用 `sh -x` 输出配置。用户编码必须按字符串填写，保留前导零。不同环境各用自己的页面地址和测试账号。

| 配置 | 含义 |
| --- | --- |
| `BYCLAW_SMOKE_ENV` | 环境名称，例如 `229`、`official` |
| `BYCLAW_SMOKE_BASE_URL` | 聊天页面的完整 URL，以 `/chat/` 结尾 |
| `BYCLAW_SMOKE_USER_CODE` | 指定测试用户，也兼容 `E2E_ADMIN_USER` |
| `BYCLAW_SMOKE_PASSWORD` | 登录密码，也兼容 `E2E_ADMIN_PASS` |
| `BYCLAW_SMOKE_EXPECTED_VERSION` | 已部署前端 `build-info.json` 的 `version` |
| `BYCLAW_SMOKE_CONFIG_FILE` | 可选：可信的本地 Shell 环境配置文件路径 |
| `BYCLAW_SMOKE_NOTIFY_CONFIG` | 可选：可信的私有测试通知 Shell 配置路径；未显式配置通知时自动读取本目录 `.env.notify.local` |
| `BYCLAW_SMOKE_DINGTALK_WEBHOOK_URL` | 测试报告群的机器人 Webhook |
| `BYCLAW_SMOKE_DINGTALK_SECRET` | 测试报告机器人的加签密钥（如启用） |
| `BYCLAW_SMOKE_DINGTALK_GROUP` | 报告中标注的群名称，默认“百应AI原生实验室【内部】” |
| `BYCLAW_E2E_RESULT_DIR` | 可选：本轮独立的空结果目录 |
| `BYCLAW_SMOKE_REPLY_TIMEOUT_SEC` | 单员工等待时间，默认 120 秒，上限 600 秒 |
| `BYCLAW_SMOKE_READY_TIMEOUT_SEC` | 页面、后端和指定版本就绪等待，默认 180 秒，上限 900 秒 |
| `BYCLAW_SMOKE_BROWSER_CHANNEL` | 可选：`chrome`；默认使用 Playwright Chromium |
| `BYCLAW_SMOKE_HEADLESS` | 默认无头；设为 `false` 可联调 |
| `BYCLAW_SMOKE_SKILL_AGENT_ID` | 技能测试的单个员工资源 ID；未配置时使用该用户默认员工。员工组不能作为技能测试上下文 |
| `BYCLAW_SMOKE_SKILL_CASES_FILE` | 技能任务 JSON 文件；默认本模块 `fixtures/skills-229.json`。其他环境需配置对应资源和员工上下文的用例 |
| `BYCLAW_SMOKE_SKILL_TIMEOUT_SEC` | 单技能回复等待，默认 240 秒，上限 900 秒 |

通知入口只从私有通知配置提取上面三个测试通知变量，支持加签、重试，并检查钉钉业务返回码。报告记录测试报告群的发送状态，失败可单独重发。测试通知不读取或回退到 `SANDBOX_AUTOSCALE_DINGTALK_WEBHOOK_URL` 和 `SANDBOX_AUTOSCALE_DINGTALK_SECRET`；缺少测试报告群 Webhook 时明确报错，不发送到告警群。K3s 监控继续使用自己的告警配置。

测试每轮都通知，因此不受监控侧告警启停开关影响。浏览器子进程不继承钉钉或部署凭据。不保存认证 Cookie、Token、密码、登录录屏或网络 Trace。

从仓库根目录运行：

```sh
# 先在环境或 CI Secret 中注入 BYCLAW_SMOKE_PASSWORD。
export BYCLAW_SMOKE_NOTIFY_CONFIG=/path/to/private/.env.notify.local
sh scripts/run-release-smoke.sh \
  --env 229 --base-url "$TEST_CHAT_URL" --user "$TEST_USER_CODE"
```

在执行机私有通知文件或 CI Secret 中配置 `BYCLAW_SMOKE_DINGTALK_WEBHOOK_URL`、`BYCLAW_SMOKE_DINGTALK_SECRET`、`BYCLAW_SMOKE_DINGTALK_GROUP`。文件权限建议为 `600`，放在本目录被忽略的 `.env.notify.local` 或执行机私有配置目录。统一入口会自动读取本目录的 `.env.notify.local`，显式的通知配置文件或环境 Webhook 优先于该默认文件。发布后调用和报告重发共用这个入口。

测试报告使用“百应AI原生实验室【内部】”群的“ByClaw自动测试助手”机器人。仓库只保存变量名，不保存实际凭据；私有配置需在各执行机单独配置或由 CI Secret 注入。群名称用于标注结果，发送目标由 Webhook 决定。

正式发布测试加 `--version "$RELEASE_VERSION" --require-version`。脚本检查页面可访问、后端健康为 UP，以及 `/beyond/build-info.json` 版本匹配，避免测到旧版本。旧环境缺少版本元数据时，只能不指定版本进行手动联调，报告会明确说明；自动发布测试不会绕过检查。`--no-notify` 仅用于手动调试。

## 技能用例与覆盖口径

229 当前技能测试上下文为用户指定的“大师自动化测试-数字员工-1018”，通过执行机私有配置指定员工 ID。不改变测试用户的默认员工、员工绑定或权限。员工上下文不可用、技能入口隐藏或列表接口失败时，技能组记录初始化错误，员工组仍独立执行。

`fixtures/skills-229.json` 中每项包含：

- `resourceId` 或 `skillPath`：技能身份；可用 `agentId` 和 `packageHash` 约束上下文及版本。
- `directory`、`documentContains`：技能加载工具的规范名称和文档特征。
- `prompt`：明确的小型测试任务；不使用统一问候替代技能任务。
- `checks.all`：结果必须包含的文本；或 `checks.json`：结果对象必须满足的字段和值。JSON 可包裹在一个明确的 JSON 代码块中，多个 JSON 块会拒绝。
- `toolChecks`：可选的额外命令执行断言，例如节假日技能必须成功执行 `holiday.py check`。
- `scope`：报告中说明本项验证的能力及边界。

当前已准备财税技能的文档矩阵归口、节假日技能的固定日期脚本查询、PPT 技能的三页汇报规划、字幕技能的固定时间轴 SRT 格式转换用例。PPT 规划不代表成品 PPTX 导出通过，字幕格式转换不代表音频识别通过；财税归口不验证实时政策、税额或外部财税服务。用例不得为通过而放宽缺失的技能加载或脚本执行证据。

少于五个技能明确报告覆盖不足；前五个中未匹配到用例（含版本变更）的技能记为“未覆盖”，不会创建空测试会话或算成功。任一组不足五项均不能报告整体通过。需要知识检索或外部连接器的后续用例，还需验证相应模型、Embedding 和连接器实际调用，健康检查本身不代表这些能力可用。

## 发布后自动触发

已在 `scripts/deploy.sh` 和 `scripts/deploy-k3s.sh` 增加部署成功后的本地调用，覆盖 `init`、`update`。在发布环境配置或 CI 环境中设置：

```sh
BYCLAW_SMOKE_ENABLED=true
BYCLAW_SMOKE_BASE_URL="$TARGET_CHAT_URL"
BYCLAW_SMOKE_USER_CODE="$TEST_USER_CODE"
BYCLAW_SMOKE_EXPECTED_VERSION="$RELEASE_VERSION"
BYCLAW_SMOKE_SKILL_AGENT_ID="$TEST_SKILL_AGENT_ID"
BYCLAW_SMOKE_SKILL_CASES_FILE=/path/to/skill-cases.json
BYCLAW_SMOKE_NOTIFY_CONFIG=/path/to/private/.env.notify.local
# BYCLAW_SMOKE_PASSWORD 由 Secret 注入。
```

需要先安装执行机的依赖和浏览器。启用后测试或通知失败会使发布包装脚本返回非零，部署本身不会被自动回滚。未启用的环境沿用现有部署行为。直接运行远端根目录 `deploy.sh` 或其他流水线时，需要在部署成功后显式调用同一测试入口。

Devloop 可在目标环境部署步骤之后，将本脚本作为独立步骤执行，通过环境变量注入测试账号并归档报告。不要直接套用当前 Workspace 模式的 `tests/run.sh` 合约：该合约面向业务工作区，且默认走远端 Maven 测试；本测试需有浏览器的执行机。无需跨模块源码依赖。

## 报告、失败排查与重发

默认每轮写入独立的 `results/<运行编号>/`，已被 Git 忽略：

- `selection.json`：本轮冻结的员工 ID 和名称。
- `skill-selection.json`：技能组固定员工、技能资源标识、路径及版本信息。
- `summary.json`、`report.txt`：逐项结果、耗时、保留会话链接、清理状态、群通知状态。
- `reports/junit.xml`：可供 CI 展示的逐项结果。
- `status.json`：两组分别统计的执行与覆盖结果；退出码 `0` 表示员工和技能各五项通过、清理成功且通知成功。
- `artifacts/`：失败截图和仅包含事件名、请求/会话/员工标识的诊断记录。不会归档原始对话流。

通知失败不重跑对话，可单独重发已完成报告：

```sh
sh scripts/run-release-smoke.sh --notify-only /path/to/completed/run
```

员工组验证对话可用性，不对问候做固定文案匹配。技能组验证加载及各用例声明的最小任务，不代表技能所有业务能力通过。前五项随用户权限和产品排序改变；每轮报告保留本轮选择，便于版本间比较。旧的五项员工报告可继续单独重发，不会被重新解释为十项报告。正式环境需另行配置环境地址、账号、技能上下文及用例。
