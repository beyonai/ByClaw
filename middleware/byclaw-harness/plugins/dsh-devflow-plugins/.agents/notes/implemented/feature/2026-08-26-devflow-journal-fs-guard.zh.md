# Agent Note：devflow——journal 对 agent 文件工具只读

Status: implemented

[English](2026-08-26-devflow-journal-fs-guard.md) | 中文

## 问题

`.devflow/` 在工作区内、卡片随 git 走，但这也把 journal 放进了开发 agent 的可写集合：拥有 workspace-write 文件工具的 agent 可以绕开流转执行器（revision CAS、边合法性、打回理由、门禁）直接改写历史。第一份 devflow PRD 把这记为已知限制；后续 PRD（`.agents/prd/2026-08-26-devflow-workspace-binding-and-chat-creation.md`）要求在不把状态移出工作区的前提下封掉它。

## 决策

新策略插件 `@zhchxiao123/dsh-devflow-fs-guard`，挂在文件工具每次变更前分发的既有 `fs/write-intent` / `fs/edit-intent` waterfall 上——与 `dsh-fs-observation-policy` 同一个槽位。目标路径含受保护目录段的抛出结构化的 `FS_SANDBOX_DENIED`（复用 fs 词汇表的策略围栏 code），消息指名 devflow 工具，拒绝因此在工具执行器里强制执行，读取保持放行。受保护名单是部署配置（`directories`，默认 `['.devflow']`，格式非法使加载失败），与门禁配置一起放在 profile 里——绝不硬编码在 devflow 插件里、绝不存在 agent 能编辑的文件里。devflow store 在 host 侧用裸 node fs 写盘、不经 `ctx.fs`，流转执行器在策略生效时照常工作：加固不牺牲功能，组合测试以同一会话文件工具被拒的同时移动并创建卡片证明了这一点。

## 曾考虑的替代方案

- **把 `.devflow` 从沙箱 `writableRoots` 剔除** — 推迟而非拒绝：它能把围栏延伸到 bash（内核边界），但 `writableRoots` 是 fs 围栏与 Seatbelt profile 共用的那一个函数，在那里做子树剔除是超出本切片的沙箱 profile 工作；记为本插件的已知限制。
- **从文件工具的 schema 或提示里略去 journal** — 拒绝：schema 省略不是强制执行；任何直接或替代调用者都能绕开，仓库规则要求在执行器上测拒绝。
- **文件只读位或属主变更** — 拒绝：harness 进程自己（devflow store）必须继续写它们，权限位分不清同进程里的 store 与 agent 工具。

## 后果

流程状态对聊天面具备防篡改性、同时留在 git 里：模型可以读它无法伪造的 journal，每次变更都汇入 CAS、边合法性与门禁裁决的缝。shell 写入仍只受组合的内核沙箱约束（workspace-write 仍含 devflow 根），直到 `writableRoots` 剔除落地。
