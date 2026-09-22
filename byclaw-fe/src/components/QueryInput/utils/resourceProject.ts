interface ResourceProjectContext {
  sessionId?: string;
  isBottom?: boolean;
  projectId?: number;
  projectCloudResourceId?: string | number;
  selectedProject?: { projectId: string; cloudResourceId?: string | number };
}

/** 新任务资源跟随下方项目选择；已有会话仍使用会话归属，与发送时的项目选择规则一致。 */
export const getInputResourceProject = (context: ResourceProjectContext) => {
  const { selectedProject, sessionId, isBottom, projectId, projectCloudResourceId } = context;
  if (selectedProject && (!sessionId || isBottom === false || projectId === undefined)) {
    return {
      projectId: Number(selectedProject.projectId),
      // 新项目未携带云盘 ID 时由项目详情补齐，不能回退到上一会话的云盘。
      projectCloudResourceId: selectedProject.cloudResourceId,
    };
  }
  return { projectId, projectCloudResourceId };
};
