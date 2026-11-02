# @zhchxiao123/dsh-devflow-artifact-gate

[English](README.md) | 中文

[`devflow/transition`](../devflow/README.zh.md) 瀑布上的产物契约策略：配置的边要求已登记的产物 kind，且每个必备 kind 的最新一份登记必须通过机械结构检查——配置的 frontmatter 字段齐备、配置的 `## ` 章节标题存在。本插件是 `ctx.devflow` 缝上的只读 Consumer；不写任何东西、只裁决一条瀑布，同时发布供生产者使用的 kind 规格与动态检查契约，让模型侧工具能在尝试流转前报告完全相同的判定。

## 行为

对带有 `edges` 表项的 `from->to` 边上的尝试，门禁读取移动中的卡片，逐个检查必备 kind 的最新一份登记——journal revision 最大的那条，即 `devflow_attach_artifact` 的 kind + content 形式所写；纯路径登记不带 kind，永不匹配。kind 没有任何登记、登记的文件磁盘上读不到、缺 frontmatter 块或字段、缺章节，各计一条缺陷，否决理由**一次性**全部列出（`<kind>: <what>`，点名文件），让一轮返工看到全部差距，而不是每次尝试挤出一条。同 kind 的旧登记是历史而非证据：最新一份结构完整就放行，无论它的前身长什么样。

没有 `edges` 表项的边不读卡片直接委派；全部检查通过的卡片原样委派——后续策略（命令门禁、审批）如同本插件不存在一样裁决。否决不是提交：卡片停在原处、revision 不变、不产生 journal 条目。

检查只做结构：字段存在且有值、章节标题以 `## <title>` 行存在（允许尾随空白）。标题下面的内容好不好，是另一层的问题。

## Config

```yaml
- id: devflow-artifact-gate
  name: '@zhchxiao123/dsh-devflow-artifact-gate'
  config:
    kinds:
      prd:
        frontmatter: [card, kind, title]
      design:
        frontmatter: [card, kind, title]
        sections: [Approach, Compatibility]
    edges:
      'draft->designing': [prd]
      'designing->ready': [prd, design]
```

| 键 | 默认 | 含义 |
|---|---|---|
| `kinds` | `{}` | 按产物 kind 的结构规格：`frontmatter` 是必须存在且有值的字段，`sections` 是必须出现的标题（不含 `## `），`nonEmptySections` 是必须出现**且在下一个标题之前至少有一个非空行**的标题。列进 `nonEmptySections` 即蕴含存在性，无需再列进 `sections`。列表均可省略；空列表等于省略，全都没有的 kind 只要求被登记。 |
| `edges` | `{}` | 每条 `from->to` 边必备的产物 kind。没有表项——或列表为空——的边不设门禁。 |

配置错误加载即失败，并点名配置项：边键不是 `<from>-><to>` 已知位置名的形式（`blocked` 两端皆合法——恢复边也可以有契约）、边引用了 `kinds` 未声明的 kind、kind 键不符合缝的 kind 语法（小写字母数字与连字符、字母数字开头）、`frontmatter`/`sections`/`nonEmptySections` 列表里有空白条目。

没有边引用的 kind 合法：它纯粹作为发布的规格存在，服务于有模板但不设门禁的交付物。

## Cookbook

下面每段片段都是独立的 `kinds:`/`edges:` 配对，形状同 [Config](#config) 示例一致——整段换成你的 `config:` 块即可，不要和上面的示例或彼此拼在一起：有几段为了各自单独演示一种行为，复用了同一个 kind/边名（`prd`、`design`、`developing->reviewing`）但结构不同，而 YAML 同一个映射里不允许出现重复键。

### 只要求 frontmatter

```yaml
kinds:
  changelog:
    frontmatter: [card, version]
edges:
  'developing->reviewing': [changelog]
```

`changelog` 的登记只要 frontmatter 里 `card`、`version` 两个字段都存在且非 null 就通过；不检查任何章节标题。

### 只要求 sections（标题存在即可，不看内容）

```yaml
kinds:
  review:
    sections: [Findings, Verdict]
edges:
  'reviewing->testing': [review]
```

`review` 的登记只要 `## Findings`、`## Verdict` 两个标题都出现就通过——标题下面写了什么不检查。

### `nonEmptySections`（标题加真实内容）

```yaml
kinds:
  test-report:
    nonEmptySections: [Results]
edges:
  'testing->done': [test-report]
```

`test-report` 的登记必须有 `## Results` 标题，且在下一个标题之前至少有一行非空内容；标题下面空空如也就不通过。这里列了 `Results` 就已经蕴含它的存在性要求，不用再列进 `sections`。

### 只要求登记的 kind（既无 frontmatter 也无 sections）

```yaml
kinds:
  screenshot: {}
edges:
  'developing->reviewing': [screenshot]
```

既没配 `frontmatter` 也没配 `sections`/`nonEmptySections` 的 kind，只要求该 kind 有过一次登记；登记的内容是什么都行。

### 一条边要求多个 kind

```yaml
kinds:
  prd:
    frontmatter: [card]
  design:
    frontmatter: [card]
edges:
  'ready->developing': [prd, design]
```

`ready->developing` 要等 `prd` 和 `design` 各自都有一份通过检查的最新登记才放行——一条边列出的每个 kind 都是必备项，不是任选其一。

### 没被任何边引用的 kind

```yaml
kinds:
  postmortem:
    sections: [Summary]
edges: {}
```

`postmortem` 会通过 `devflowArtifactStructures` 发布给生产者，但不设门禁，因为没有任何 `edges` 表项点它的名字——服务于有模板但不需要强制的交付物。

### 富内容产物（截图、大文件或二进制载荷）

真实载荷装不进这套纯文本结构模型的 kind，请参见 `docs/devflow.zh.md`（"富内容产物:指针 + 分离文件"一节）里的指针 + 分离文件模式，这里不重复——它的门禁配置就是上面这种普通的 `nonEmptySections` kind，模式本身讲的是配合它的那两次 `attachArtifact` 登记。

配置错误加载即失败，并点名出错的配置项，不会悄悄放过——边键格式不对、边引用了未声明的 kind、`frontmatter`/`sections`/`nonEmptySections` 列表里有空白条目，都会中止启动，所以加载失败就意味着配置写错了，而不是运行时有什么反直觉的行为。

## kind 规格服务

校验后的 `kinds`——规范化（空列表丢弃）并深冻结——以可选服务 `devflowArtifactStructures` 发布。生产者用 `ctx.get('devflowArtifactStructures')` 读取，把同一份字段与章节列表喂给写交付物的环节，模板与检查便不会漂移；服务随插件 fiber 一起消失。类型（`ArtifactKindStructure`、`ArtifactStructures`）导出供 type-only 引用。

## 契约检查服务

可选服务 `devflowArtifactContract` 只暴露一个只读操作 `inspectOutgoing(card)`。它返回当前卡片所有已配置且合法的出边，把每个必备 kind 标为 `missing`、`malformed` 或 `satisfied`，并带上不可变的 kind 规格、存在时的最新登记以及全部缺陷。transition listener 与该检查调用同一个内部 requirement checker，因此预检列出的缺陷就是真实 transition 否决会使用的缺陷。

检查是所传卡片 revision 上的结构快照；不运行语义 agent 检查、不写文件、也不预留流转。检查后卡片若发生变化，仍由既有的 `stageRevision` CAS 契约裁决。服务随插件 fiber 一起消失。

## Model Experience

本包自己不注册 prompt 或 schema。挂载 `dsh-devflow-tool` 时，单卡生命周期结果会消费 `devflowArtifactContract`，向模型展示适用出边、每项要求的状态与模板、全部缺陷，以及仍有未满足项时不得流转的明确提示。模型因此能先撰写并重新登记交付物，不必把拒绝路径当作需求发现机制。

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **瀑布顺序就是部署加载顺序**——这一机械层应排在更慢的层（命令门禁、审批、任何 agent 检查）之前，让缺产物在跑测试套件或打扰人之前就被否决。没有什么强制这个顺序；靠部署的行序。
- **只查结构，不查语义**——存在的字段可能装着胡话，存在的章节可能空洞无物；评判内容是另外的（agent 侧）一层，不是这里。
- **契约只看 journal 登记过的 kind**——绕过 `attachArtifact` 的 kind + content 形式直接写进卡片目录的交付物，对本门禁不存在，这是有意的：journal 是"交付了什么"的权威。
