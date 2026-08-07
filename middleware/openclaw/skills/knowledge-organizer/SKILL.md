---
name: knowledge-organizer
description: 对资料进行知识整理并沉淀为可关联、可构建的知识内容；适用于用户请求整理文档、资料或知识时。
allowed-tools: read, exec
triggers:
  - "整理文档"
  - "帮我整理"
  - "知识整理"
  - "整理资料"
---

# 知识整理

当前 CLI 支持读取 `.md` 与 `.txt` 文件；资料的获取方式不由本 skill 限制。

使用独立 CLI：

```bash
python3 <knowledge-organizer>/scripts/knowledge_organizer.py <command> ...
```

## 强制执行边界

本 skill 的所有副作用只能通过上面的 `knowledge_organizer.py` 发起，且只能使用 `init`、`ingest`、`organize`、`build` 四个命令。

严禁 Agent：

- 直接调用任何 HTTP/RPC 接口，包括实体创建、知识碎片创建和对象构建接口；
- 使用临时 Python、curl、其他 skill 或其他脚本补做任一流程步骤；
- 手工创建实体、碎片、构建任务、报告或绕过 LLM 结果；
- 手工读取、修改、重置或伪造 `state.json`、审计文件、碎片 ID、实例 ID 或构建提交记录；
- 在命令失败后切换到“底层接口直调”等替代路线。

命令失败时，只能如实向用户报告 CLI 返回的失败原因和已成功的项目；不得声称该步骤已完成。需要重试、恢复或变更流程行为时，必须先通过更新本 skill 的脚本实现解决，不能由 Agent 在任务现场绕过。

## 前置条件

- 环境变量 `USER_CODE` 已设置，且对应用户已登录。
- `BE_DOMAINNAME` 与 `DATACLOUD_DOMAINNAME` 已设置为服务发现服务名。
- Agent 上下文中存在数字员工资源 ID。
- Agent 自主生成带业务含义的完整任务目录，例如：

  ```text
  /by/.sessions/{session_id}/{语义化任务名称}/
  ```

不得猜测、复用或覆盖既有任务目录。

## 1. 初始化对象环境

```bash
python3 <knowledge-organizer>/scripts/knowledge_organizer.py init \
  --task-dir "{完整任务目录}" \
  --digital-employee-resource-id "{数字员工资源ID}"
```

该命令获取数字员工授权对象与对象详情，并仅落盘 `objectCode`、`objectName`、`objectDesc`、`properties`。对象按严格的 `ods` 或 `ads` 域保存。初始化失败、授权对象为空、对象详情失败或缺任一域时，立即终止任务。

### 用户限定对象范围

如果用户在请求中明确指定一个或多个对象名称或 `objectCode`，Agent 必须先在初始化获得的授权对象中逐一匹配并锁定该范围。任一指定对象未匹配时立即终止，不得回退到全量对象、猜测替代对象或扩大范围。

后续知识碎片整理时，只能使用该锁定范围内的 ADS 对象定义、检索与实例创建；即使其他授权 ADS 对象看起来更匹配，也不得使用。用户未限定对象时，才可在全部授权 ADS 对象中整理。

## 2. 原始文档入库（ODS）

对每个用户提供的文件，Agent 基于标题、正文和全部授权 ODS 对象定义选择一个对象，并只从原文提取有依据的 labels。labels 可以为空，不得臆造字段值。

随后显式调用：

```bash
python3 <knowledge-organizer>/scripts/knowledge_organizer.py ingest \
  --task-dir "{完整任务目录}" \
  --source "{原始文件绝对路径}" \
  --object-code "{ODS对象编码}" \
  --storage-file-name "{有语义的文件名.md}" \
  --labels-json '{"属性编码":"有依据的值"}'
```

CLI 读取并快照原始文件，真实入库路径自动添加时间戳。成功结果中的 `term_id` 是该原始文档的 ODS 实例 ID。

## 3. 知识碎片整理（ADS）

```bash
python3 <knowledge-organizer>/scripts/knowledge_organizer.py organize \
  --task-dir "{完整任务目录}" \
  --object-code "{限定ADS对象编码1}" \
  --object-code "{限定ADS对象编码2}" \
  --user-intent "仅抽取智能客服实例"
```

默认以最多 4 个文件任务并发整理；每个文件完成后立即更新 `state.json`。如命令中断或个别文件失败，使用 `--resume` 仅恢复未完成或失败的文件，已成功文件不会重复处理：

```bash
python3 <knowledge-organizer>/scripts/knowledge_organizer.py organize \
  --task-dir "{完整任务目录}" \
  --resume
```

`--object-code` 可重复。当用户限定对象范围时，Agent **必须**将匹配到的全部且仅这些 ADS `objectCode` 逐一通过 `--object-code` 传入；不得遗漏、扩大为全量授权对象，或用相似对象替代。`--user-intent` 不能替代该对象类型白名单。脚本会拒绝未授权或非 ADS 编码，并且只使用传入对象定义进行提取、检索、关联和创建。用户未限定范围时，才不传该参数并使用全部授权 ADS 对象。

`--user-intent` 是可选的用户关注范围，例如指定对象类型、对象实例或实体名称。传入后，模型只输出直接符合该范围的条目；不传则按全部可用 ADS 对象抽取。恢复失败任务时未重新传入该参数，会沿用该文件上次保存的用户意图；重新传入会覆盖它。

脚本仅处理成功入库的 ODS 文档：使用允许范围内的 ADS 对象定义抽取原子知识碎片，按 ADS 对象类型批量检索实体；零候选创建实体，单候选直接关联，多候选由模型一次性裁决零或一个候选。所有合法碎片直接入库，不做去重或置信度过滤。

每个碎片使用 ADS 实体 ID 作为 `instanceId`，使用原始文档 `term_id` 作为 `originInstanceId`。

## 4. 更新相关对象文档

```bash
python3 <knowledge-organizer>/scripts/knowledge_organizer.py build \
  --task-dir "{完整任务目录}"
```

该命令只提交本任务成功碎片关联的 ADS 实体。仅对请求中的实体 ID 去重；不对碎片去重。每批最多 100 个实体，提交成功即完成，不等待异步任务结束。

## 失败与交付物

认证失效、对象初始化失败或状态损坏会终止任务。其他文件、碎片或构建批次失败时，CLI 记录部分失败；Agent 只能报告结果，不能直接补写或补调接口。

所有命令通过任务目录下的 `knowledge-organizer/state.json` 交换状态，而不是依赖终端输出。最终产物为：

- `knowledge-organizer/reports/final-report.json`：机器可读审计结果；
- `knowledge-organizer/reports/summary.md`：成功项、失败项、失败原因、实例/碎片 ID 与异步构建提交状态汇总。
