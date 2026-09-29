# ByClaw 开源代码贡献手册

> 面向首次参与 ByClaw 的外部开发者，帮助贡献者独立选择 Issue、修改代码、提交符合规范的代码，并完成 Pull Request（PR）的评审闭环。

## 1. 贡献者须知

### 1.1 贡献入口

- 项目仓库：<https://github.com/beyonai/ByClaw>
- Issue：<https://github.com/beyonai/ByClaw/issues>
- Pull Request：<https://github.com/beyonai/ByClaw/pulls>
- 行为准则：[CODE_OF_CONDUCT.md](../../CODE_OF_CONDUCT.md)
- 项目贡献约定：[CONTRIBUTING.md](../../CONTRIBUTING.md)

如果仓库地址、默认分支或协作方式发生变化，以 GitHub 仓库当时显示的信息和维护者说明为准。

### 1.2 推荐的首次贡献

第一次贡献优先选择范围清晰、风险较低的任务，例如：

- 修正错别字、失效链接或不清晰的说明；
- 为已有功能补充测试；
- 修复带有 `good first issue` 或 `help wanted` 标签的问题；
- 提供稳定、最小化的 Bug 复现用例；
- 修复边界条件明确的小型 Bug。

较大的新功能、架构调整、公共接口变化和数据库变更，应先创建或认领 Issue，与维护者确认方案后再开发，避免投入方向不一致。

## 2. 认识代码仓库

| 目录 | 主要职责 | 常见技术或工具 |
|------|----------|----------------|
| `byclaw-fe/` | Web 前端 | React、Umi Max、TypeScript、pnpm |
| `byclaw-be/` | 核心 Java 后端 | Java 21、Maven |
| `byclaw-exe/` | Python CLI、扩展与技能 | Python、Ruff、pytest |
| `byclaw-qa/` | 知识库与问答服务 | Python、uv |
| `byclaw-super/` | 多智能体主管与持久运行服务 | Python |
| `deploy/` | 部署配置及数据库迁移 | Docker、Shell、SQL |
| `middleware/` | 基础运行组件 | 以目录内说明为准 |
| `docs/` | 项目文档 | Markdown |
| `examples/` | 与生产配置解耦的示例 | 以示例说明为准 |
| `tests/` | 跨模块单元、集成及审核后的生成测试 | 以目录内说明为准 |

开始修改前，先阅读仓库根目录及目标子目录中的 `AGENTS.md`、`README.md`、`CONTRIBUTING.md` 等说明。离目标代码越近的模块约定，通常越能反映该模块的真实构建和测试方式。

## 3. 获取代码并创建分支

### 3.1 推荐方式：先克隆官方代码，需要提交时再 Fork

外部贡献者可以先克隆官方仓库、创建分支并修改代码，不必在开始工作前就 Fork：

```bash
git clone https://github.com/beyonai/ByClaw.git
cd ByClaw
git switch -c fix/short-problem-description
```

完成修改并准备推送时，再在 GitHub 页面点击 **Fork**。随后把官方仓库改名为 `upstream`，将个人 Fork 设置为 `origin`：

```bash
git remote rename origin upstream
git remote add origin https://github.com/<你的 GitHub 用户名>/ByClaw.git
git remote -v
git push -u origin fix/short-problem-description
```

此后：

- `origin` 指向自己的 Fork，用于推送分支；
- `upstream` 指向 ByClaw 官方仓库，用于同步最新代码。

外部贡献者通常没有官方仓库的直接写入权限，因此可以直接修改克隆下来的代码，但最终仍需把分支推送到自己的 Fork，才能向官方仓库创建 PR。

### 3.2 也可以先 Fork 再克隆

如果习惯先准备个人仓库，可以先在 GitHub Fork，然后克隆自己的 Fork：

```bash
git clone https://github.com/<你的 GitHub 用户名>/ByClaw.git
cd ByClaw
git remote add upstream https://github.com/beyonai/ByClaw.git
git switch -c fix/short-problem-description
```

两种方式产生的 PR 没有区别。本文推荐“先克隆、后 Fork”，因为开始查看和修改代码时步骤更少。

### 3.3 不推荐下载 ZIP

GitHub 的 **Download ZIP** 只能得到代码文件，不包含 `.git` 历史、分支和远程仓库信息。可以用它阅读或临时试验代码，但不能直接执行 Git 提交或创建 PR。

如果已经下载 ZIP 并完成了修改，最稳妥的做法是：

1. 另外使用 `git clone` 获取正式工作副本；
2. 在正式工作副本中创建分支；
3. 将 ZIP 中修改过的文件复制到工作副本；
4. 用 `git diff` 检查差异后正常提交。

不要直接在 ZIP 解压目录中运行 `git init` 后提交整个项目，否则容易缺失项目历史、误加临时文件，并增加后续同步官方更新的难度。

### 3.4 开发前同步代码

```bash
git fetch upstream
git switch develop
git pull --ff-only upstream develop
git switch -c fix/short-problem-description
```

贡献分支应基于最新的 `develop` 分支创建。分支名应短小、明确，例如：

- `fix/login-pagination`
- `feat/knowledge-search-filter`
- `docs/contribution-example`
- `test/session-timeout`

不要直接在 `develop` 或 `main` 分支开发，也不要把多个无关问题放进同一个分支和 PR。

## 4. 从 Issue 到 PR 的标准流程

```text
搜索或创建 Issue
        ↓
与维护者确认范围和方案
        ↓
同步上游并创建分支
        ↓
先复现问题，再做最小修改
        ↓
补充测试和必要文档
        ↓
本地检查、测试和构建
        ↓
自查差异并提交到个人 Fork
        ↓
创建 PR、响应评审、等待 CI 通过
```

### 4.1 选择或创建 Issue

动手前先搜索已有 Issue 和 PR，避免重复工作。认领任务时建议留言说明：

- 你准备解决的问题；
- 初步修改范围；
- 是否涉及接口、配置、数据库或兼容性变化；
- 预计何时可以提交首个 PR。

新报 Bug 至少应包含：运行环境、ByClaw 版本或提交号、复现步骤、预期行为、实际行为，以及脱敏后的日志或截图。

### 4.2 设计最小修改

编码前回答四个问题：

1. 问题能否稳定复现？
2. 根因位于哪个模块？
3. 哪个最小改动可以解决问题？
4. 哪个测试能够在修复前失败、修复后通过？

ByClaw 要求保持模块边界。除非仓库已建立相应模式并且变更得到认可，否则不要通过源码直接导入的方式增加产品模块之间的新耦合；优先使用 API、共享包或有版本的构件。

### 4.3 编码与测试

开发时遵循三条原则：

- **最小范围**：只修改当前任务需要的内容，不顺带重构无关代码；
- **保持一致**：沿用目标模块现有的命名、目录、导入方式和工具；
- **可被证明**：行为变化应有测试，必要时同步更新用户或开发文档。

不要提交密钥、Token、私有地址、生产连接串、真实用户数据或未脱敏日志。配置项名称可以写入 `.env.example`，真实值只能通过本地环境变量或 CI Secret 提供。

### 4.4 查看自己的改动

提交前至少执行：

```bash
git status --short
git diff --check
git diff
```

重点确认：

- 没有无关文件、调试代码或临时文件；
- 没有密钥和内部专用配置；
- 没有意外修改锁文件或格式化大量无关代码；
- 新增逻辑覆盖了成功、失败和边界情况；
- 用户可见行为或公共接口变化已有必要说明。

## 5. 提交规范

ByClaw 使用 [Conventional Commits](https://www.conventionalcommits.org/)：

```text
<type>(<scope>): <subject>

<可选正文>

<可选关联 Issue>
```

常见 `type`：

| type | 用途 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `docs` | 仅文档变化 |
| `style` | 不改变逻辑的格式调整 |
| `refactor` | 不属于新功能或修复的重构 |
| `test` | 测试变化 |
| `chore` | 工具、构建或杂项维护 |

常见 `scope` 包括 `fe`、`be`、`exe`、`docs`、`ci`。主题应简洁说明“改了什么”，不要使用“update code”“fix issue”一类含义模糊的描述。

示例：

```bash
git add <本次变更文件>
git commit -m "fix(fe): handle empty knowledge search result"
git push -u origin fix/knowledge-search-empty-state
```

推荐明确列出要暂存的文件，不建议不加检查地使用 `git add .`。

## 6. 创建高质量 Pull Request

从个人 Fork 的分支向 ByClaw 官方仓库的 `develop` 分支创建 PR，并按仓库模板填写。除非维护者明确要求，否则外部贡献者不要直接向 `main` 分支发起 PR。

PR 至少应说明：

- **Summary**：改了什么、为什么改；
- **Related issues**：使用 `Closes #123` 或 `Fixes #123` 关联 Issue；
- **测试**：增加或更新了哪些测试，运行了哪些命令；
- **文档**：是否需要更新文档；不需要时说明原因；
- **风险**：兼容性、数据、性能、安全或回滚方面的注意事项；
- **界面变化**：前端变化附上截图或短视频。

可直接使用下面的描述骨架：

```markdown
## Summary

- 问题：
- 根因：
- 解决方案：

## Verification

- [ ] 已添加或更新相关测试
- [ ] 已运行相关 lint、测试和构建
- [ ] 已更新必要文档，或说明不需要更新的原因
- [ ] 不包含密钥、Token、内部地址或生产配置

运行结果：
- `<command>`：通过/未运行（原因）

## Risk and compatibility

- 影响范围：
- 兼容性与回滚：

## Related issues

Closes #<issue-number>
```

PR 应保持可审查：范围单一、提交清晰、无无关格式化。至少需要一名维护者批准，并且相关 CI 全部通过后才能合并。

## 7. 分支与版本发布规则

### 7.1 分支职责

ByClaw 使用以下分支协作方式：

| 分支 | 用途 | 谁负责更新 |
|------|------|------------|
| `main` | 稳定主分支，保存经过阶段性验证的代码 | 协作者或管理员定时从 `develop` 同步 |
| `develop` | 日常开发集成分支，接收外部贡献者和协作者的 PR | 维护者审核并合并 PR |
| 个人功能分支 | 完成单个功能、修复、测试或文档任务 | 对应贡献者维护 |

外部贡献者的标准流向是：

```text
官方 develop
     ↓ 创建个人分支
个人 Fork 中的功能分支
     ↓ 发起 Pull Request
官方 develop
     ↓ 协作者或管理员定时同步
官方 main
     ↓ 按月发布或紧急修复
生产版本 Tag
```

### 7.2 个人分支

个人分支应从最新的官方 `develop` 创建，一个分支只解决一个相对独立的问题：

```bash
git fetch upstream
git switch develop
git pull --ff-only upstream develop
git switch -c feat/short-feature-name
```

推荐使用以下前缀：

- `feat/`：新功能；
- `fix/`：Bug 修复；
- `docs/`：文档修改；
- `test/`：测试补充；
- `refactor/`：已确认范围的重构；
- `hotfix/`：由维护者确认的生产紧急修复。

不要长期复用已经合并过的个人分支。开始新任务时，应重新从最新的 `develop` 创建新分支。

### 7.3 `develop` 定时同步到 `main`

当前项目使用每月 4 美元、包含 2000 分钟 GitHub Actions 时长的套餐。为控制 Actions 消耗，PR 合并到 `develop` 后不会逐个立即同步到 `main`。协作者或管理员会按照项目安排，定时将已经验证的 `develop` 代码同步到 `main`。

因此，PR 已合并到 `develop` 并不表示代码已经进入稳定主分支或生产版本。贡献者无需另行向 `main` 重复提交相同 PR，也不要自行合并或强制同步 `develop` 与 `main`。

### 7.4 月度版本与 Hotfix

管理员从稳定的 `main` 分支创建生产 Tag，常规版本按月度节奏发布：

- 本月底计划发布 `0.5.0`；
- 下月底计划发布 `0.6.0`；
- 两个月度版本之间如需发布生产紧急修复，使用补丁版本，例如 `0.5.1`、`0.5.2`。

版本号遵循 `主版本.次版本.补丁版本` 的形式。月度发布提升次版本号并将补丁号归零；Hotfix 只提升当前月度版本的补丁号。生产 Tag 由管理员创建，普通贡献者不应自行创建或推送生产 Tag。

## 8. 数据库迁移的特殊规则

数据库 Schema 或数据变化都属于迁移，包括 `deploy/migrations/versions/` 下的 DDL、DML，以及初始化 SQL 的变化。这类贡献必须遵守以下规则：

1. **先由维护者明确迁移版本。** 未给出准确版本时，不得自行推断、递增或新建版本。
2. 普通开发只修改已批准的 `deploy/migrations/versions/<version>/` 目录。
3. DDL 与 DML 必须严格分离：
   - `CREATE`、`ALTER`、`DROP`、`TRUNCATE`、`COMMENT ON`、`GRANT`、`REVOKE` 等只能放在 `__ddl.sql`；
   - `INSERT`、`UPDATE`、`DELETE`、`MERGE` 等只能放在 `__dml.sql`。
4. 修改后运行只读校验：

   ```bash
   python3 deploy/migrations/merge_migrations.py --dry-run
   ```

5. 不得手工修改 `deploy/middleware/initdb/`、版本标记或 `deploy/migrations/.applied`。
6. 不得在普通贡献中执行正式合并迁移；迁移合并由版本管理员在发布前完成。

数据库规则违反后可能造成重复执行、环境不一致或数据损坏，因此不确定时应停止修改并先询问维护者。

## 9. 常见退回原因

| 问题 | 改进方式 |
|------|----------|
| 没有对应 Issue 就直接提交大型功能 | 先讨论需求、边界和实现方案 |
| 一个 PR 同时修改多个无关问题 | 拆成可独立评审和回滚的 PR |
| 只改实现，没有测试 | 增加能证明行为变化的测试 |
| 未运行检查，完全依赖 CI | 提交前完成目标模块的本地验证 |
| 引入新的跨模块源码依赖 | 使用已有 API、共享包或版本化构件 |
| 提交了 `.env`、Token 或内部地址 | 删除敏感内容、轮换已泄漏凭据，并使用环境变量 |
| 大量无关格式化或锁文件变化 | 回退无关差异，只保留任务所需修改 |
| 数据库迁移版本自行决定 | 请维护者明确指定准确版本 |
| PR 描述只有一句话 | 写清问题、方案、验证、风险和关联 Issue |

## 10. 提交前最终检查清单

- [ ] 修改对应明确的 Issue 或已对齐的需求
- [ ] 分支基于最新的官方 `develop` 分支
- [ ] 只包含本任务需要的改动
- [ ] 遵循目标模块现有代码风格和目录约定
- [ ] 行为变化已有测试
- [ ] 必要文档已经更新
- [ ] 已运行相关 lint、测试和构建
- [ ] 已检查 `git diff --check` 和完整差异
- [ ] 未提交密钥、Token、私有地址、生产配置或真实数据
- [ ] 提交信息符合 Conventional Commits
- [ ] PR 描述包含问题、方案、验证、风险和关联 Issue
- [ ] 如涉及数据库，迁移版本已由维护者明确指定且通过 dry-run 校验

## 11. 延伸阅读

- [项目贡献约定](../../CONTRIBUTING.md)
- [自动化开发工具约定](../../AGENTS.md)
- [提交信息规范](../../.github/commit-convention.md)
- [PR 模板](../../.github/PULL_REQUEST_TEMPLATE.md)
- [代码评审指南](code-review.md)
