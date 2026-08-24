import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Tooltip, message } from 'antd';
import { FundProjectionScreenOutlined } from '@ant-design/icons';
import { useSelector } from '@umijs/max';
import { getProject, getTaskDetail } from '@/service/devloop';
import TaskDetailDrawer from '@/layout/sider/components/ProjectSpaceList/TaskDetailDrawer';
import { isCurrentUserTaskAssignee } from '@/layout/sider/components/ProjectSpaceList/taskAccess';
import styles from './ChatTitle.module.less';

type ProjectSessionActionsProps = {
  projectId?: number;
  sessionId?: string;
  sessionName?: string;
};

const getResponseData = (response: any) => response?.data ?? response;

const ProjectSessionActions: React.FC<ProjectSessionActionsProps> = ({ projectId, sessionId, sessionName }) => {
  const userInfo = useSelector(({ user }: any) => user.userInfo);
  const [project, setProject] = useState<any>(null);
  const [taskDetail, setTaskDetail] = useState<any>(null);
  const [taskLoading, setTaskLoading] = useState(false);
  const [taskProgressTooltipOpen, setTaskProgressTooltipOpen] = useState(false);

  useEffect(() => {
    if (!projectId) {
      setProject(null);
      return;
    }

    let cancelled = false;
    // 有项目归属时补充当前会话的项目数据，避免左侧项目下拉切换影响已打开会话的文件空间。
    getProject(projectId)
      .then((response) => {
        if (!cancelled) {
          setProject(getResponseData(response));
        }
      })
      .catch((error) => {
        console.error('Failed to load project session context:', error);
        if (!cancelled) {
          setProject(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // 兼容旧环境仍返回 development 的项目类型；仅研发项目展示任务进度入口。
  const isDevelopmentProject = project?.projectType === 'develop' || project?.projectType === 'development';
  const canEnterTaskSession = useMemo(() => isCurrentUserTaskAssignee(taskDetail, userInfo), [taskDetail, userInfo]);

  const handleOpenTaskProgress = useCallback(async () => {
    // 点击后立即关闭悬浮提示，避免抽屉打开时 Tooltip 停留在按钮上方。
    setTaskProgressTooltipOpen(false);
    const numericSessionId = Number(sessionId);
    if (!Number.isFinite(numericSessionId) || numericSessionId <= 0) {
      message.warning('未找到任务会话');
      return;
    }

    setTaskLoading(true);
    try {
      const response = await getTaskDetail(numericSessionId);
      const task = getResponseData(response);
      if (!task || task?.success === false) {
        message.warning('当前会话暂无关联任务');
        return;
      }

      // 会话入口只持有基础会话信息，需以任务详情接口回填执行上下文。
      setTaskDetail({
        ...task,
        projectId: task.projectId ?? projectId,
        sessionId: task.sessionId || numericSessionId,
        title: task.title || task.taskName || sessionName || '任务详情',
      });
    } catch (error) {
      console.error('Failed to load task progress:', error);
      message.error('任务进度加载失败');
    } finally {
      setTaskLoading(false);
    }
  }, [projectId, sessionId, sessionName]);

  const handleTaskProgressTooltipOpenChange = (open: boolean) => {
    // 任务详情已打开时不再展示提示，防止鼠标仍停留在按钮上导致 Tooltip 重新出现。
    setTaskProgressTooltipOpen(open && !taskLoading && !taskDetail);
  };

  // 任务成果已统一由会话资源面板承接，这里仅保留研发项目的任务进度入口。
  if (!sessionId) return null;

  return (
    <>
      <span className={styles.projectSessionActions}>
        {isDevelopmentProject && (
          <Tooltip
            title="任务进度"
            placement="bottom"
            open={taskProgressTooltipOpen}
            onOpenChange={handleTaskProgressTooltipOpenChange}
          >
            <Button
              type="text"
              className={`${styles.projectActionButton} ${styles.taskProgressButton}`}
              icon={<FundProjectionScreenOutlined />}
              loading={taskLoading}
              onClick={handleOpenTaskProgress}
            />
          </Tooltip>
        )}
      </span>
      <TaskDetailDrawer
        task={taskDetail}
        onClose={() => setTaskDetail(null)}
        canEnterSession={canEnterTaskSession}
        onEnterSession={() => setTaskDetail(null)}
      />
    </>
  );
};

export default ProjectSessionActions;
