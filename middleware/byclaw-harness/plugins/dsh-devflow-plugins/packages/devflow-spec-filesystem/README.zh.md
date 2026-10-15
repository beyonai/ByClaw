# @zhchxiao123/dsh-devflow-spec-filesystem

[English](README.md) | 中文

**[spec 缝](../devflow-spec/README.zh.md)的文件 Service Provider**：架构文档存放在 `<root>/<id>.md`，每次读取都对工作树重新求值它的 anchor。

## 布局与配置

```yaml
- name: '@zhchxiao123/dsh-devflow-spec-filesystem'
  config:
    root: .devflow/spec      # 文档目录；相对路径对 cwd 解析
    repoRoot: .              # anchor 的相对文件路径对它解析
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `root` | `.devflow/spec` | 调用方未给出 root 时使用的默认 spec 根 |
| `repoRoot` | `.` | anchor 文件路径解析所依据的仓库根 |
| `maxNetGrowthBytes` | `8192` | 单次写入的**净**增长上限：新文件大小减去它取代的一切。合并通常为负因而恒过——把聚类合并按纯新增计费，恰恰会拒绝唯一能让集合缩小的动作。它预算的是可评审性而非上下文：正文从不成批到达模型，所以大文档的代价落在必须维护它为真的人身上。 |

默认根位于 **`.devflow/` 之内**，而 `@zhchxiao123/dsh-devflow-fs-guard` 按目录名匹配，已经拒绝文件工具写入该子树。这不是巧合：它让本 store 成为**唯一写路径**，而不只是"本意如此"的写路径，且无需为它增加第二条守卫配置。

一篇文档是 frontmatter 加 Markdown 正文：

```markdown
---
title: Error Handling
description: 域拒绝与基础设施失败的分野
updatedAt: 2026-09-02T00:00:00.000Z
anchors:
  - id: a1
    kind: symbol
    file: packages/devflow/src/types.ts
    symbol: CreateRejectionCode
---

## Source of truth

| Anchor | 指向 |
|---|---|
| `a1` | `types.ts#CreateRejectionCode` |

拒绝码是一个封闭集合 [[a1]]。
```

frontmatter 的字段是：`title`、可选的 `description`、`updatedAt`、可选的 `waives`，以及 `anchors`。

`updatedAt` 由 store 在写入时刻盖上，**绝不读取文件系统 mtime**——checkout、复制、容器构建都会重置 mtime，而 churn anchor 要拿它做比较基准。

`waives` 是一串 scope id，表示该文档裁定这些 scope 刻意不需要属于自己的架构文档；它原样进入 `list()` 摘要——frontmatter 在那里已经解码过，因此需要知道"谁豁免了谁"的普查不必多付一次 I/O，也不必打开任何正文。解码只校验形状：已经在磁盘上的文件按它当下的样子如实报告，与一条已经过期的 anchor 同理，而 `self-waiver` 是**写入路径**才拒绝的。不豁免任何东西的文档根本没有这个键，因此该字段出现之前写下的每一篇文档，解码、重新编码与报告的结果都逐字不变。

## Anchor 求值

| 类型 | 如何判定 |
|---|---|
| `symbol` | 解析文件并查找该符号 |
| `content-hash` | 重新计算符号规范化体的 hash 并比对 |
| `churn` | 对该文件跑 `git log -1 --format=%cI`，与 `updatedAt` 比较 |

`symbol` 与 `content-hash` 按被引文件的扩展名分发到各语言的求值器；没有任何求值器认领的文件报 `unevaluable`——只有 churn anchor 能看住它。

| 语言 | 扩展名 | 顶层符号 | 规范化 |
|---|---|---|---|
| TypeScript / JavaScript | `.ts` / `.tsx` / `.js` / `.jsx` 及其 `m` / `c` 变体 | 函数、类、interface、类型别名、enum 与变量语句；多声明子语句的任一名字都解析到整条语句 | 去掉注释与语句分号，折叠空白 |
| Python | `.py` / `.pyi` | 模块级 `def` / `class` / 单名赋值；带装饰器的定义按内层名字匹配，连同装饰器一起进 hash | 去掉注释、标记 block 边界——缩进是语义——并去掉惰性尾逗号；docstring 与引号风格留在 hash 内 |
| Go | `.go` | `func`、`type`、`var`、`const`——`const (...)` / `var (...)` / `type (...)` 组内任一名字锚到整个声明块——以及按 `Type.Name` 引用的方法 | 去掉注释与 gofmt 展开复合字面量时的尾逗号；此外不动任何东西，因为 gofmt 输出没有行尾分号，而 `for` 子句里的 `;` 是语义 |
| Rust | `.rs` | 所有具名 item——`fn`、`struct`、`enum`、`union`、`trait`、`type`、`const`、`static`、`mod`、`macro_rules!`——以及 `impl` / `trait` 体内的 item，按 `Type.name` 引用：impl 的泛型参数被剥掉（`impl<T> Foo<T>` 得 `Foo.bar`），trait impl 按自身类型而非 trait 引用 | 去掉注释（文档注释一并去掉）与 rustfmt 展开容器时的尾逗号——但单元素元组的逗号永不去掉；属性与它修饰的 item 一起进 hash，分号保留，因为一个分号会把块的尾表达式变成语句 |
| Java | `.java` | `class` / `interface` / `enum` / `record` / `@interface` 及其成员，按 `Type.name` 引用——嵌套类型用 `.` 分隔且不限层数，构造器写作 `Type.Type`，同名的全部重载解析为**同一个**被 hash 的单元 | 去掉注释（Javadoc 一并去掉）与数组初始化器、最后一个枚举常量后的尾逗号；注解与声明一起进 hash，分号保留，因为 Java 的分号是强制的，不是格式化工具的选择 |

**规范化去掉格式化工具可能移动的，保留实现变更才会移动的**，因此重排版不会移动 hash，而改动一行会。TypeScript 的语句分号是刻意去掉的：它是各工具最常有分歧的那个格式维度，如果一次格式化加上分号就把全仓 anchor 打成过期，结果只会是**训练所有人忽略这个信号**。注释经各语言自己的解析器剥离而非正则——正则分不清字符串字面量里的 `//` 和真注释。

**规范化规则与文法都在 hash 域内。** 改动某语言的规范化——或升级它的文法——会让该语言全部 content-hash anchor 一次性过期，因此这些 tree-sitter 文法（`tree-sitter-python`、`tree-sitter-go`、`tree-sitter-rust`、`tree-sitter-java`，其 wasm 经 `web-tree-sitter` 加载）按精确版本钉死，且它们的 npm install 脚本被刻意拦下：始终只加载 tarball 自带的 wasm，绝不做原生构建。

**一条注释进不进 hash，只看一个标准：它在运行期可观测吗？** Python 的 docstring 经 `__doc__` 可观测，因此留下。Rust 的文档注释只到 rustdoc、Java 的 Javadoc 只到 javadoc，因此与普通注释一同去掉——散文变动不是实现漂移，想看住散文的文档有 `churn` 可用。

git 每个 store 只探测一次。不在工作树内时求值器根本拿不到查询函数，因此 churn anchor 报 `unevaluable`——**绝不是 `fresh`**。

### `ANCHORABLE_EXTENSIONS`

所有求值器认领过的扩展名，按注册表顺序去重。本 store 以它回答缝上的 `anchorableExtensions`，而不是另抄一份；给注册表加一门语言，这个集合随之变化，别处一行都不用改。

它是注册表的**分母**面。带这些扩展名之一的文件，才是符号类 anchor 指得到的文件，因此"这个目录里有多少内容能被文档 anchor 住"这个问题只有这份清单答得了——这正是 `/devflow spec` 的覆盖普查向挂载的 Provider 要它、而不是自留一份语言清单的原因，也是第六门语言落地那天这个计数仍然为真的原因。

与它配套的计数口径刻意是粗的，并且写在人读到这些数字的地方：**跳过 dot 目录与 `node_modules`**（dot **文件**照数，因为 anchor 可以指向它），**不解析 `.gitignore`**——ignore 文件解析是另一个可以无限深下去的问题，而一句话说得完的规则才是读者能跟它争辩的规则——并且结果是**一个分母，不是一个阈值**。本线里没有任何东西会因为某个 scope 的文档数对着这个数字显得少，就拒绝一次写入、判失败或给该 scope 降级；"够不够"是判断题，与结构契约刻意不校验"每条论断都挂了 anchor"同理。

## 写入路径

`write` 在碰文件系统之前依次拒绝：id 合法性、`Source of truth` 小节、至少一个 anchor、双向引用关系、被豁免的 scope，然后是存在性，最后是 anchor 求值。`waives` 中不合法的 id 以 `invalid-id` 拒绝；列出文档自己所在的 scope 则以 `self-waiver` 拒绝——那个 scope 已经有文档，是**已覆盖**而不是豁免。被豁免的 scope 究竟有没有人期望它有文档，不在这里判定：本 store 不持有期望集。每个声明的 anchor 都必须求值为 `fresh`——**一篇文档不得一出生就是过期的**。文件先写临时路径再 rename，失败的写入不会留下半篇文档。

领域拒绝解析为 `ok: false` 并带稳定 code。基础设施故障——路径存在却读不了、根目录不可写——则 reject，因为它们不是关于这篇文档的裁决。

## Model Experience

间接经由 `dsh-devflow-spec-tool`；本 Provider 不注册任何提示词或 schema。

#### KV Cache effect

无；本包既不组装也不发送 provider 请求。

## Known Limitations and Deferred Work

- **没有引用索引。** 没有任何地方记录哪些卡片触及过哪篇文档，因此「这篇几个月没人引用了」无法回答。推导它意味着每次查询都要读遍每张卡的 `spec-refs` 登记——成本随看板规模无上界，而其余健康信号都以文档数为界。它想要的形态是**登记时维护的索引**，不是读取时的全表扫描。
- **一次读取仍为每个被引文件付一次 `stat`。** 解析缓存正是以这些 stat 为键，所以未改动的文件在 store 生命期内只解析一次；但身份检查本身不缓存，也不该缓存——它正是让一次编辑在下一次读取时立刻可见的东西。
- **`symbol` 与 `content-hash` 只达及配有求值器的语言**——今天是 TypeScript/JavaScript、Python、Go、Rust 与 Java。没有求值器认领的文件只能挂 `churn`，两种符号类 anchor 对它报 `unevaluable` 而不是放行。
- **Java 的一组重载是一个被 hash 的单元。** `Type.name` 解析到该名字的全部声明，因此改动任一重载都会让写着另一重载的 anchor 过期。另一条路——只取第一个——会让 anchor 在文档所述的那个重载被重写后依旧报 fresh，而**无声的假 fresh** 正是这里代价最高的失败。
- **shell 写入绕过守卫。** fs guard 是工具平面上的策略围栏，不是内核边界——这与卡片 journal 已有的暴露面相同，不是本 store 引入的新问题。
- **anchor 每次读取都重新求值，只是变便宜了。** 裁决本身从不缓存，被缓存的只是它背后的解析——因此一次读取报告的永远是当下的代码树，而不是曾经的。
