# @zhchxiao123/dsh-devflow-testenv

[English](README.md) | 中文

一个捆绑 skill——`devflow-e2e-bootstrap-runbook`——此外别无他物。它教 agent 把「这个系统怎么拉起来」沉淀成**目标仓库自己承载**的产物：仓库根下一个 `e2e/` 目录，里面是 `README.md` 与并排的 `up.sh`、`check.sh`、`down.sh`。后来的 agent 跑三个脚本，一两分钟就拿到可信环境，而不是重读 README、猜启动顺序，然后在一个自以为健康、实则残缺的环境上得出结论。

本包不注册任何工具，不持有运行期状态。runbook 里的脚本就是普通 shell，用 harness 自带的 `bash` 跑；这里不执行、不校验、不看护它们。**包名是历史遗留**——它此前自己编排环境：`testenv.yml` 清单加上 `env_up` / `env_status` / `env_logs` / `env_down` / `integration_test`。那套执行层连同两个 skill（`testenv-bootstrap`、`testenv-author`）已经删除；从 0.4.0-dev.7 往上升级会失去这些工具，且没有迁移路径。

## 这个 skill 管什么

正文是一套六阶段协议，其承重规则是：**runbook 里的每一条命令，都必须是作者当场真正跑过的**。凭读源码写出来的 runbook 比没有更糟——没有文档时下一个 agent 会去探索，有一份错的它会信任它、照做、然后在无声中失败。当前环境里确实无法验证的步骤（缺凭据、没有 docker daemon、包仓库被出网策略拦截），标为 `[未验证]` 并写清原因与补验条件，绝不悄悄升格成事实。

| 阶段 | 定下什么 |
|---|---|
| 侦察 | 系统由哪些部分组成。CI 配置优先（跑通的 job 天然证明了自己的命令），然后是编排文件、`.env` 样例、已有的 agent 指令文件、文档、入口代码、测试 fixture。 |
| 实际拉起 | 真跑，逐步记录：确切命令、输出中标志成功的那一行、冷启动与热启动各自耗时、每一个失败及其修法。 |
| 健康探针 | 一条检查，分进程、端口、业务三层，且**每条断言都要被反向验证**——停掉对应组件，确认它真的变红。 |
| 分层启动 | 每种测试场景对应的最小启动集，别让一个只碰数据层的测试为整套拓扑买单。 |
| 写 runbook | 脚本优先、文字兜底：`up`/`check`/`down` 幂等且自陈其行，然后在脚本**定稿之后**按固定九节写文档，贴真实输出而不是凭记忆。 |
| 从零复验 | `down --reset`，然后只读文档重走一遍 up → check，把每个文件名、成功信号、数字逐字对上。 |

协议显式预防两个 agent 环境特有的坑，因为两者几乎必踩、且都会产出自信的错误结论：用 `cmd &` 起的服务与工具调用同属一个进程组、调用结束即被清理（要用 `setsid` 加 pidfile）；以及 `--reset` 因为服务已经停了就跳过清理、却照样打印「已干净」——而「一切都停着」恰恰是新 agent 最常见的起点。

skill 还有**维护模式**：agent 按现有 runbook 操作时发现它与现实不符，先修 runbook，再继续自己的任务，并在变更记录追加一行。绕过一个已知缺陷，等于把它留给下一个 agent 再踩一次。

## 行为

`apply` 在 `ctx.skills` 上注册一个 skill provider，注册是插件 fiber 的 effect，dispose fiber 即撤回该 skill。candidate 以 `BUNDLED_SKILL_RANK` 注册，`{ modelInvocable: true, userInvocable: true }`，因此它出现在模型的 `<available_skills>` 目录里、可经 `skill` 工具加载、也响应用户的 `/devflow-e2e-bootstrap-runbook` 手势。部署方要覆盖正文，就在同层用同名、更低 rank 的 provider 注册；更近作用域的 provider 则无视 rank 直接遮蔽。正文以 `assets/devflow-e2e-bootstrap-runbook.md` 发布。

正文是中文，按作者原样发布。这与本线其他 asset 不同，且是有意为之：这段文字本身就是契约，翻译它等于重写。相对作者原文只改了五处，别无其他——skill 名；产出路径，原文是 `docs/agent/e2e-setup.md` 加 `scripts/e2e/`，这里收拢进一个 `e2e/` 目录，好让必须逐字一致的文档与脚本并排放；可移植性规则，因为原文要求写「可直接复制的 cd」，于是把作者的家目录与用户名带进了一个目标仓库要入库、别的机器要读的文件；所有权不变式，因为原文只惩罚「删不干净」，于是产出的 runbook 会复用仓库自带的 compose project，`--reset` 删掉开发者自己的库；以及求取规则，因为原文对「这个环境缺某个依赖」只有「标 `[未验证]`」一条出路——而 agent 若是自己替一个像样的中间件上去并验证了它，这条兜底根本不会触发：它满足「只写你亲手跑通的东西」，记录下来的却是另一个系统。

## 配置

无。skill 正文是能力散文而非部署策略；上面那条覆盖路径就是定制面。

## Model Experience

### Skill 目录条目

#### 模型看到什么

插件挂载期间，`<available_skills>` 里多一行：

> Generate or maintain an agent-oriented runbook (e2e/README.md + e2e/up|check|down.sh) that lets any future agent bring a system up for end-to-end testing without re-exploring the repo. Use whenever a task involves starting services for E2E/integration testing, setting up a local debug environment, or when the user mentions 沉淀启动文档 / runbook / 拉起服务 / e2e setup.

加载它会把 asset 正文（约 18 KB）注入该步。

#### Token 影响

挂载期间每次请求一行目录条目。正文只在模型或用户加载之后的那些步里计入其自身大小。

#### KV Cache 影响

目录条目参与 harness 的持久目录消息，只在可见 skill 集合变化时重发。

## 已知限制与未尽事项

- **没有任何东西校验产出** —— runbook 的质量完全靠 agent 遵守协议自带的闸门（反向验证断言、从零复验）。这里没有工具去检查 `e2e/README.md` 是否存在、其命令是否还能跑、乃至是否曾经能跑。可移植性同理：正文禁止主机身份进产出物、并让从零复验去 grep 它，但 agent 跳过那次 grep 时，留下的机器绑定 runbook 不会被下游任何东西发现。破坏性作用域再同理，而且代价更高：正文把 `down --reset` 限定在 runbook 自己创建的资源上、并让从零复验在 reset 前后比对 `docker ps -a` / `docker volume ls` / `git status`，但 agent 跳过那次比对时，交付的 `--reset` 会删掉开发者自己的库，而且不可逆。三者里最难抓的是缺中间件：正文要求 agent 去问用户而不是自己替一个，但真替了的 agent 产出的 runbook 能通过这里的每一道闸门——它确实跑通了它写下的东西——描述的却是一个没人部署过的系统。
- **产出路径是约定而非接口** —— `e2e/` 由正文写死，好让后续 agent 知道去哪找；正文同时强制要求在 `CLAUDE.md` / `AGENTS.md` 里写下指针，因为没人被告知去读的 runbook 等于没写。仓库有强烈冲突的惯例时，要覆盖正文，而不是配置它。
- **正文是静态的** —— 它无法引用当前部署实际可用的工具，所以其中关于 docker、凭据、网络可达性的说法是给 agent 拿去与现实核对的，不是拿去直接相信的。
- **包名已经对不上能力** —— 保留是为了不破坏已发布的包名与所有安装它的 profile。
