# Agent Note: The Midscene operation lock leaves the committed tree

Status: implemented

## Problem

`withProjectMutation`的跨进程锁原先写在 `.devflow/midscene/operation.lock`，位于 Devflow 提交并随分支在机器之间流转的子树内。该文件保存的是取锁主机的 `{ pid, startedAt }`，这些内容在别处没有意义。一旦提交，它会到达另一个检出，使 `midscene_project` 报出 `MIDSCENE_PROJECT_BUSY`，并把用户指向一个在该机器上从未存在的进程；两条分支各自改过设置时，这一个路径还会在合并时冲突。

## Decision

锁改为该工作目录私有运行态根目录下的 `operation.lock`，即 `$DSH_HOME/midscene/projects/<sha256(规范化工作目录)>`。设置变更不再在 `.devflow` 下创建或删除任何文件。

`projectOutput` 移入 `src/runtime-root.ts`。`project-runtime.ts` 与 `project-settings.ts` 都从该文件导入，且 `project-runtime.ts` 继续对外再导出，使已有导入方保持同一个名字。方向是关键：`project-runtime.ts` 为读取设置而导入 `project-settings.ts`，持锁方不能反向导入运行态模块。

迁移保留了锁原有的全部性质：`O_EXCL` 独占创建、逐段拒绝符号链接、open 之后复核 dev/ino、成功与失败路径都释放锁。它还获得了运行态根目录本就执行的检查——`0700` 目录权限、存储必须位于项目之外、拒绝别名根目录——并去掉了仅为建出 `.devflow/midscene` 而存在的两次 `mkdir`。`MIDSCENE_PROJECT_BUSY` 指向新路径，因为这条消息的用途就是把人带到确切的那个文件。

`writeProjectFile` 的 `.devflow/` 守卫未改动。锁从不经过它——锁自己以 `wx` 打开句柄——因此本次改动没有打开任何 `.devflow` 之外的写入路径。设置、验收策略与套件属于部署选择，应当留在仓库中，位置不变。

## Alternatives considered

**把 `projectOutput` 放进 `identity.ts`。** 该模块已有 `projectOutput` 仅需的 `sha256` 与 `within`，还能省下一个文件。但它讲的是给工作区内容算指纹，定位私有存储是另一件事，合并会让两者都更难命名。

**给 `withProjectMutation` 增加 root 参数。** 那样每个调用方都在决定锁放在哪里，而这正是该函数存在所要守住的不变量。

**自动删除旧路径下的残留锁。** 旧文件可能已被 git 追踪，静默删除用户受版本控制的文件，比留下一个无人读取的文件更糟；它还落在 `devflow-fs-guard` 保护的子树内，该线一贯认为这棵树只有一条写路径。改由 README 与验收 Skill 资产说明它是历史遗留、可以手工删除。

## Consequences

一次设置变更不再触碰仓库工作树，`packages/devflow-midscene/tests/project.spec.ts` 守住这一点：它比较变更前后 `.devflow` 的文件集合，并观察锁在私有运行态根目录下出现和消失。

恢复操作现在发生在私有目录中。锁不再出现在 `git status` 里，因此 README 与 `assets/devflow-midscene-acceptance.md` 给出了需要查看的路径。

同一工作目录上同时运行两个 devflow-midscene 版本时，两者互不排斥：旧版本持旧路径，新版本持新路径。这个窗口很窄且已被接受；同时取两把锁的兼容层会让被提交的文件继续存在，而那正是缺陷本身。

姊妹改动把 `.devflow/midscene/operation.lock` 写入规范 ignore 清单，这一行作为兜底保留。相对本次代码它是冗余的，代价是一行；若两处改动之一被单独回滚，缺少它的代价是进程状态进入 git。
