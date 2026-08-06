import type { LayoutNode, RepoOption, SplitTaskDraft } from './types';

// 建议分支名:用需求标题里的英文/数字片段,退化为 feat/req。用户可在拆单弹窗改写,留空则后端 buildBranchName 兜底。
const suggestBranch = (title: string): string => {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return slug ? `feat/${slug}` : 'feat/req';
};

// 仓库职责 → 拓扑序权重:中间件/后端在前,前端在后(fe 依赖 be,be 依赖 mw)。
const repoTier = (repoName: string): number => {
  if (/middleware|mw|mq|gateway/i.test(repoName)) return 0;
  if (/be|api|server|backend/i.test(repoName)) return 1;
  if (/fe|front|web|ui/i.test(repoName)) return 2;
  return 1;
};

// 客户端预拆建议:每个仓库预拆一个节点,并按仓库职责(mw → be → fe)推断依赖边连成一条链,作为拆单弹窗的初始草稿。
// 仅是启发式初值,用户可增删节点、改仓库/分支/承接人、改依赖;确认后由后端按草稿批量建会话并落库依赖。
// 任务标题:需求标题 + 仓库短名,让 1 对多后的每个任务有可区分的标题。
const suggestTaskTitle = (reqTitle: string, repoName: string): string => {
  const shortRepo = repoName.split('/').pop() || repoName;
  return `${reqTitle} · ${shortRepo}`;
};

export const buildSuggestedSplit = (title: string, repos: RepoOption[]): SplitTaskDraft[] => {
  const branch = suggestBranch(title);
  if (!repos.length) {
    return [{ rowId: 'row-0', title, repoId: undefined, branch, dependsOn: [], aiSuggested: true }];
  }
  // 按职责排序后,让每个节点依赖前一个,形成线性依赖链(最常见的多仓库需求拓扑)。
  const ordered = repos
    .map((repo, index) => ({
      repo,
      index,
      tier: repoTier(repo.repoFullName || repo.repoUrl || String(repo.repoId)),
    }))
    .sort((a, b) => a.tier - b.tier || a.index - b.index);

  return ordered.map((item, idx) => {
    const repoName = item.repo.repoFullName || item.repo.repoUrl || String(item.repo.repoId);
    return {
      rowId: `row-${idx}`,
      title: suggestTaskTitle(title, repoName),
      repoId: item.repo.repoId,
      branch,
      dependsOn: idx === 0 ? [] : [`row-${idx - 1}`],
      aiSuggested: true,
    };
  });
};

// 按拓扑深度分层:depth = 最长上游链长度(无上游=0),order = 同层内出现次序。
// 存在环时(用户误连)未参与拓扑的节点兜底放到末列,保证一定能画出来。
export const buildLayers = (tasks: SplitTaskDraft[]): LayoutNode[] => {
  const byId = new Map(tasks.map((task) => [task.rowId, task]));
  const depthCache = new Map<string, number>();
  const visiting = new Set<string>();

  const depthOf = (id: string): number => {
    if (depthCache.has(id)) return depthCache.get(id)!;
    // 环保护:遇到正在计算的节点直接记 0,避免无限递归。
    if (visiting.has(id)) return 0;
    const task = byId.get(id);
    if (!task || task.dependsOn.length === 0) {
      depthCache.set(id, 0);
      return 0;
    }
    visiting.add(id);
    const depth = Math.max(...task.dependsOn.filter((dep) => byId.has(dep)).map((dep) => depthOf(dep) + 1), 0);
    visiting.delete(id);
    depthCache.set(id, depth);
    return depth;
  };

  const perDepthCount = new Map<number, number>();
  return tasks.map((task) => {
    const depth = depthOf(task.rowId);
    const order = perDepthCount.get(depth) ?? 0;
    perDepthCount.set(depth, order + 1);
    return { task, depth, order };
  });
};
