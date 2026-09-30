type ProjectNameCandidate = {
  projectId: string | number;
  projectName: string;
  createBy?: string | number;
};

// 可见列表包含他人共享项目；名称仅在同一创建者的项目中查重，最终由接口校验。
export const hasDuplicateProjectName = (
  projects: ProjectNameCandidate[],
  projectName: string,
  creatorId?: string | number,
  excludeProjectId?: string | number
) =>
  creatorId !== undefined &&
  creatorId !== null &&
  projects.some(
    (project) =>
      `${project.createBy}` === `${creatorId}` &&
      `${project.projectId}` !== `${excludeProjectId}` &&
      project.projectName.trim() === projectName.trim()
  );

// 请求层将业务错误的 msg 以字符串 reject，也兼容保留响应体的错误对象。
export const getProjectMutationErrorMessage = (error: unknown, fallback: string): string => {
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error === 'object') {
    const record = error as Record<string, any>;
    const candidates = [
      record.msg,
      record.data?.msg,
      record.response?.data?.msg,
      record.message,
      record.response?.data?.message,
    ];
    return candidates.find((value) => typeof value === 'string' && value.trim()) || fallback;
  }
  return fallback;
};
