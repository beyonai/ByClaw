# Agent Note: 铁律移植进 devflow 线

Status: implemented

## Problem

devflow 的 `spec-delta` 分诊把一张卡产出的知识分成 `reference`（该知道、按需读）与 `obligation`（不遵守就是错）。reference 有归宿——spec 缝的索引文档；obligation 在这条线里没有。把它转发给 `@byclaw/dsh-iron-rules` 的计划在查证后不成立：那个插件**不发布任何 cordis 服务**（唯一可达面是 `record_iron_rule` 的工具注册），`"private": true`，且属于另一个仓库——而本线的规矩禁止依赖未发布面、禁止跨插件值导入。硬编码另一个插件的工具名、或者伪造一次模型从未发起的工具调用，同样不可接受。

## Decision

`@zhchxiao123/dsh-devflow-iron-rules` 把铁律插件在本线内重新实现为一个单包函数插件——`devflow-fs-guard`、`devflow-agent-gate` 已有的策略插件形态，不建 Definition/Provider/Consumer 三件套。词汇与四个机制（以数据 digest 为键的全文常驻、带续轮上限的脏 turn 校验强制、必填的 `script | judgement` 分诊、`replaces` 加净变化预算与 watch 衰减检测）刻意重述原实现；模块文档写明语义分叉是本包缺陷。移植改了四件事：

- **根解析用 devflow 的，不用 git 的。** 规则住在 `<session cwd>/.devflow/iron-rules`（配置的 `root` 作无 cwd 回退），不在最近的 git 祖先之下——规则、卡片、spec 文档共用一个 `.devflow/`，fs guard 按段名的围栏无需额外配置就覆盖规则目录。校验脚本随之在会话工作区根运行；guard 的拒绝消息加了第三个分支，把规则路径指向 `devflow_record_iron_rule`。
- **写入路径同时是服务。** `ctx.provide('devflowIronRules', { record })` 发布的就是工具调用的那个 `recordRule`——一条写入路径两个名字——于是 `spec-delta` 的 obligation 变成一次转发调用，而不是指望模型记得去调。
- **记录工具描述使用简洁中文**，依据[平台描述决策](../bug-fix/2026-10-13-concise-provider-tool-descriptions.md)；其余模型侧字符串保留英文；记录工具叫 `devflow_record_iron_rule`，消息源 kind 是 `devflow-iron-rules`，既贴合本线命名，也与原件的注册保持区分。
- **删掉 reserved 的 `requireApproval` 配置字段。** 它没有消费者；它背后的推理（脚本信任边界等于仓库写权限——这里再加上工具平面，因为 fs guard 对文件工具拒绝了该目录）以散文形式进 README，而不是留一个死开关。

`/iron-rule` 命令及其两个渲染辅助函数不移植：工具是能力本体，命令是便利面，推迟到需要时再补。

## Alternatives considered

**把原包整个搬过来。** 否决。那会把一个私有包的身份问题发布进 npm，让 1448 行零测试的代码一步闯进每文件 100% 的线而没有任何行为收益，且在跨仓库删除落地之前留下两份都在维护的副本。移植付出同样的测试成本，但从一开始就拥有自己的命名、根语义与语言。

**在 devflow 核心声明一条 obligation 缝，由 `@byclaw/dsh-iron-rules` 实现。** 否决。Provider 会住在一个本线不控制、也不从中发布的仓库里，任何从 npm 安装的人永远组合不出这条缝唯一的真实实现——Provider 角色不可达的能力缝不是完整的缝。

**引用而非调用**——`spec-delta` 的行携带模型调完另一个插件的工具后填回的 `.iron-rules/` 回执 id。不写任何新代码就能用，也曾是本次移植之前的既定设计；移植成为选项后否决，因为回执是无法验证的散文，两步流程可能在两步之间静默丢掉义务。

## Consequences

买到的：obligation 经一条有审计的写入路径记录，写前完成全部校验，在记录会话里立即常驻，turn 收尾无需模型配合即被强制，并作为可选服务供其他插件触达。规则目录的围栏比原件更好（`.devflow/` 的 guard 覆盖）。

代价：在 `byclaw-harness` 还带着第一份的时候，铁律存在第二份实现，且没有任何东西检测共存——README 里那句「只挂一个」就是删除原件之前的全部保护。词汇一致性承诺把本包绑在原件的语义上；有意分叉需要同时更新 `types.ts` 里的承诺与本 Note。

## Related

消费侧的分诊设计在 spec-update 卡的设计记录里（`.trellis/tasks/09-02-devflow-spec-update/design.md`，不在本仓库历史内）；其「引用而非调用」的结论被本次移植取代，需回改为经 `ctx.get('devflowIronRules')` 转发。
