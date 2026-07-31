// 项目仓库选项(与 ProjectDetailModal 的 RepoOption 结构对齐,只取拆单需要的字段)。
export type RepoOption = {
  repoId: number;
  repoFullName: string;
  repoUrl?: string;
  defaultBranch?: string;
};

// 成员选项(与 ProjectDetailModal 的 operationAssigneeOptions 结构对齐:value=userId, label=用户名)。
// 承接人从项目成员里选,才能和原有启动/任务负责人逻辑对得上。
export type MemberOption = {
  value: string | number;
  label: string;
};

// 拆单草稿:一个需求拆出的一条多仓库任务,即依赖图里的一个节点。
// 落库前的编辑态,rowId 既是前端列表 key,也是图里节点 id、依赖引用的目标。
export type SplitTaskDraft = {
  rowId: string;
  // 任务标题:需求 1 对多任务后,每个任务要有自己的标题,不再直接沿用需求标题。
  title: string;
  repoId?: number;
  branch: string;
  // 承接该任务的项目成员 id(对应任务负责人)。
  assigneeId?: string | number;
  // 依赖的上游任务 rowId 列表:构成需求内的有向依赖图(DAG)。空数组=无上游,可最先开工。
  dependsOn: string[];
  // 是否由 AI 预拆生成(用户手动新增的为 false),仅用于标记来源。
  aiSuggested: boolean;
};

// 布局后的节点:在 buildLayers 里按拓扑深度分层,depth=列,order=同层内的行序。
export type LayoutNode = {
  task: SplitTaskDraft;
  depth: number;
  order: number;
};
