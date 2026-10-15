# @zhchxiao123/dsh-devflow-spec-sentinel

[English](README.md) | 中文

**devflow spec 文档的 turn 末哨兵与 pre-step 索引。** 本插件监视一个 turn 的一方 `write`/`edit` 调用落在哪些文件上；当将要结束的 turn 让某篇挂锚的架构文档变为过期时，它以 steer 强制一个续跑步，点名文档、失效的 anchor 与四个合法出口——经 `replaces: [<同一 id>]` 重写、替换一篇本来就错的文档、经合并退休该论断、或显式 defer。同一篇文档绝不在同一会话内打断两次；那一次打断之后，过期经由 `devflow_read_spec` 的告警与 pre-step 的 spec 索引保持可见，而不再动用强制。

这与 [`dsh-devflow-iron-rules`](../devflow-iron-rules/README.zh.md) 刻意采取相反的节奏——两者共享 turn-stopping 的 hook 形状，不共享任何代码：铁律违规是**义务**，每个脏 turn 都拦，直到修复或到达上限；过期的 spec 文档是**参考**，读者欠它一次知情的过目，不欠它一场拉锯。这里没有重试上限，因为没有什么可重试——重构中途的一次改名让文档合理地过期多个 turn 是一种正当状态，哨兵自己的消息里就是这么说的。

零配置即有意义：没有 `devflowSpec` 缝时哨兵与索引整体惰性（两者都住在随缝进出的条件子上下文里），没有 spec 文档的工作区则永远匹配不到任何东西。

## 什么会触发打断

- 只有成功的一方 `write`/`edit` 落下的文件才算数；路径取自这两个工具的 `file_path` 参数，按发起会话的工作目录解析。
- 只有 `symbol` 与 `content-hash` anchor 参与。`churn` anchor 比较的是提交时间与文档时间——未提交的编辑翻不动它，所以 churn 的健康归 `/devflow spec` 的 census，churn anchor 也绝不出现在哨兵的消息里。
- 只有 `stale` 裁决会武装哨兵。`unevaluable` 意味着一个校验再也跑不动了，那是 census 的关切，不是本 turn 的写入弄坏了某条论断的证据。
- `list()`/`evaluate()` 失败只 warn 并让 turn 正常落定；awareness 层永远不会让一个 turn 失败或卡住。

## pre-step 的 spec 索引

在每个模型步之前，`devflow-spec-map` 运行时上下文列出与本会话所触内容相关的文档——只有索引行（id、新鲜度，锚命中的还带被触文件；从不含正文），指向 `devflow_read_spec`。两层：

- **锚命中层**（尖锐，只看写入）：anchor 声称的文件被本会话写入落中的文档。stale 的排最前并点名失效的 anchor id——被 defer 掉打断的文档恰恰因为仍然 stale 而留在这里可见。
- **scope 层**（宽，读也算）：本会话触过的每个包名下的其余文档，经下述工作区布局解析。读一个文件是"要在这动手"的早期信号。

触达窗口按会话累积，每个集合有固定的近期性上限；渲染出的索引以 `contextMaxBytes` 封顶，超出时先从尾部丢 scope 行、后丢锚命中行，且丢弃必有一行声明。harness 对快照逐步做 diff，索引不变就绝不重发。

## `devflowSpecWorkspace` 服务

本插件发布一个可选的只读服务，把工作区根映射到其成员包——即各自文档所在的 scope id 前缀。发现由一条探测器链完成，每个包管理约定一个探测器，各自只在根上读文本清单、绝不执行构建代码；布局是非 null 回答的**并集**，按（目录，scope id）去重——Maven 与 Gradle 双构建、Python 与 JS 并存的仓库需要的正是这个形状。发现由根驱动，绝不爬扫：没有任何根清单指向的游离嵌套项目刻意不被发现，因为把每个 vendored 或场景包都抬成 scope 会朝相反方向误报覆盖。只有**没有任何**探测器回答时，根 `package.json` 的 name 才作为单包顶上——回答了但为空的清单就照实报告，不被粉饰。解析失败只 warn 并给出空布局，绝不报错。消费者用 `ctx.get('devflowSpecWorkspace')` 读取；`/devflow spec` 的 census 调 `discover()` 推导 scope 覆盖并点名回答了的探测器，面对早于该面的提供者退回 `layout()`。

| 探测器 | 读什么 | 成员 |
|---|---|---|
| `pnpm-workspace` | `pnpm-workspace.yaml` 的 `packages` glob | 命中的、带具名 `package.json` 的目录 |
| `npm/yarn/bun workspaces` | `package.json` 的 `workspaces`（数组或 `{ packages }`） | 命中的、带具名 `package.json` 的目录 |
| `cargo` | `Cargo.toml` 的 `[workspace].members` + 根 `[package].name` | 成员 crate 按各自 `[package].name`；根自身是包时也算 |
| `go` | `go.work` 的 `use` 指令，否则根 `go.mod` | 模块按 module 路径尾段命名，先剥主版本尾缀（`/v2`） |
| `uv-workspace` | `pyproject.toml` 的 `[tool.uv.workspace]` | 成员 pyproject 按 `[project].name`；虚根不是成员 |
| `maven` | `pom.xml` 的 `<modules>`，跳过 `<parent>` 等外来坐标区块 | 模块 pom 按 artifactId，读不出时目录名顶替；无模块时根 artifactId 单包 |
| `gradle-settings` | `settings.gradle(.kts)` 的字面量 `include` 行 + `rootProject.name` | `:a:b` 项目路径映射为 `a/b` 目录，根名作 scope id 前缀；否则根名单包 |
| `pyproject` | `pyproject.toml` 的 `[project].name`，退化 `[tool.poetry].name` | 根作为单包；同文件存在 `[tool.uv.workspace]` 时整体让位给 `uv-workspace` |
| `composer` | `composer.json` 的 `name` | 根作为单包，取 `vendor/package` 名的 package 半段命名 |
| `ruby` | 根 `*.gemspec` 或 `Gemfile` 的存在（gemspec 是代码，绝不读取） | 根作为单包，以目录名命名 |
| `dotnet` | `*.sln` 的 `Project` 行（只认 `.csproj` 条目），否则根 `*.csproj` | 项目目录按 solution 声明的名字；否则每个根项目文件一个包 |
| `mix` | 根 `mix.exs` + `apps/*/mix.exs` 的存在（mix 文件是代码，绝不读取） | umbrella app 目录按目录名；否则根按目录名 |

各处的 glob 共享同一个窄支持面：显式相对路径与一层 `dir/*`，清单定义了 `!` 取反的照认。任何超出探测器声明支持面的东西都 warn 后跳过、绝不猜测；清单声明的名字不合 scope id 语法时降级为目录名并 warn——不发明转义规则。

仓库根的 `scripts/survey-workspace-discovery.ts` 从命令行驱动同一份 resolver（`tsx scripts/survey-workspace-discovery.ts [--pretty] <root>...`），把每个根的探测器与包集打印为 JSON——探测器改动时对真实仓库做手动回归的工具；它随仓库存在、不随本包发布，也没有任何 CI 运行它。

## 组合注意事项

- **与 `devflow-iron-rules` 并存**：两个插件在同一次 stop 上都 steer 时，agent loop 把消息合并进**同一个**续跑步，按监听器顺序送达——不丢失、不覆盖。
- **在 `agent/turn-stopping` 内，本插件只会 steer 或什么都不做。** 在钉住的 harness 版本上，该窗口内的 `inject()` 与 `steer()` 投喂同一个 next-step 列表，同样会把 turn 撑开；被 defer 文档的非打断通道是 pre-step 的 spec 索引。
- spec 索引额外要求 `systemPrompt` 注册表；没有它时，路径收集与哨兵照常运行。

## 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `root` | `.devflow/spec` | 供会话推导不出自身根的调用方使用的 spec 根；相对路径按进程 cwd 解析。 |
| `contextMaxBytes` | `2048` | 渲染后 spec 索引的字节上限；超出时先从尾部丢 scope 行，且丢弃必有声明。 |

带会话工作目录的 agent 的 spec 根永远是 `<cwd>/.devflow/spec`，与其他所有 devflow 根同一套推导。
