# @zhchxiao123/dsh-devflow-iron-rules

[English](README.md) | 中文

**仓库携带的铁律**：工作区把有约束力的开发规则记录为 `.devflow/iron-rules/<id>/` 目录，每个目录一份 `RULE.md` 正文，可机检的规则另带一份 `check.sh`。规则正文常驻模型上下文；碰过文件的 turn 将要结束时，每条规则的校验脚本都会运行，失败以强制续轮的形式顶回模型。没有规则目录的工作区里本插件完全惰性。

这个形状刻意与 devflow 的 `specRefs` 索引相反，两者并不冲突：索引适合模型在相关时才去取用的能力——架构文档，经 `devflow_read_spec` 按需读；而规则是**义务**，模型从未打开的义务就是从未遵守的义务。两者之间的分诊正是 `spec-delta` 分类所决定的：`reference` 去[spec 缝](../devflow-spec/README.zh.md)，`obligation` 来这里。

规则词汇重述自本包的移植来源 `@byclaw/dsh-iron-rules`；与它的语义分叉是本包的缺陷。一处明说的行为差异：移植来源在 turn-stopping 窗口内部发送放弃与僵尸通知，在钉住的 harness 上这要多付一个续轮 step；本包则在下一个 turn 开启时投递——这正是通知一直声称的时机。**不要把两者挂进同一个 profile**——规则会被注入两遍、校验跑两遍、续轮计数各算各的。

## 契约

四个机制，缺任何一个本包都不成其为自己：

1. **常驻。** 每次 `agent/pre-step` 检查当前规则集——以数据而非渲染的 digest 标识——是否仍在会话的可见面上，不在就把完整规则块追加进去：首个 step、规则变更后、compaction 遮蔽之后。规则全文注入而非目录化。`admin` 所有的规则排在最前、标为不可协商；记录写死 `owner: local`——admin 规则的效力来自 code review，从聊天轮次里铸造一条恰恰跳过了赋予它效力的那次 review。
2. **强制。** 一次成功的一方 `write`/`edit` 把 turn 标脏；脏 turn 将要结束时每条规则的 `check.sh` 运行（经 `bash`，在会话工作区根）。失败以强制续轮返回，点名每条规则、它的输出与规则路径，连续最多 `maxRetries` 次——之后插件明说强制已停止并把决定交还，而不是悄悄放弃。放弃不多花一个 step：在钉住的 harness 上，任何从 turn-stopping 窗口内部发出的消息——inject 与 steer 无异——都会强制多一个续轮 step（[`devflow-spec-sentinel` 的组合注意事项](../devflow-spec-sentinel/README.zh.md#组合注意事项)约束该插件的同一条实测契约），所以插件把放弃通知记下来，在该 agent 的下一个 turn 开启时注入；一个再也不开启 turn 的会话就此结束，决定权已经交还，通知随 agent 一起被回收。完全跑不起来的校验按通过处理并记日志（坏检查不能卡住每个人的每一轮）；但**被杀死**的校验——超时或信号——没有产生裁决，按违规处理。
3. **陈述即分诊。** `devflow_record_iron_rule({ id, title, body, enforcement, check?, watches?, replaces? })` 要求 `enforcement: 'script' | 'judgement'` 必填——`script` **必须**带 `check` 与 `watches`，`judgement` 禁止带 `check`。跳过「脚本能不能判定」这个问题，是规则集退化成纯散文的默认路径。记录在第一次写之前完成全部校验（被拒绝的请求让规则集保持原样），然后立即把新规则注入当前上下文——等下个会话会让它在本会话剩余时间里不生效。
4. **能收缩、会衰减。** `replaces` 在新规则写入之后删除被点名的规则：一个 id 是原地修订，多个是聚类合并——规则集唯一会缩小的途径。字节预算（`maxBytes`）按**净**变化计费，缓解压力的合并绝不会被当作纯新增拒绝。反过来，`watches` 路径**全部**消失的通过会在下一个 turn 开启时被报告为不可能再失败的通过——僵尸通过读起来像合规，实际什么也不值；部分消失只记日志，把普通的目录搬迁报成腐烂会训练所有人忽略这个信号。

规则根与其他所有 devflow 根同一套解析：`<session cwd>/.devflow/iron-rules`，回退到配置的 `root`——**不是**最近的 git 祖先，因此规则、卡片、spec 文档永远共用一个 `.devflow/`。校验脚本随之在会话工作区根运行，`watches` 相对工作区。

### `devflowIronRules` 服务

`ctx.get('devflowIronRules')` 暴露 `record(agent, input)`——与工具同一条写入路径，发布出来让另一个插件（比如 `spec-delta` 的分类）把一条义务作为一次调用转发过来，而不是指望模型记得去调。未挂载本插件的部署没有义务的去处，必须明说，而不是让义务静默消失。

## 信任边界

规则携带**会被执行的 shell 脚本**，且没有执行前审批。完整推理：`.devflow/iron-rules/` 只能经两条路到达——`devflow_record_iron_rule`（会话内、有工具审计记录）或 git（经过评审的提交）——模型的文件工具被 [`dsh-devflow-fs-guard`](../devflow-fs-guard/README.zh.md) 挡在目录之外，比一个普通的规则目录多一层围栏。脚本信任边界因此等于仓库写权限加工具平面，与仓库自己的 `package.json` scripts、CI 配置同级。**跑不受信 checkout 的部署不该挂本插件。**

## 配置

```yaml
- name: '@zhchxiao123/dsh-devflow-iron-rules'
  config:
    root: .devflow/iron-rules   # 无 cwd 会话的回退规则根
    maxBytes: 32768             # 常驻规则正文的字节上限
    checkTimeoutMs: 120000      # 单个 check.sh 的超时
    checkOutputMaxChars: 2000   # 单条失败引用脚本输出的上限
    maxRetries: 2               # 交还控制权前的强制续轮次数
```

超过 `maxBytes` 的记录带着维护指令响亮地失败；注入时超限的规则集发布装得下的部分外加装不下的清单，并明说这些规则在有人合并或退役之前**不会被遵守**——列一下伤亡然后继续，只会训练所有人接受一个悄悄缩水的规则集。

## 渲染意图

`other` 类的 `generic` 卡，标题带规则 id，`rawInput` 是规则标题。呈现器是参数的纯函数。

## Model Experience

### Tool schema

#### What the model sees

一个工具。它的描述携带记录纪律——只在触发点记录（一次事故、同一个错误第二次、被明说的要求），绝不投机——因为一套从总结建议里攒出来的规则集，强制的不是任何人做过的决定。常驻规则块与每次校验失败都以普通上下文到达。

#### Token effect

插件激活期间固定的 schema 成本；常驻规则块每次发布一份（仅在规则变更或被 compaction 遮蔽后重发）；违反规则的 turn 另有校验失败反馈。放弃与僵尸通知在下一个 turn 开启时到达，而不是把正在停止的 turn 拖长。

#### KV Cache effect

规则块以持久 user 消息注入而非改写提示前缀，复用只在发布点退化：记录一条规则或 compaction 后重发，从注入处起失效。

## Known Limitations and Deferred Work

- **没有 `/iron-rule` 命令。** 便利面（列出规则、把捕获请求框成模型轮次）刻意推迟；工具才是能力本体，经普通对话仍能记录。
- **只有一方 `write`/`edit` 会把 turn 标脏。** 改文件的 shell 命令不触发校验——与 fs guard 相同的工具平面暴露面，不是本插件新引入的。
- **不检测共存。** 与 `@byclaw/dsh-iron-rules` 同挂会双倍注入与强制，没有任何告警。只挂一个。
- **`admin` 规则只能经评审的文件编辑产生。** 记录永远写 `local`；晋升是对 `owner:` 行的一次被评审的修改——是设计而非疏漏。
