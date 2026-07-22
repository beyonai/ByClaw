import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Tooltip, message } from 'antd';
import { FolderOpenOutlined, FundProjectionScreenOutlined } from '@ant-design/icons';
import { getProject } from '@/service/devloop';
import { useActiveSiderAgent } from '@/layout/sider/components/ActiveSiderAgentBar';
import TaskDetailDrawer from '@/layout/sider/components/ProjectSpaceList/TaskDetailDrawer';
import ProjectSessionResultDrawer from './ProjectSessionResultDrawer';
import styles from './ChatTitle.module.less';

type ProjectSessionActionsProps = {
  projectId?: number;
  sessionId?: string;
  sessionName?: string;
};

const getResponseData = (response: any) => response?.data ?? response;

const ProjectSessionActions: React.FC<ProjectSessionActionsProps> = ({ projectId, sessionId, sessionName }) => {
  const activeSiderAgent = useActiveSiderAgent();
  const [project, setProject] = useState<any>(null);
  const [taskDetail, setTaskDetail] = useState<any>(null);
  const [taskProgressTooltipOpen, setTaskProgressTooltipOpen] = useState(false);
  const [resultDrawerOpen, setResultDrawerOpen] = useState(false);

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

  const resourceId = useMemo(
    () => activeSiderAgent.resourceId || (project?.resourceId ? `${project.resourceId}` : ''),
    [activeSiderAgent.resourceId, project?.resourceId]
  );
  // 兼容旧环境仍返回 development 的项目类型；仅研发项目展示任务进度入口。
  const isDevelopmentProject = project?.projectType === 'develop' || project?.projectType === 'development';

  const handleOpenTaskProgress = useCallback(() => {
    // 点击后立即关闭悬浮提示，避免抽屉打开时 Tooltip 停留在按钮上方。
    setTaskProgressTooltipOpen(false);
    const numericSessionId = Number(sessionId);
    if (!Number.isFinite(numericSessionId) || numericSessionId <= 0) {
      message.warning('未找到任务会话');
      return;
    }

    // 与任务列表的“查看详情”一致，抽屉自身按会话 ID 读取研发阶段，不再额外请求任务详情。
    setTaskDetail({
      taskId: numericSessionId,
      sessionId: numericSessionId,
      projectId,
      title: sessionName || '任务详情',
    });
  }, [projectId, sessionId, sessionName]);

  const handleTaskProgressTooltipOpenChange = (open: boolean) => {
    // 任务详情已打开时不再展示提示，防止鼠标仍停留在按钮上导致 Tooltip 重新出现。
    setTaskProgressTooltipOpen(open && !taskDetail);
  };

  // 任务成果面向全部会话展示；任务进度仅在研发项目中提供。
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
              className={styles.projectActionButton}
              icon={<FundProjectionScreenOutlined />}
              onClick={handleOpenTaskProgress}
            />
          </Tooltip>
        )}
        <Tooltip title="任务成果" placement="bottom">
          <Button
            type="text"
            className={styles.projectActionButton}
            icon={<FolderOpenOutlined />}
            onClick={() => setResultDrawerOpen(true)}
          />
        </Tooltip>
      </span>
      <TaskDetailDrawer task={taskDetail} onClose={() => setTaskDetail(null)} />
      <ProjectSessionResultDrawer
        open={resultDrawerOpen}
        resourceId={resourceId}
        sessionId={sessionId}
        sessionName={sessionName}
        onClose={() => setResultDrawerOpen(false)}
      />
    </>
  );
};

export default ProjectSessionActions;
