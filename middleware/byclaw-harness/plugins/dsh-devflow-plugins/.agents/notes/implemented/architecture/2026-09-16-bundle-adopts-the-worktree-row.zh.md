# Agent Note: 一个包只挂载一次——bundle 收编 worktree 行

Status: implemented

[English](2026-09-16-bundle-adopts-the-worktree-row.md) | 中文

## Problem

「bundle 装好了」与「这条线真的能挡住人」之间隔着两个缺口，而着手补第一个的过程里，又翻出了第三个早已潜伏在那里的问题。

**装配。** `devflow-bundle` 把四道策略行都挂成 `disabled: true`，各自的理由都成立：空规格集本来就 gate 不了任何东西。而能让它们开始裁决的那份配置只存在于 `docs/devflow.md` 里，作为散文当中的一个 YAML 块。`examples/` 下只有一个探针脚本。于是这条线的全部约束力，取决于部署方愿不愿意从文档里手抄一份样例——而同一份契约写在两处，正是这个仓库反复发现的漂移源头。

**可发现性。** `devflow-worktree` 不在 bundle 内。一个无法通过所有人都在用的那条安装命令装上的能力，就是绝大多数部署永远不会知道它存在的能力；而 worktree-per-card 恰恰是 `devflow-review-gate` 自陈的那条已知限制的答案。

**潜伏的那个。** 有四个包——`devflow-bundle`、`devflow-deploy`、`devflow-midscene`、`devflow-testenv`，当时还有 `devflow-worktree`——各自携带一份声明 `dsh.bundle` 的 `cordis.patch.yml`。这件事之所以一直安全，纯属巧合：那四个独立包没有一个是 bundle 的依赖，所以从来没有哪个 profile 同时应用过两个插入同一行 id 的 layer。没有任何东西强制这个巧合，也没有任何测试碰过它。

## 收编一个包本会带上的失败模式

`@deepseek-ai/cordis-plugin-include` 的 `applyEntryPatches` 对未寻址的 patch 是无条件追加的——`data.push(...insert)`，完全不按 id 去重。而 harness 的 `dsh plugin add`（`apps/cli/src/plugin.ts` 的 `reconcilePlugins`）会把 profile 每一个声明了 `dsh.bundle` 的**直接**依赖追加进 `dsh.profile.bundles`，`loadProfile` 再按顺序应用这些 layer。

于是，一个同时持有 `@zhchxiao123/dsh-devflow-bundle` 和某个也给自己打 patch 的包的 profile，会组合出同一个 id 的两行，而 Loader 拒绝整份组合：

```js
if (seen.has(id)) throw new TypeError(`duplicate loader entry id: ${id}`);
```

两次各自都能用的安装，合起来是一个再也起不来的 profile。对这个仓库而言这并非假设：`e2e/.state/home/profiles/devflow-e2e/package.json` 的 `dsh.profile.bundles` 里已经和 bundle 并列写着 `@zhchxiao123/dsh-devflow-testenv`。

## Decision

**一个包要么由 bundle 挂载、要么自带 `cordis.patch.yml`，不能两者兼有。** 把一个包收编进挂载清单，就意味着在同一次改动里删掉它的 patch 与 `dsh.bundle` manifest 键。这条规则本来就成立却完全没有强制；`tests/bundle-row-ids.spec.ts` 现在把每一份 `packages/*/cordis.patch.yml` 喂给真实的 `applyEntryPatches`，失败时点名冲突的 id 与两个携带者。

**`devflow-worktree` 进入 bundle，并交出自己的 patch。** 它的 bundled skill 从头到尾讲的是一张 devflow 卡的仪式，围栏读的是卡片 store，所以一个不带看板却挂载它的 profile 得到的是一份没有看板的 runbook 和一道由构造决定为惰性的围栏——独立路径没有当前拥有者，这正是「删掉它是移除不可用的表面，而不是移除一项能力」的依据。`dsh plugin add @zhchxiao123/dsh-devflow-worktree` 现在只装出一个不挂载任何东西的普通依赖，两种语言的 README 都把这件事写成一次移除，而不是留给人去发现。

**`devflow-testenv` 不收编。** 收编判据到这里不再只是挂载成本。它的挂载成本是整条线里最低的——一个 bundled skill，无工具，无配置——单按这一条它本该进来。但它的 runbook 讲的是搭起一套 e2e 环境，从不提到任何一张卡，所以一个永远不挂看板的 profile 依然想要它。收编它等于用删掉一条能用的路径去换可发现性，而本批次要回答的 review-gate 交叉污染问题从来不需要它。

**`devflow-midscene` 与 `devflow-deploy` 仍按挂载成本留在外面**，未变：midscene 需要 Node 24、Playwright、chromium 与视觉模型端点，没有一样是这里装得出来的；deploy 的 `host` / `remoteWebRoot` / `remoteReleasesRoot` / `baseUrl` 无可回退默认值，所以它自己的 patch 就把行挂成 `disabled: true`。

**worktree 行在挂载清单里的位置，是与「是否启用」分开的一项决策。** 它的 fence 注册在 `devflow/transition` 上，挂载顺序即裁决顺序，因此这一行排在 `devflow-guidance` 之后、四道策略行之前：当这张卡正被一个无权写它的 checkout 写时，先跑结构检查、checker 或测试套件，都是在一次无论如何不会被接纳的移动上花钱。patch 注释写明了这一点，否则下一个调整 bundle 顺序的人会在毫无察觉的情况下把它反过来。

**流水线配置现在只存在于一个文件里。** `examples/full-pipeline/cordis.patch.yml` 是一份 profile patch：启用并配置 bundle 默认禁用的每一行，定义 `worktree` 这个派遣 kind 使结构检查在 fence 之前就看见一份半成品派遣记录，并把 fence 的 `artifactKind` 钉在同一个 kind 上。`docs/devflow.md` 保留论证——加载序就是 waterfall、profile patch 在行原处配置、审批为何刻意缺席、agent 才是生产者——不再复述任何一项设置。

**派遣仪式由组合测试覆盖，而不是由一个 e2e runner。** `tests/worktree-dispatch-composition.spec.ts` 在一个真实 git 仓库与一个真实 linked worktree 上启动两套真实 Loader 组合。它存在的理由是最后那条断言：在分支合并回一个期间自己也向前走过的主 checkout 之后，合并后的 `journal.jsonl` 能解码、`foldJournal` 能重放、revision 是连续的 1..n、两侧条目都在，而且派遣这张卡的那个 session 能从 worktree 停下的地方继续推进它。第二条用例断言在 worktree 里铸出的卡会与主板铸出的卡撞号——断言的是**会撞**，不是有什么东西挡住了它。

`e2e/README.md` 现在写明了两边各管哪一半：不需要活 harness 的部分全部搬进了 `tests/`，留在那里的需要一个浏览器和一个真在服务的 GUI。它同时记下 `e2e/.state/` 是某一次本机人工跑的残留，不是夹具。

## 示例与测试不共用文件

组合测试建自己的最小形态，从不读示例。示例面对的是抄它的人，会为可读性而改；夹具面对的是机器，会为「能判定问题的最小形态」而改。绑在一起，两边都会被对方拖着走——而既有的先例本来就是这样：`docs/devflow.md` 说的是产物契约的 spec 启动同一个组合*形态*，不是同一个文件。

## Alternatives considered

- **同时收编 `devflow-worktree` 与 `devflow-testenv`，以追加方式进行，保留它们的 patch。** 这本来就是原计划，而它就是上面那个缺陷：它会让一种已被记录的配置拒绝启动。按证据否决，不是按口味。
- **两个都收编，两份 patch 都删。** 仅就 testenv 否决：它的独立路径有真实用户，而「挂载成本为零」是收编一个包的理由，永远不是移除它今天安装方式的理由。
- **给 bundle 的行换一套不同的 id，让两个 layer 共存。** 否决：插件会挂载两次——两道围栏、两个 skill provider——而且这违反这份 patch 自己声明的契约：profile 通过寻址同一个 id 覆盖某一行。
- **什么都不改，把这个风险写进文档。** 否决：这个风险是拒绝启动，而它违反的规则是机械的。一份要靠人在添加依赖那一刻想起来的文档，是这项检查可能采取的最弱形式。
- **为派遣仪式造一个 e2e runner。** 否决：整套仪式就是 git 加 store 加一个 waterfall 监听器，全部可在进程内驱动。真需要活 harness 的东西才配得上 runner，而那正是 `e2e/README.md` 留下的部分。
- **把仪式写进 `e2e/README.md` 当作又一条人工流程。** 否决：人工流程不会在 CI 里跑，等于回到「从未被跑过」——也就是引出这项工作的那条发现。
- **把 YAML 留在 `docs/devflow.md`，再在旁边加一份示例。** 否决，而且这是这里最容易犯的错：同一契约两处书写正是本次改动要去掉的缺陷。文档保留的是论证，而论证没有第二个归宿。
- **让测试 import 示例。** 否决，理由见上。

## Consequences

- **每个既有部署的默认组成在升级时都会变。** 它们会多出一条 catalog 行与一个 transition 监听器。该监听器对所有不带派遣产物的卡是惰性的，skill 是按需加载的 catalog 条目，所以这个增量在一次小版本升级可以做的范围内——但它确实改变了默认装上的东西，不想要的部署从自己的 profile patch 里禁掉这一行。
- **此前独立安装过 `devflow-worktree` 的 profile 仍然能用，并且不再特殊。** 包依然解析得到，行依然挂载，只是改由 bundle 挂载；变的是 profile 自己 `dsh.profile.bundles` 里那个条目现在指向一个不带 `dsh.bundle` 的包，`reconcilePlugins` 会在下一次 `dsh plugin add` 时把它删掉。一个之后再也不跑 `dsh plugin add` 的 profile 会留着一个过期条目，`loadProfile` 以 `declares no dsh.bundle` 拒绝它——是大声的那种失败而不是无声的那种，README 写了该怎么办。
- **`devflow-worktree` 现在有两处必须一致的配置**：fence 的 `artifactKind` 与 artifact gate 的对应 `kinds` 条目。示例把两处都显式写出正是为此；一个 gate 从未定义过的 kind，会让 fence 去解析没有任何东西塑形过的记录。
- **这条 XOR 规则对将来每一次收编都生效**，不止这一次。`tests/bundle-row-ids.spec.ts` 同时钉住了仍然携带 patch 的包清单，因此一个携带者的加入或退出是一次带理由的显式改动，而不是一次无声漂移。
- **这趟 git 往返被验证了，而且成立。** 合并后的 journal 折得出来，这正是整个 worktree 拓扑所依赖的前提。反例由构造钉住：两侧各自追加根本合不上，所以 fence 强制的那条规则是看板自身持久化模型的前提，而不是叠在它上面的一条策略。
- **跨 worktree 边界的卡号冲突，现在是一条可见、被断言的行为**，而不再是 runbook 里的一行散文。没有任何机制阻止它，测试如实这么说——将来有人想修它，起点就在这里。
- **`pnpm run preflight:tarballs` 是这些 manifest 改动的关口。** bundle 没有新增文件，多了一条 `workspace:^`；`devflow-worktree` 的 tarball 从 `files` 里少了 `cordis.patch.yml`，而 `dsh.bundle` 键既然已经移除，preflight 的「声明了 bundle patch 但 tarball 里没有」那条检查对它不再适用。
