# @zhchxiao123/dsh-devflow-fs-guard

[English](README.md) | 中文

`fs/*` intent waterfall 上的 devflow 状态保护：目标路径含受保护目录段的任何文件工具变更（`write`、`edit`、`str_replace_editor`）都在工具执行器里以结构化的 `FS_SANDBOX_DENIED` 拒绝、不达 `ctx.fs` Provider，拒绝消息把模型指向 devflow 工具。代码随便写；卡片 journal、投影与租约只能经 [`ctx.devflow`](../devflow/README.zh.md) 变更——其 store 在 host 侧写盘，流转执行器（revision CAS、边合法性、打回理由、[门禁](../devflow-gates/README.zh.md) waterfall）因此保持卡片历史的唯一写路径。读取原样放行：模型永远可以查看它无法伪造的 journal。

本插件不注册服务、不注入任何东西；它是 devflow 栈的策略之三，正如 [`dsh-fs-observation-policy`](../../fs/fs-observation-policy/README.zh.md) 之于观测状态，与门禁配置一起部署在 profile 里。

受保护根下住着三类状态，拒绝消息会指向与目标相符的那条写路径：受保护段之后是 `spec` 的路径指向 `devflow_write_spec`，之后是 `iron-rules` 的指向 `devflow_record_iron_rule`，其余指向卡片工具。把写 spec 或写规则的人指向一个根本写不了他那个文件的工具，是一个技术上成立、实际上误导的拒绝。


## 配置

```yaml
- id: devflow-fs-guard
  name: '@zhchxiao123/dsh-devflow-fs-guard'
  config:
    directories: ['.devflow']
```

| 键 | 默认值 | 含义 |
|---|---|---|
| `directories` | `['.devflow']` | 文件工具不得变更其子树的目录名，与变更目标路径的每个段匹配。只接受裸目录名；空或格式非法的列表使加载失败（什么都不想守就卸载插件）。 |

## Model Experience

### Tool results

#### What the model sees

No schema or prompt changes. A denied mutation returns the file tool's error result carrying the guard's message — the target path, the protected directory list, and the instruction to use `devflow_transition`/`devflow_create` instead.

#### Token effect

None until a denial; a denial costs one short error result.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

- **策略围栏，不是内核边界** — shell 写入只受组合的内核沙箱约束，其 workspace-write profile 仍包含 devflow 根；把受保护目录从共享的 `writableRoots` 集合中剔除能把围栏延伸到 bash，随沙箱工作推迟。
- **按名匹配，不按根匹配** — 保护按目标路径中任何位置的目录名生效，不按已解析的 devflow 根，因此恰好叫 `.devflow` 的代码目录对文件工具同样只读。
