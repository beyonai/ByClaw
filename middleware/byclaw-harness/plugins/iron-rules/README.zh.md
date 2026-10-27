# @byclaw/dsh-iron-rules

[English](README.md) | 中文

让仓库把团队"铁律"作为版本化资产携带：铁律正文在开发前常驻进模型上下文，配套校验脚本在每个产生代码改动的 turn 结束时自动运行。

铁律随 git 提交分发——管理员 merge 一个 PR 就完成下发，员工 pull 就生效，且有完整的 git history 可追溯。

插件做三件事：

1. **常驻注入** —— 每条铁律的**正文**（不是索引）在第一个 request 就进上下文，并在 compaction 后自动重新注入
2. **自动校验** —— 产生代码改动的 turn 结束时并发运行各铁律的 `check.sh`，失败则驱动模型修复
3. **聊天沉淀** —— `/iron-rule` 命令与 `record_iron_rule` 工具，沉淀后**下一个 request 即生效**
4. **自进化** —— 捕获时强制分诊、支持修订与 N→1 聚类合并、检测已失效的校验脚本、超限转为维护事件，让规则集在使用中**变好**而不只是**变大**

## 目录约定

铁律放在项目根（最近含 `.git` 的祖先目录）的 `.iron-rules/` 下，一条铁律一个目录：

```
.iron-rules/
├── no-any-in-src/
│   ├── RULE.md        # 正文
│   └── check.sh       # 可选校验脚本
└── jsdoc-on-exports/
    └── RULE.md        # 无脚本 = 纯人肉铁律，只注入不校验
```

`RULE.md`：

```markdown
---
id: no-any-in-src
title: 禁止在 src/ 下使用 any
owner: admin
---

类型不确定时用 `unknown` 再收窄。第三方库缺类型时在 `types/` 下补声明。
```

| 字段 | 说明 |
|---|---|
| `id` | 冗余于目录名，让文件自解释。**不一致时以目录名为准**并记一条 warn |
| `title` | 必填。缺失则该条被跳过并 warn |
| `owner` | `admin` 或 `local`（默认）。`admin` 呈现为不可协商；其强制力来自 code review 与 git 权限，不来自本插件 |
| `enforcement` | `script`（有校验脚本决定违规）或 `judgement`（只能靠人读）。**这是分诊结果，被记录而不是被推断** |
| `watches` | 空格分隔的路径前缀，相对项目根。`enforcement: script` 时必填 |

正文约定四段：**禁令**（加粗单句，可 grep）/ **来由** / **正确做法** / **校验指针**。

**向后兼容**：旧规则没有后两个字段。`enforcement` 缺失时按有无 `check.sh` 推断；`watches` 缺失时腐化检测跳过该条（**未声明 ≠ 未腐化**，也 ≠ 已腐化）。强制只作用于新写入。

目录名即权威 id，必须匹配 `^[a-z0-9][a-z0-9-]*$`。`../escape`、`a/b`、绝对路径等在 **id 层面**被拒绝，不会拼进任何路径。

单条铁律畸形只会跳过它自己并 warn，不影响其余铁律——一条坏规则不能让整套失效。

## 常驻注入

铁律**全文**在 `agent/pre-step` 注入，`admin` 组排在前面并标注不可协商。

这里刻意不做"索引 + 按需加载"。索引适合"用得上时再翻"的能力（skill 就是这个语义），而铁律是义务——模型没打开的铁律等于没遵守。

三条保证：

- **先 `next()` 再注入** —— 绝不短路后面的 pre-step 监听器（`dsh-agent-instructions`、`dsh-tool-skill` 都在这条链上）
- **digest 幂等** —— 对 `(id, owner, title, body)` 算 SHA-1 存进消息 source；内容没变不重复注入。digest 覆盖的是**数据**不是渲染文本，所以改措辞不会触发全量重发
- **compaction 后重发** —— 通过 `session.surface.nodes` 判断上一条铁律消息是否还在可见面上；被压缩掉就重新注入完整版。**铁律离开上下文等于失效**，这是本插件最不能接受的失败模式

正文里的 `</system-reminder>` 会被转义——仓库内容不能闭合插件自己的框。

超过 `maxBytes` 时保留靠前的铁律，注入的**不是被丢弃清单，而是一条维护指令**：列出未载入的 id + 三个处理方向（合并 / 退役 / 本就不该常驻），并明说这些铁律在处理前不会被遵守。

超限是**维护事件，不是渲染问题**。列一下伤亡然后继续，只会训练所有人接受一个悄悄缩水的规则集。

## 沉淀

**`record_iron_rule` 工具是唯一的写入路径。** `/iron-rule` 不写盘，它把请求交给模型。

### `/iron-rule <想固化的规则>`

```
/iron-rule 别再往 src/ 里塞 console.log 了
```

命令把这句话framing 成一个任务、`agent.followup()` 起一个新 turn，模型随后：

1. 读相关代码，确认这条规则在本项目里的准确表述
2. 对照现有铁律 id（随任务一起给它），避免重复或冲突
3. 判断能否机械校验，能就写 `check.sh`
4. 调 `record_iron_rule` 落盘，并告诉你写了什么

**为什么绕这一圈**：写规则文本是容易的一半，写一个用对了项目真实路径和模式、不误报的 `check.sh` 才是难的那半，而那需要先看代码。命令直接把聊天里那句话写进去，得到的只是用户对两者的猜测。顺带，模型这一轮的回复本身就成了确认——命令自己没有什么有用的结算文本可显示。

### `/iron-rule`（不带参数）

列出现有铁律，同样走一个模型 turn——命令结算在对话流里**折叠成一行且截断**，任何长度的列表都读不了。花这一个请求换正常排版；铁律本来就常驻在上下文里，模型不需要读文件。

既然这个请求要花，就让它多做两件光靠罗列给不了的事：按「团队铁律 / 本项目沉淀」分组，以及指出彼此**重复或冲突**的条目。

**铁律为 0 时不走模型**，直接返回一句话——折叠成一行正好够，为一个空目录花一个请求没有道理。

> **必须在已开始的会话里使用。** `CommandInvocation.agent` 是必填字段，命令在类型层面就要求一个已存在的 agent——在还没发过任何消息的启动页上，斜杠行不会被派发成命令，也不会因此新建会话。先发一句话开启会话，再用 `/iron-rule`。

### `record_iron_rule` 工具

参数 `id` / `title` / `body` / `enforcement`（必填）/ `check` / `watches` / `replaces`。除了被 `/iron-rule` 任务驱动，模型也会在用户明确表达"以后都要…"、"这是铁律"时主动调用。描述里写明了**不得**用于总结建议或自己的结论——错误沉淀会进仓库、影响此后所有会话。

### 分诊：捕获时必须回答的问题

写入前四条硬校验，**跳过分诊是规则集最终全是散文的默认路径**，所以答案必须被说出来：

| 条件 | 结果 |
|---|---|
| `enforcement` 缺失 | 拒绝（工具 schema 层 required） |
| `script` 但无 `check` | 拒绝 |
| `script` 但无 `watches` | 拒绝 |
| `judgement` 却给了 `check` | **拒绝**——自相矛盾，说明没真的做决定 |

最后一条是刻意的：允许它就等于允许敷衍填写。

分诊的作用不止于分类。实测中模型为了让规则可机检，**反过来修正了规则表述**——原表述含时序意图（「调试完要删」，脚本判定不了），它没有硬凑一个测不准的 grep，而是把禁令收紧成「`src/` 下不许残留」。**让规则和它的强制层对齐**是这个必填字段的真正收益。

### 修订与聚类：让规则集能收缩

`replaces: string[]` 列出本条取代的规则 id，它们会被**删除**（git 保留历史）。

- **1 个 id** = 原地修订
- **多个 id** = 聚类合并。两条以上规则说同一件事时，正确动作是合成一条，不是拒绝第三条
- **拒绝替换 `owner: admin`**——admin 的效力来自 code review，模型改它就绕开了那道审查
- 预算按**净变化**计算：合并三条大规则是减负，按纯加法算会把它挡在门外
- 任何校验不过 → **零写入**。半完成的替换（新的写了、旧的没删）恰好留下这功能要消除的重复

替换后注入的增量会**点名被取代的 id**——它们的正文还在历史里，不说清楚模型会继续遵守。

### 写入行为

| 情形 | 结果 |
|---|---|
| 非法 id（`../escape`、`a/b`、绝对路径） | 在 **id 层面**拒绝，不碰文件系统 |
| id 已存在且不在 `replaces` 里 | 拒绝，提示用 `replaces` 修订 |
| 写入后超 `maxBytes`（按净变化） | **拒绝并报出实际字节数**，不截断 |
| 成功 | 写目录 + 删除被替换的 + `agent.inject()` 一条增量，下一个 request 即生效 |

一律写 `owner: local`。`admin` 的效力来自 code review，从聊天里直接产出 admin 铁律恰好绕开了赋予它效力的那道审查——升级为 admin 是一次被 review 的文件修改，不是一个参数。

## 校验脚本约定

| 项 | 约定 |
|---|---|
| 执行方式 | `bash <绝对路径>`，**不需要可执行位** |
| 工作目录 | 项目根（不是 session cwd），脚本内相对路径稳定 |
| exit 0 | 通过 |
| exit 非 0 | 违规 |
| 被信号杀死 | 按违规处理（没有产出裁决，不能默许） |
| stdout | 给模型的违规详情 |
| stderr | 脚本自身错误，只进日志；stdout 为空时作为兜底详情 |
| 无法执行 | warn 并**按通过处理**——坏掉的脚本不该卡住所有人 |

脚本默认直接执行、不做审批。铁律经 git 提交，能改 `check.sh` 的人本来就能改代码，所以脚本的信任边界等同仓库写权限。

### 抗腐：检测僵尸校验脚本

铁律有两种失效方式，`check.sh` 只防了第一种：

| 失效方式 | 防御 |
|---|---|
| 规则**没被遵守** | `check.sh` 在 turn 结束拦截 |
| 规则**不再作数** | 本节 |

最危险的形态：`check.sh` grep 的是 `src/`，而 `src/` 早改名成 `lib/` 了。脚本**永远 exit 0**，界面永远绿。**一个不可能失败的校验比没有校验更糟——它读起来是通过的。**

判定：`watches` 声明的路径**全部**不存在 → 腐化。

- **只在全部缺失时报**。部分缺失可能是正常的目录重组，误报会教会人忽略这个信号
- 未声明 `watches`（旧规则、判断型规则）→ 跳过。无声明则无从判断，"未知"不能读作"已腐化"
- **不阻断**任何流程——不拦校验、不拦 turn 结束、不触发续跑

呈现：校验通过但已腐化时附一句"其监视路径已不存在，此次通过没有意义"；`/iron-rule` 列表里单独点出，并额外列出**部分**路径缺失的条目（`[id]（3/10）`）供复核。**给绿色打问号才是修复。**

#### ⚠ 这个机制比它听起来弱得多

路径存在性只是"校验还有效"的一个**很弱的代理指标**。它能抓什么、不能抓什么：

| 校验的死法 | 能否抓到 |
|---|---|
| `src/` 改名成 `lib/` | ✅ |
| 换了日志库，8 条 grep 正则全部不再匹配（路径都还在） | ❌ 完全抓不到 |
| 新增一个应用，没加进脚本的扫描范围 | ❌ |

**第二种大概率更常见**，而它对本机制完全隐形。对天然跨仓库的规则（`watches` 声明了十个应用目录），连第一种也几乎不会触发——十个全消失意味着仓库空了，所以只有"部分缺失"那个计数还有一点信号。

要真正证明"这个校验现在还有效"，只有两条路：把监视路径的 git churn 与规则的修改时间对比（`codebase-map-init` 的 `check-entry-freshness` 模型），或者让每条规则附一个已知违规样本、要求脚本必须能抓住它。两者都未实现。

**所以：不要把这里的绿色当成"校验有效"的证明。** 它只排除了一种失效方式。

### 触发时机

在 `agent/turn-stopping` 运行。三层控制：

1. **改动门控** —— 本 turn 没有成功的 `write` / `edit` 就直接跳过。`turn-stopping` 每个 turn 都触发（用户问一句话也算），而它是 awaited 的，耗时直接计入用户感知延迟
2. **并发执行** —— 所有 `check.sh` 并行跑，结果聚合成一条反馈
3. **续跑上限** —— 失败时通过 `steer()` 强制模型再跑一步修复；连续 `maxRetries` 次仍未通过则停止续跑，把决定权交回用户

## 配置

```yaml
- id: iron-rules
  name: '@byclaw/dsh-iron-rules'
  config:
    rulesDir: .iron-rules
    maxBytes: 32768
    checkTimeoutMs: 120000
    checkOutputMaxChars: 2000
    maxRetries: 2
```

| 字段 | 默认 | 说明 |
|---|---|---|
| `rulesDir` | `.iron-rules` | 铁律目录名，相对项目根。必须是单个目录名 |
| `maxBytes` | `32768` | 注入正文的字节上限。超限注入维护指令；沉淀超限硬拒绝 |
| `checkTimeoutMs` | `120000` | 单个 `check.sh` 超时 |
| `checkOutputMaxChars` | `2000` | 每条违规详情引给模型的字符上限，防止脚本输出撑爆上下文 |
| `maxRetries` | `2` | 连续强制续跑上限。设 `0` 表示只报告一次、从不强制重试 |
| `requireApproval` | `false` | 预留：执行脚本前要求用户审批。当前不生效 |
| `workspaceOnToolEnvironment` | `false` | 经上下文的工具环境（`ctx.fs` / `ctx.subprocess`）读写铁律，而不是本进程的文件系统；共享 DSH 宿主会打开它，因为用户的项目在各自的工具沙箱里 |

## 安装

**装打包出的 tarball，不要装目录。**

```sh
npm run package        # = build + npm pack，产出 byclaw-dsh-iron-rules-<version>.tgz
dsh plugin --profile <name> add /abs/path/to/byclaw-dsh-iron-rules-0.1.0.tgz
# 重启该 profile
```

验证：

```sh
dsh --profile <name> --dump-config | grep iron-rules   # 组合树里应出现插件行
```

仓库里没有 `.iron-rules` 目录时插件完全无副作用，可以放心先装后配。

> **为什么必须用 tarball**：本目录的 `node_modules/@deepseek-ai/*` 是开发期软链（见下）。装目录会让包管理器把整个目录链进 profile，这些软链就会**遮蔽 profile 自己的副本**。而 `lib/` 有三个真实的运行期 import（`@deepseek-ai/schemastery`、`dsh-llm`、`dsh-tools`），一旦解析到源码 checkout，插件拿到的就是与宿主不同的模块实例——schemastery 尤其危险，Loader 要用它校验本插件的 Config。tarball 只含 `lib/` + manifest + `cordis.patch.yml`，不带 `node_modules`。
>
> **例外：插件本身就在 DSH 工作区内时（镜像构建就是这样）**，那些软链指向的正是宿主运行的同一份包，同一个模块实例，装目录是安全的——`Dockerfile` 因此和其余插件一样直接 `dsh plugin add <目录>`。判据不是「目录还是 tarball」，而是**软链指向的包与宿主用的是不是同一份**。

### 开发期依赖

DSH 包未发布 npm，本仓库也不是 DSH 源码工作区，所以 `workspace:` 范围无法解析。`scripts/link-dsh.mjs` 把用到的 `@deepseek-ai/*` 符号链接到一份**只读**的 DSH checkout（默认 `/workspace/deepseek-harness`，`DSH_ROOT` 可覆盖），Node 再经各包 `exports` 解析到已构建的 `lib`。链接只指向 checkout，不写入它。

链接源按顺序尝试三处，所以**只装了 dsh 运行时、没有源码 checkout 的机器也能构建**：

| 优先级 | 来源 | 位置 |
|---|---|---|
| 1 | 显式指定 | `$DSH_ROOT` |
| 2 | 自动发现 | 从插件目录向上，找任一祖先目录下的 `deepseek-harness/` |
| 3 | 已安装的 dsh | `$DSH_HOME/profiles/node_modules/@deepseek-ai/`（默认 `~/.dsh`） |

**不设绝对路径默认值是有原因的**：容器与共享其文件系统的宿主机，看同一批文件用的是不同路径，任何写死的绝对路径必然在其中一边失效。向上查找两边都能命中，也同时覆盖 `plugins/<name>` 和 `.worktrees/<branch>/plugins/<name>` 两种布局。

三处都找不到时**直接中止并报出查找过的位置**，而不是放任 tsc 吐一屏 TS2307 把真正原因埋掉。

```sh
npm install            # 只装 typescript / @types/node
npm run verify         # = link:dsh + build + 离线冒烟
```

`build` 和 `typecheck` 都会先跑 `link:dsh`，所以链接被清理掉也能自愈——**不要依赖 `node_modules` 里的软链常驻**。这一步刻意**不挂 `postinstall`**：`scripts/` 不在发布的 `files` 里，装 tarball 时钩子会找不到文件而让整个安装失败。

> 构建只有**修改本插件**时才需要。仅仅是安装的话，用别人打好的 tarball 即可，不需要任何 DSH 源码。

## Model Experience

### 常驻铁律

#### 模型看到什么

一条 `<system-reminder>` 框住的 user 消息，含全部铁律正文，来源为类型化的 `iron-rules`（`form: 'instructions'`，携带 digest 与 id 列表）。新沉淀的铁律以增量消息追加，不重发全量。

#### Token 影响

铁律总量上限为 `maxBytes`（默认 32 KiB），每个 request 都携带直到 compaction。空的 `.iron-rules` 零开销。每次沉淀追加一条增量，此后一直在上下文里——所以沉淀不宜过于频繁。

#### KV Cache 影响

追加式，落在可复用前缀之后。compaction 后的重发会形成新的历史位置，从该点起复用。

### 校验失败反馈

#### 模型看到什么

一条来源为 `{ kind: 'plugin', plugin: 'iron-rules' }` 的续跑消息，含违规铁律 id、脚本 stdout（截断到 `checkOutputMaxChars`）、`RULE.md` 路径和剩余重试次数。达到上限时改为一条不强制续跑的通知。

> 校验反馈用通用的 plugin source，铁律正文用类型化的 `iron-rules` source。差异是有意的：只有后者需要被回扫和 digest 比对，前者是瞬时驱动。

#### Token 影响

校验通过或本 turn 无改动时零开销。失败时每次强制续跑要多付一整个 request。

#### KV Cache 影响

追加式，落在可复用前缀之后，不会让已有 KV cache 条目失效。

## 已知限制

- **规则读取走 `node:fs`，不走 `ctx.fs`**：远程或沙箱工作区（如 e2b）下无法发现铁律。校验脚本本身走 `ctx.shell`，不受此限
- **无文件监听**：外部修改在下一次 pre-step / turn-stopping 扫描时可见。因为每次都重扫，实际延迟很小
- **沉淀不能创建或替换 `admin` 铁律**——会绕开赋予 admin 效力的 code review。`local` 铁律可以经 `replaces` 修订与合并
- **腐化检测依赖 `watches` 声明**，旧规则和判断型规则不在覆盖范围内；「校验从未失败过」这类信号需要持久化运行历史，未实现
- **`owner: admin` 只是呈现与写入限制**，不阻止任何人直接改文件；真正的权限由 git 管
- **沉淀出的 `check.sh` 在同一会话内即可生效**，不经 review。对 `local` 铁律这是刻意的快速迭代路径；模型本就有 `write` 与 `bash`，边际风险有限，但要清楚这一点
- **`requireApproval` 只有配置位，无实现**：留给将来跑不可信仓库的场景
- **`check.sh` 通过 `bash` 执行**，要求运行环境有 bash。Windows 下需 WSL 或 Git Bash
- **没有 `shell` 服务时校验静默不跑**：插件不硬依赖任何服务（硬依赖会让整个插件停在 `PENDING`、连注入和沉淀一起失效），所以缺 shell 时它照常加载，只是校验那一半不激活。同理，缺 `commands` 或 `tools` 时对应入口不出现
- **尚未做真实 agent 端到端验证**：改动门控、循环上限、注入时机均只有离线覆盖
