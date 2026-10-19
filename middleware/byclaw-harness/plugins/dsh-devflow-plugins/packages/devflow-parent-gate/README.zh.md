# @zhchxiao123/dsh-devflow-parent-gate

[English](README.md) | 中文

[`ctx.devflow`](../devflow/README.zh.md) 缝上拆分需求的完成策略：带子卡的卡片只有在每张子卡都 `done` 之后才能到达 `done`。本插件是 `devflow/transition` 瀑布上的纯 Consumer——不新增状态机、不新增阶段、不新增 store 操作；需求的完成始终是由它的切片派生出的事实。

## 行为

监听器只决定一条边：目标为 `done` 的移动。它在卡片自己的根里列出该卡的子卡，只要有任何一张不在 `done` 就否决，并点名每张未完成子卡及其当前阶段，让调用方知道还差什么。其余每条边、以及每张没有子卡的卡，都原样委派下去。

规则只卡在 `-> done` 而非流水线更早的位置，这样父卡自己的 `reviewing` 与 `testing` 就留给了对已完成切片的整合验收。否决不是提交：卡片停在原处、revision 不变、不产生 journal 条目。

组合只需在 store 旁边加一行；没有这个插件时父子关系照常可用，只是不被强制。

```yaml
- id: devflow
  name: '@zhchxiao123/dsh-devflow-filesystem'
- id: devflow-parent-gate
  name: '@zhchxiao123/dsh-devflow-parent-gate'
```

不变量伴生插件用同一条规则校验通知流：没有任何 `devflow/stage-changed` 会在流中已见的子卡不在 `done` 时把卡片落到 `done`，与其他 devflow 关系一样按 root + id 建键。

## Model Experience

None, as the completion veto reaches a model only through the devflow tools' rejection text; this plugin registers no prompt or schema.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **门禁不会替父卡移动**——最后一张子卡完成后，父卡自己的移动仍由人或模型提交；策略只拒绝过早的 `done`。
- **"父卡结束后再补子卡"不存在，因此无需对账**——store 会拒绝这种创建（`parent-settled`），并把它放在父卡自己的卡片链上执行，因此创建与本门禁裁决的 `-> done` 不可能交错；本插件永远不必推理"父卡完成得太早"的情形。
