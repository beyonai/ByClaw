# Agent Skill 运行态验证

## 结果

纯插件实现；未修改 deepseek-harness 源码。DSH 原生 `tool-skill` 继续生成 `skill-catalog`，插件按 Agent 身份提供 `snapshot/list/get` 视图。

- 数字员工：内置 Skills + 当前 Redis 关联 Skills；关联为空时仅保留内置 Skills。
- 普通 Agent：原有目录 + 内置 Skills。
- 根员工、委派模板和 AgentTeams 成员绑定模板 ID，Watch 发布后已有 Agent 的后续查询读取新代次。
- 名称/描述变化由原生目录更新；正文变化额外发出重新加载提示。历史消息与已发出的模型请求保留。

## Web 实测

2026-09-03，使用 DSH 源码、该目录 `.env` 和本仓库九个插件启动 Web；排除了 `dsh-devflow-plugins`。

在 Web 会话输入 `@代码工匠·程开源`，明确要求通过 `byclaw_instantiate_template` 委派给原版员工 `20010807`，只读盘点员工自身目录并用标准工具加载 `html-artifact`。没有修改 Redis 业务数据。

| 核对项 | 实际结果 |
| --- | --- |
| 主会话 | `session-7d2f2251-28a9-4ad6-a358-33e2ed60e003`，标题「技能目录验证与HTML加载确认」 |
| 最终员工子会话 | `22b6a69b-d5c7-4c2e-a682-a2b217a943e4` |
| 员工模板 | `byclaw-employee-20010807` |
| 原始持久化事件 | seq `14`，`user/message`，`source.kind=skill-catalog` |
| 目录集合 | **33 项 = 31 项内置 + html-artifact + self-developed-rules** |
| 精确集合断言 | 将事件 entries 与 builtin 一级目录 YAML 名称、关联名称取并集比较，`deepEqual` 通过 |
| 标准加载 | seq `588` 调用 `skill({name:"html-artifact"})`；seq `589` 返回 `<skill_content name="html-artifact">`，无错误 |
| 无关技能 | 员工目录未混入主会话的 `frontend-design`、`hyperframes`、`trellis-*` 等全局/项目技能 |

证据来自实际会话 `session.jsonl.zstd` 解压后的事件断言，并与 Web 子会话结果交叉核对。

联调同时修复了插件原有的 Web 委派工作区缺失问题：普通 Web 根会话没有经过 Worker 登记，现按存活父会话的 `SessionHeader.cwd` 建立继承，随 Agent 生命周期清理。

`.env` 中的 BE 地址不带端口，导致关联技能版本请求失败并触发既有降级逻辑。验证确认同一服务 `:8080` 可用，最终启动仅临时覆盖 `BYCLAW_DSH_BASE_URL`，未改写 `.env`：

```sh
cd /Users/chenxiaofeng/code/open/deepseek-harness
PATH=/Users/chenxiaofeng/.nvm/versions/node/v24.13.1/bin:$PATH \
BYCLAW_DSH_BASE_URL=http://123.56.153.229:8080 \
BYCLAW_SKILLS_DIR=/Users/chenxiaofeng/code/open/byclaw-dsh/builtin/skills \
node --env-file=/Users/chenxiaofeng/code/open/deepseek-harness/.env \
  --import tsx/esm apps/cli/src/bin.ts web --no-open
```

服务保留在 `http://127.0.0.1:3080/`。单独输入 @ 名称不保证主模型执行委派；本次最终验证已确认真实模板子会话及其目录，非主模型代答。

## 自动回归与复查

- `node scripts/skill-runtime-verify.mjs`：7/7 通过；使用实际 DSH Registry、Session、原生 tool-skill。
- 覆盖多行 YAML、内置默认注入、精确员工目录、标准工具/斜杠入口限制、空关联撤销、暂存失败保留、成功提交、原生元数据刷新、正文变化提示、生命周期释放、根员工及 Web 委派绑定。
- 使用真实 `ByClawResourceWatch` 配合模拟 Redis 事件，验证同一个存活 Agent 在关联更新/撤销后读取新视图，其他员工不受影响。未在线变更真实 Redis 关联关系。
- Integration 与 AgentTeams 构建通过；Integration 既有 verify 全部脚本通过（本机以 `npm run build` 替代首项 `pnpm build`，避免独立插件目录的 workspace 依赖自动安装）；Web 工作区修复后重新运行相关 hot-path/context 检查通过。
- 增量只读代码复查通过，无必须修复的新问题。

运行新回归：在 integration 插件目录执行 `DSH_ROOT=/absolute/path/deepseek-harness node scripts/skill-runtime-verify.mjs`。需要 Node 24 及已安装依赖的 DSH 源码目录。

这不是文件系统沙箱。冷态历史会话尚未激活时，Web 技能选择菜单仍可能显示 preset 目录；运行态模型上下文和标准 Skill 加载使用员工视图。
