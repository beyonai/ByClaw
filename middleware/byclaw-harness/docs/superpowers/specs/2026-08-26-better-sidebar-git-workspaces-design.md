# Better Sidebar Git 工作区设计

日期：2026-08-26

## 目标

优化 `dsh-better-sidebar` 的默认标签页和源代码管理体验，使一个会话能够安全、清晰地操作 CWD 根仓库、`.gitmodules` 声明的子仓库，以及每个仓库的 linked worktree。

本设计只修改 ByClaw 维护的 `dsh-better-sidebar` 插件。插件源码以 `byclaw-dsh/plugins/dsh-better-sidebar` 为准，完成后同步到 `deepseek-harness/plugins/dsh-better-sidebar`；不修改 DSH 源码。

## 当前问题

- 新会话只固定创建 `Files` 标签页，不会根据 CWD 的 Git 状态创建 `Source Control`。
- 已暂存和未暂存变更以始终展开的平铺列表显示，目录关系与状态类型不醒目。
- 仓库发现逻辑在 CWD 本身属于 Git 仓库时只返回当前根仓库，不会继续读取 `.gitmodules`，因此子仓库无法切换。
- 现有仓库选择和 worktree 选择分别维护状态。切换仓库时，旧 worktree、状态、分支或历史可能短暂保留，存在对错误目标执行操作的风险。

## 已确认的交互

### 默认标签页

客户端在获得会话 CWD 后向插件后端请求 Git 资源清单。只有当 CWD 根目录直接存在 `.git`（目录或文件）时，才执行一次默认标签页初始化。

- 确保 `Files` 与 `Source Control` 两个标签页存在。
- `Files` 保持激活，`Source Control` 放在其后。
- 新会话和已有会话均执行一次检测。
- 会话状态保存“Git 默认标签页已检查”标记。用户后续关闭标签页时不再自动补开。
- 若用户在插件设置中禁用了 `editor` 或 `git` 标签类型，则不创建对应标签页。
- CWD 只是某个仓库的子目录、但 CWD 自身没有 `.git` 时，不自动创建标签页；用户仍可手动打开源代码管理。

初始化必须是幂等操作：重复挂载、会话摘要补齐、HMR 或请求重试都不能创建重复标签页。

### 仓库与 Worktree 选择

源代码管理顶部使用两级选择器：

1. 仓库选择器：CWD 根仓库以及 `.gitmodules` 声明的子仓库。
2. Worktree 选择器：当前所选仓库的主工作区以及有效 linked worktree。

仓库项展示名称和相对 CWD 的路径。Worktree 项展示分支、目录名和变更数量。当前选择按会话持久化；仓库或 worktree 消失后回退到根仓库的当前工作区。

未初始化或缺失的子模块仍出现在仓库选择器中，并标记为“未初始化”，但不可选择为 Git 操作目标。

## 后端资源模型

新增统一 Git 资源清单接口，返回客户端渲染与目标选择所需的完整信息。建议响应结构如下：

```ts
interface GitWorkspaceInventory {
  cwdHasGitEntry: boolean
  repositories: GitRepository[]
}

interface GitRepository {
  id: string
  name: string
  path: string
  relativePath: string
  kind: 'root' | 'submodule'
  state: 'ready' | 'uninitialized' | 'missing'
  worktrees: GitWorktree[]
}
```

`id` 是由规范化仓库路径派生的稳定不透明标识。后续 Git 请求传递仓库 ID 和 worktree ID，不直接信任客户端提供的任意绝对路径。后端在每次操作时从当前清单解析真实路径。

### 子模块发现

- 只读取根仓库及已初始化子仓库中的 `.gitmodules`，不遍历磁盘。
- 使用 Git 配置解析能力读取 `submodule.*.path`，避免自行实现不完整的 INI 解析器。
- 子模块路径以声明它的仓库为基准解析。
- 已初始化子仓库继续读取自己的 `.gitmodules`，支持递归子模块。
- 使用规范化 realpath 集合防止循环，并设置仓库数量和递归深度上限，异常时返回明确错误或截断标记。
- 声明路径必须位于会话 CWD 内；越界、符号链接逃逸和重复路径不得进入可操作清单。

### Worktree 发现与校验

- 每个 ready 仓库通过 `git worktree list --porcelain -z` 获取 worktree。
- 排除 prunable 或已不存在的 worktree；保留 locked 但仍可用的 worktree。
- Worktree ID 只能解析到该仓库 authoritative worktree 列表中的路径。
- 合法 linked worktree 可以位于会话 CWD 外部，并可执行 Git 状态、Diff、暂存、提交等仓库操作。
- 会话文件编辑器仍遵守 CWD 文件系统边界。位于 CWD 外的 linked worktree 不显示“在编辑器中打开”，但可以查看 Git Diff。

## 原子目标与数据刷新

客户端用一个组合选择状态表示当前目标：

```ts
interface GitTarget {
  repositoryId: string
  worktreeId: string
}
```

状态、分支、历史、Diff、暂存、取消暂存、丢弃、提交、checkout、revert 和 cherry-pick 都携带同一个 `GitTarget`。后端先重新验证目标，再执行命令。

切换任一级选择器时：

1. 增加请求 generation。
2. 立即清空旧状态、分支和历史，并禁用操作按钮。
3. 获取新目标的完整视图。
4. 只接受 generation 与当前选择一致的响应。
5. 目标失效时刷新资源清单并安全回退，不自动把操作重放到回退目标。

轮询只更新当前目标的状态；仓库和 worktree 资源清单使用较长 TTL，并可通过手动刷新立即重建。任何异步响应都不得把旧目标数据写入新目标视图。

## 变更目录树

“已暂存”和“未暂存”是两个可折叠区域，初始均折叠。展开区域后，将 Git 的 repo-root-relative 路径构建为纯客户端路径树。

- 目录节点可展开或折叠；区域第一次展开时目录层级默认展开。
- 文件节点点击打开对应 staged 或 unstaged Diff。
- 文件节点保留暂存、取消暂存、丢弃和上下文菜单能力。
- 目录节点的暂存或取消暂存作用于该目录子树。
- 区域级“全部暂存/全部取消暂存”保持现有语义。
- 同一文件同时有 index 与 worktree 变化时，分别出现在两个区域，并绑定各自 Diff 侧。
- Rename/Copy 继续使用新路径作为主要显示与操作路径。

树构建为纯函数，不读取文件系统；状态列表上限继续生效，截断时保留现有提示。

## 状态颜色

文件名和状态徽标同时使用状态色，不能只依赖颜色传递含义，徽标仍显示 Git 状态字母或短标签。

| 状态 | 颜色语义 |
|---|---|
| Added / staged | 绿色 |
| Modified | 橙色 |
| Deleted / conflicted | 红色 |
| Renamed / copied | 蓝紫色 |
| Untracked | 青色 |

目录节点保持普通文本色，并显示子树变更数量；包含冲突时附加红色状态标记。颜色使用现有主题变量或新增语义变量，必须同时兼容亮色和暗色主题。

## 错误处理

- Git 不可用、`.gitmodules` 解析失败、仓库无权限或操作失败时，在源代码管理面板显示可操作的错误文本，不影响 Files 标签页。
- 一个子模块发现失败不隐藏其他有效仓库；失败项显示不可用状态和原因。
- 一个 linked worktree 读取失败不使整个仓库不可用。
- 未初始化子模块不会触发自动初始化或网络操作。
- 插件不会为发现仓库而扫描 CWD 之外或遍历整个磁盘。

## 测试与验收

### 单元测试

- Git 资源清单：根仓库、单层/递归 `.gitmodules`、未初始化子模块、越界路径、循环和上限。
- Worktree：主工作区、linked worktree、prunable、失效目标与仓库归属校验。
- 默认标签页：新旧会话、`.git` 文件/目录、禁用类型、重复检测、用户关闭后不重开。
- 目录树：深层路径、同名目录、双侧变更、rename/copy、目录操作路径。
- 状态颜色映射和无障碍标签。

### 组件与集成测试

- 仓库和 worktree 切换原子刷新，旧异步响应不能污染新目标。
- 所有写操作使用当前组合目标。
- 两个变更区域默认折叠，展开后显示目录树。
- 外部 linked worktree 隐藏文件编辑入口但保留 Diff。
- 使用临时 Git 仓库构造子模块和 worktree，不依赖网络。

### 端到端验证

- 构建插件并运行聚焦测试。
- 将插件同步到 `deepseek-harness` 后启动 Web profile。
- 使用 `/Users/chenxiaofeng/code/project/20014944` 做只读验证：应显示根仓库与 `beyonai/byclaw-test`，并分别列出各自 worktree。
- 不修改该项目当前暂存区、工作区、分支或提交历史。

## 不在本次范围

- 初始化或更新 Git submodule。
- 创建、删除或修剪 worktree。
- Git remote、push、pull、fetch、merge 和 rebase UI。
- 修改 DSH 核心源码或放宽会话文件系统权限。

## 采用的方案

采用统一 Git 资源清单方案。没有采用继续扩展分散接口的方案，因为仓库和 worktree 两个独立状态容易产生竞态；没有采用客户端解析 `.gitmodules`，因为仓库身份、路径边界和 Git 操作目标必须由插件后端统一验证。
