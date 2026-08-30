import React from 'react';
import { useIntl, useLocation, useNavigate } from '@umijs/max';
import AutomationEditor from '@/pages/automation/components/AutomationEditor';

/** 项目模块复用自动化的新建定时任务页面。 */
const ProjectScheduleTaskCreate: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const intl = useIntl();
  const searchParams = new URLSearchParams(location.search || '');
  const projectId = searchParams.get('projectId') || undefined;
  const projectName = searchParams.get('projectName') || undefined;
  const backToProject = () => {
    navigate(projectId ? `/projectSpace?projectId=${encodeURIComponent(projectId)}` : '/projectSpace');
  };

  return (
    <AutomationEditor
      projectId={projectId}
      breadcrumbLabel={projectName || intl.formatMessage({ id: 'sider.projectSpace', defaultMessage: '项目' })}
      onCancel={backToProject}
      onSaved={backToProject}
    />
  );
};

export default ProjectScheduleTaskCreate;
