# @zhchxiao123/dsh-devflow-business

[English](README.md) | 中文

**仓库承载的业务知识**：工作区把一个业务领域蒸馏出的事实记录为 `.devflow/business/<bucket>/<id>.md`，分五桶——`meta`、`principle`、`scenario`、`practice`、`reference`。文档只能经 `devflow_write_business` 落盘，每次写入一律为 `pending-review`，升级为确认要由人改文档自己的状态行。工作区没有 business 目录时插件完全惰性。

这是 devflow 其余知识面装不下的一层。[spec 文档](../devflow-spec/README.md)用可求值的 anchor 把每条断言绑到代码上；[iron rules](../devflow-iron-rules/README.md)是脚本能判的义务。业务事实依托于技术方案、复盘和串讲——没有 anchor 能求值它，也没有脚本能判定它。它需要的是一个以人的确认、而非解析器的裁决作为新鲜度信号的存储。这恰恰是 spec 契约里 `no-anchors` 这条拒绝码不愿假装的东西：一个什么都不锚的文档会永远报告自己 `fresh`。

## 契约

四条机制，缺任何一条这个包就不成立：

1. **唯一写入路径。** `devflow_write_business({ id, bucket, title, body, sources, scope, watches?, replaces? })` 是文档落盘的唯一途径。这是被强制的而非约定的：business 根位于 `.devflow/` 之下，而 [`dsh-devflow-fs-guard`](../devflow-fs-guard/README.md) 拒绝文件工具写入该目录，并在拒绝信息中点名本工具。**任何拒绝都发生在第一个字节落盘之前**，所以被拒的写入让知识库字节级保持原样。

2. **评审围栏。** 写入产出 `status: pending-review`，工具 schema 中不存在任何能产出其他值的参数。`confirmed` 的效力来自 code review，从一次聊天轮次里铸造出来就等于跳过了赋予它效力的那次评审——与 iron rules 对待 `owner: admin` 的姿态相同。经 `replaces` 修订会把一个已确认文档打回 pending：修订过的知识没有继承前身确认状态的道理。`review-queue.yaml` 是每次写入重建的投影，编辑它不会升级任何东西。

3. **只认已登记的来源。** 每条断言声明的 `sources` 必须存在于 `source-manifest.yaml`，引用其他任何东西的写入都会被拒。manifest 自身位于围栏之内且没有任何工具写它，所以扩充可引用材料的集合是一次经评审的改动。未登记的材料不是来源。

4. **可收缩与衰减。** `replaces` 在替换写入后删除被点名的文档：一个 id 就地修订，多个 id 合并一簇——这是知识库唯一的收缩路径。反方向上，一个 `scenario` 或 `reference` 文档声明的 `watches` 路径**全部**消失时会被报为僵尸；部分消失只算作普通的目录重组，因为把那个报成腐烂会训练所有人无视这个信号。

### 拒绝码

`write` 以稳定的码拒绝，而不是收下一个事后无从检查的文档：

| Code | 触发 |
|---|---|
| `invalid-id` | id 不匹配 `^[a-z0-9][a-z0-9-]*$`；在拼出任何路径之前就拒 |
| `invalid-title` | 标题为空；无标题文档加载时会被警告并跳过，写下去就是个没人读得到的文件 |
| `unknown-bucket` | 不在闭合的五桶之内 |
| `no-sources` | 没有来源的断言是事后无从检查的断言 |
| `unregistered-source` | `source-manifest.yaml` 未登记的来源 |
| `dangling-reference` | 正文以 `[[id]]` 引用了不存在的文档 |
| `exists` | id 已被占用且未列入 `replaces`，或 `replaces` 点名了不存在的 id |

**引用检查是单向的，这是刻意的。** spec 契约对它的 `[[id]]` 关系做双向检查，是因为 anchor 与其引用处在同一个文档、同一次写入之内。而在这里，引用落在**另一个**文档里，所以一个领域的第一个文档必然无人引用——而蒸馏正是先立元语。写入期拒绝一个无人引用的文档，等于拒绝唯一正确的作者顺序。孤儿检测因此归入卫生报告，与僵尸检测并列：两者问的都是"知识库是否健康"，而不是"这次写入是否合法"。

### 读取刻意不设围栏

守卫只覆盖 `fs/write-intent` 与 `fs/edit-intent`，所以 `read`、`glob`、`grep` 触及 `.devflow/business/` 时不受任何阻拦——而文档的 `status` 就是一行 frontmatter，普通读取一眼可见。因此本包**不提供读取工具**：spec 契约需要那个工具，是因为新鲜度必须先求值、读者才可能得知；这里不存在与之对应的求值。

## `devflowBusiness` 服务

`ctx.get('devflowBusiness')` 暴露 `read(agent, id)`、`list(agent, bucket?)` 和 `hygiene(agent)`——为想要解析后结构而非字节的消费者提供。它是**可选**服务；没有挂载本插件的部署根本没有业务知识，并且应当如实说明，而不是自行编造。

`hygiene` 报告孤儿、僵尸和待审集合。这里没有任何东西会打断一个 turn：过期的 iron rule 是义务、会阻塞，而业务知识是**参考**，读者欠它的是认真看一眼，不是一场较量。报告是被拉取的，绝不推送进模型步骤。

## 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `root` | `.devflow/business` | 会话自身推导不出根的调用方所用的 business 根；相对路径相对进程 cwd 解析。 |

带会话工作目录的 agent，其根恒为 `<cwd>/.devflow/business`，与其余每个 devflow 根的推导方式一致——**不是**最近的 git 祖先，所以卡片、spec 文档、iron rules 和业务知识始终共用一个 `.devflow/`。有一个后果值得明说：跨多个仓库的业务领域会得到每仓一份知识库，通过 `reference/` 文档彼此关联，而非共享。

## Model Experience

### 工具 schema

#### 模型看到什么

一个工具。其描述承载 schema 无法强制的蒸馏纪律——一个文档就是一条可独立判真的事实；权衡判断（两个方案都站得住，有人选了其一）作为 `practice` 里的历史决策记录，而不是写成规则，因为把判断编码成规则会制造出貌似可信、实则错误的知识。评审围栏也写在那里，因为模型无法解除它，也不该把一条待审断言说成已确立的事实。

[`dsh-devflow-guidance`](../devflow-guidance/README.md) 中的 [`devflow-business-distill`](../devflow-guidance/assets/devflow-business-distill.md) skill 承载跨调用的流程，且仅在本契约被组合时才注册。

#### Token 影响

插件活跃期间一份固定的 schema 开销。没有任何常驻内容：没有规则块，没有 pre-step 索引，没有 runtime context。文档只在读者打开它时才消耗 token。

#### KV Cache 影响

无；本包既不组装也不发送 provider 请求，也不发布任何可能让前缀失效的 runtime context。

## 已知限制与延后事项

- **没有读取工具。** 读取不设围栏且 `status` 在 frontmatter 里可见，做一个只会与文件工具重复。若某个消费者确实需要"算出来"而非"读出来"的新鲜度，那就是重新考虑此事的现实需求。
- **没有 pre-step 索引或常驻。** 业务知识是参考，而一个领域的知识库也塞不进注入块。从不打开知识库的模型不会从本包得到任何提示——skill 的 description 就是全部路由面。
- **登记来源需要人。** manifest 在围栏内且没有工具写它，所以一次蒸馏无法自行开出来源清单。这与评审围栏是同一条论证，也是同一份摩擦。
- **没有 `/devflow business` 普查命令。** `review-queue.yaml` 和卫生报告都可直接读取；命令面延后到有人报告找不到它们再说。
- **孤儿与僵尸检测只能拉取。** 没有 turn-end 钩子，也没有后台扫描，所以无人评估的知识库会无声衰减。这是刻意的：另一个选项是为了一份参考去打断 turn。
