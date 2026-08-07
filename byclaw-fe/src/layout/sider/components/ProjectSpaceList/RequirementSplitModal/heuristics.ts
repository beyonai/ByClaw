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

// 降级草稿:每个仓库一行,标题沿用需求标题,不猜依赖、不猜仓库职责顺序、不标 AI。
// 只在后端预拆不可用时使用(模型未配置/调用失败/输出不可解析,或运营任务入口没有需求ID)。
// 真正的拆分由后端 /task/presplit 按系统提示词交给大模型产出,不在前端做正则启发式。
export const buildFallbackSplit = (title: string, repos: RepoOption[]): SplitTaskDraft[] => {
  const branch = suggestBranch(title);
  if (!repos.length) {
    return [{ rowId: 'row-0', title, repoId: undefined, branch, dependsOn: [], aiSuggested: false }];
  }
  return repos.map((repo, idx) => ({
    rowId: `row-${idx}`,
    title,
    repoId: repo.repoId,
    branch,
    dependsOn: [],
    aiSuggested: false,
  }));
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
