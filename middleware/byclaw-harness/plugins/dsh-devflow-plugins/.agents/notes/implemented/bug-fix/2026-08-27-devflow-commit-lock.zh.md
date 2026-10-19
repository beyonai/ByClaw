# Agent Note:devflow —— 检查与追加落在同一把锁里

Status: implemented

[English](2026-08-27-devflow-commit-lock.md) | 中文

## Problem

一次转移做的每一项检查 —— revision 的比较并交换、边的合法性、返工理由 —— 都是针对 `commitTransition` 开头读到的卡片求值的,而依据这些检查执行的追加发生在 `devflow/transition` 波布**之后**。那道波布正是部署的门禁命令运行的地方。配了 `'developing->reviewing': ['pnpm run test']` 的部署,"revision 3 是当前值"与"写入 revision 4"之间的距离,就是测试套件的执行时长。

`serialized()` 在单个 provider 实例内部关上了这个窗口。它对跨实例毫无作用,而两个进程共用一个 root 是再普通不过的情形:一个 harness 加一次 `/devflow` 调用、两个 harness、一个与 CI 共享的检出。两者都读到 revision 3,都通过全部检查,都追加 revision 4。

结果不是"更新丢失"。`foldJournal` 要求 revision 连续,也要求每条转移从上一条到达的位置出发,所以第二次追加让 journal **结构性非法** —— 而 store 的读路径是刻意 fail-loud 的。卡片就此永久不可读,而 journal 是权威,别的东西也救不回来。**一张卡的完整历史,恰恰是这套设计承诺要保住的唯一一样东西。**

同一个缺口还独立地破坏合法性:在门禁执行期间被打成 `blocked` 的卡片,照样会收到门禁批准的那次移动,写下的 `from` 是卡片已经不在的位置。

## Decision

**提交锁只包住单个写入者最终的提交工作,不覆盖此前的步骤。** `committingJournal()` 以 `O_EXCL` 创建卡片目录下的 `commit.lock`,给每个 journal 写入者一份已落定的 fold 与追加下一条记录的操作。transition 与 artifact 写入者只在这段 journal 工作期间持锁,且只有在 revision 仍等于此前检查所依据的值时才追加。revision 未变即证明那些检查仍然成立 —— 因为卡片的位置只随它的 revision 移动。stale claim takeover 还会重读 `claim.json`,从落定的 revision 构造 `claim-expired`,并在释放同一把锁之前替换租约,所以两次并发接管不可能同时成功。journal 是权威,因此 takeover 先记录驱逐再替换租约;若进程在两次文件写入之间崩溃,旧租约仍在,但驱逐记录可供审计,后续 takeover 可以重试。

这把锁**刻意不覆盖**调用方自己的检查与波布。门禁命令要跑几分钟;横跨它们持锁,会让无关的提交排在一个测试套件后面,也会把每一次门禁崩溃变成一张卡死。

依赖 revision 的调用方输掉竞争时拿到 `revision-mismatch` —— 它本来就要处理的 code,消息点明是门禁期间卡片被移走。始终拿不到锁的 transition 或 artifact 调用方拿到 `write-contended`:什么都没写,原样重试即可。竞争失败的 stale takeover 让观察到的持有者保持原位。

## Alternatives considered

- **要求调用方持有卡片租约。** 调查否掉了它:在所有写路径中,只有 `devflow_take` 和 driver 会认领。`/devflow move`、普通的 `devflow_transition`、以及全部 `attachArtifact` 都不认领,所以这条规则要么只能告警 —— 损坏通道照旧敞开 —— 要么打断五个调用方里的三个。更糟的是,driver 以 `{kind:'command'}` 持租约,而实际写入的子代理是 `{kind:'agent'}`,身份比对会拒绝掉唯一一个正确使用租约的消费者。
- **先追加,再校验并回滚。** journal 是只追加的;截断式回滚把这条性质丢掉了,而且 `foldJournal` 照样会看见中间态。
- **不加锁,只重新校验。** 窗口从分钟压到微秒,但没有关上,而漏过去的是不可恢复的数据损坏,不是一次重试。
- **超过 mtime 阈值就打破锁。** 被否决,因为 stale 检查与按路径删除不是原子的。如果旧 owner 在两者之间释放、后继者取得锁,checker 会删掉后继者的活锁,放进两个写入者。

重试预算是固定常量而非 `Config` 字段。它约束的是一读一追加的内部临界区;部署方在这里没有可调的东西。

## Consequences

`TransitionRejectionCode` 与 `ArtifactResult` 的 code 联合各自新增 `write-contended`。本线中没有任何消费者对二者做穷尽 switch,因此这项新增是兼容的;做穷尽 switch 的消费者需要补一个分支。

同一张卡上的并发提交现在跨进程串行化,而不再损坏。这包括 `claim-expired`:claim 获取不是 transition,但它仍然是 journal 变更。**不同**卡片上的提交不受影响 —— 锁是按卡片目录的,与 `serialized()` 的 root + id 键一致。

在取锁与释放之间被杀死的进程会留下锁文件。store 不会仅凭年龄删除它,因为年龄无法证明所有权;写入会 fail closed 为 contention,直到操作者确认没有活跃写入者并移除该锁。这用自动崩溃恢复换取不会删除后继者锁的互斥。

`transition-contention.spec.ts` 像门禁一样把波布按住,从第二个实例提交,并断言第一次提交被拒绝、卡片仍然可读。它还让两次 stale takeover 竞争,要求只授予一个 holder、只追加一个 `claim-expired` revision。`commit-lock.spec.ts` 要求旧锁保持 contended,而不是在无法证明所有权时被删除。
