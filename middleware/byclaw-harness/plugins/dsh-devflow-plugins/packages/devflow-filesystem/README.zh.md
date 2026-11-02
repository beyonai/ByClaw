# @zhchxiao123/dsh-devflow-filesystem

[English](README.md) | 中文

[`ctx.devflow`](../devflow/README.zh.md) 缝的文件系统 Service Provider。卡片存放在 `<root>/tasks/<id>/` 下——目录名为 `<seq>-<slug>`，创建后不变——包含 `card.md`（YAML frontmatter 投影 + Markdown 正文）与追加式的 `journal.jsonl`（权威历史）。一个 store 实例服务任意多个根：每个操作都经一个统一的默认值补全步骤解析其显式 root 参数（省略即配置的默认根，给定则解析为绝对路径），每卡串行化以 root + id 为 key，返回的每张卡都标明所属根。

## 读取行为

`list` 扫描 `<root>/tasks`（根目录缺失时返回空列表；非卡片目录的条目被跳过），`read` 加载单张卡片。每次加载都经 Definition 的 fold 回放 `journal.jsonl`：非法 JSON 行、畸形条目或断裂的流都会以指明文件与行号的错误使读取失败——卡片绝不被静默跳过。`card.md` frontmatter 要求 `title`；其 `stage`/`stageRevision` 字段是投影，漂移时告警并被 journal 覆盖。缺 journal 的卡片 fail loud；丢失的 `card.md` 降级为带告警的 journal-only 视图（title 归 frontmatter 所有、不可恢复），并由下一次已提交的流转重新物化。

## 写入行为

`create` 进程内串行，并越过所有活跃卡*与归档卡*分配下一个顺序号，以独占（非递归）`mkdir` 预定 `tasks/<seq>-<slug>/`；预定输给其他进程时重扫取新号，连输五次则解析为稳定的 `exists` 拒绝。journal 首条 `created` 是唯一提交点——写入失败则整个创建失败——随后写入 `card.md` 投影（frontmatter 标题、`draft`、revision 1，加 Markdown 正文；失败仅告警，即标准的投影降级）并 emit `devflow/card-created`。省略的 slug 由标题推导（小写字母数字段以连字符相接、有界，兜底为 `card`）。

请求中的 `parent` 在预定任何目录之前先按同一个根校验：该根 `tasks/` 里没有的卡拒绝 `unknown-parent`，除非它在该根的归档里（`parent-settled`，父卡已 `done` 亦然）；父卡自身带 parent 则拒绝 `nested-parent`——拆分只有一层。校验与提交都在**父卡**的进程内卡片链上执行，因此同一个 provider 实例不会让创建与一次基于当前子卡作裁决的移动交错。通过校验的边写进 `created` 条目并投影为 frontmatter 的 `parent:`；`list` 用 `filter.parent` 收窄到一张父卡的子卡。

创建之后的每一种 journal 变更——transition、产物登记与 stale claim 驱逐——都在以 `O_EXCL` 取得的卡片 `commit.lock` 下重放 journal 并追加下一条记录。transition 与 artifact 提交只在 journal 重读与追加期间持锁；stale takeover 还会在释放锁之前重读并替换 `claim.json`。transition 门禁在取锁前运行，放行的门禁决策的 `approvedBy`/`checks` 落进已提交条目的 `gate`。代写形式的产物登记（`kind` + `content`）先按 slug 语法校验 kind（否则 `invalid-kind`），随后在取锁*之前*原子写入 `tasks/<id>/artifacts/<rev>-<kind>.md`（临时文件 + rename）——因此输掉 revision 复核或取锁预算的登记只留下一个没有任何 journal 条目引用的文件：读取不可见、无害，并被同 revision 的重试覆盖。临时文件替换遇到瞬时 `EBUSY`/`EPERM` 时会在固定的内部预算内重试，以覆盖 Windows 读取者短暂占用目标路径的情况。依赖 revision 的写入者发现卡片已经移动时解析为 `revision-mismatch`；transition 与 artifact 写入者耗尽取锁预算时解析为 `write-contended`，且不追加。transition 提交后原子重写 frontmatter 投影（临时文件 + rename，保留无关字段与正文；失败仅告警）并 emit `devflow/stage-changed`。

`claim` 以 `O_EXCL` 创建 `claim.json`：第二次认领解析出当前持有者，`heartbeat()` 刷新存活标记，`release()` 幂等删除文件。stale takeover 在同一把 commit lock 内写入 `claim-expired` 并替换租约，所以并发接管最多只授予一个持有者；锁竞争让观察到的持有者保持原位。租约分配工作，`commit.lock` 保护 journal 结构。两者都是本 checkout 的进程状态，绝不提交；而 journal、卡片文件与产物必须提交——规则及实现它的 `.gitignore` 见[`.devflow` 的提交语义](../../docs/devflow.zh.md#devflow-commit-semantics)。`archive` 在 commit lock 内追加该卡的 `archived` 条目——唯一的提交点——随后把目录整体 rename 进 `archive/<YYYY-MM>/<id>/`，journal 与产物保持完整。桶取该卡在这次追加**之前**最后一条条目的月份；该条目的 `at` 没有 `YYYY-MM` 前缀时回退到当前月份：工作完成很久之后才跑的一次清扫，不该把所有卡片都堆进它运行的那个月。因为「让卡片离开看板」的是追加而不是 rename，rename 之前崩溃只会留下一张 `list` 已经忽略的卡，后续归档会把移动补完。拆分需求以族为单位归档：需求仍在看板上时，已完成的子卡陪它留下（`parent-active`）；归档该需求时会级联归档其已完成的子卡，并落进该需求的桶。比其需求活得更久的子卡单独归档。

`restore` 是它的逆操作，也是唯一会写入档案目录的路径：`restored` 追加提交后，目录移回 `tasks/`。在归档尚未 journal 化之前入档的卡片没有 `archived` 条目，其所在目录就是唯一的标记；恢复这类卡片时会在 `restored` 之前补写一条迁移用的 `archived` 条目，让条目流保持自洽。已放弃的卡片被拒绝（`abandoned`）——它仍可读取，而推翻那个决定意味着新建一张卡。

读取路径先看 `tasks/<id>`，未命中再扫 `archive/*/<id>`，因此 `read`、`history`、`holder` 对已入档的卡片同样作答。写入路径不这么做：它们只读 `tasks/`，并把「卡片已入档」变成 `archived` 拒绝码，而不是一个无信息量的文件缺失错误。`query` 按 id 升序遍历活跃集、按月份桶倒序再桶内 id 倒序遍历档案，页一满即停；其游标是本 provider 自有的 `set:month:id` 编码，非本 store 签发的游标会被拒绝，而不是悄悄退回第一页。

## 配置

```yaml
- id: devflow
  name: '@zhchxiao123/dsh-devflow-filesystem'
  config:
    root: .devflow
```

| 键 | 默认值 | 含义 |
|---|---|---|
| `root` | `.devflow` | 默认 devflow 根，供调用方推导不出自己的根的操作使用；相对路径按进程 cwd 解析。 |

## Model Experience

Indirectly, through the model-facing tools in dsh-tool-devflow: the store backend registers no prompt or schema.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **遗留的 commit lock 会 fail closed** — 仅凭 mtime 不能证明所有权，否则 stale checker 可能删掉后继者刚取得的锁。进程在持有 `commit.lock` 时死亡后，写入会解析为 contended，直到操作者确认没有活跃写入者并删除该卡片的锁文件。
- **stale takeover 跨两个文件时先写审计记录** — `claim-expired` 先提交，随后才替换 `claim.json`。进程若在两次写入之间崩溃，旧租约会与真实的驱逐记录并存；后续 takeover 可重试并追加下一个 revision，但文件系统无法把两个文件作为一个操作原子替换。
- **接管信任本地时钟** — 过期判断用租约心跳与 `Date.now()` 比较，共享同一工作区的机器间时钟严重偏差可能过早或过晚驱逐活跃持有者。
- **跨进程同瞬建卡可能共用顺序号** — 独占 `mkdir` 守护的是完整的 `<seq>-<slug>` 目录名，两个*进程*同一瞬间以不同 slug 建卡时可能各保留同一个号；id 仍然唯一，进程内创建者已串行。
- **无变更监听** — 读取按需进行；其他进程移动的卡片要等下一次读取才被看到，不会被推送。
