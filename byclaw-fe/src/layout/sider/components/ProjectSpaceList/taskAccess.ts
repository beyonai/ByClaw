export const isCurrentUserTaskAssignee = (task: any, userInfo: any) => {
  const taskAssigneeId = task?.assigneeId ?? task?.createBy;
  const currentUserId = userInfo?.userId ?? userInfo?.id;
  if (
    taskAssigneeId !== null &&
    taskAssigneeId !== undefined &&
    currentUserId !== null &&
    currentUserId !== undefined
  ) {
    return `${taskAssigneeId}` === `${currentUserId}`;
  }

  const taskAssignee = task?.assignee || task?.assigneeName || task?.agentName;
  return Boolean(taskAssignee && userInfo?.userName && taskAssignee === userInfo.userName);
};
