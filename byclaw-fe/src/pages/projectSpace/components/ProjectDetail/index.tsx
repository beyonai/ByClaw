import { Button, Segmented, Spin, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useEffect, useMemo, useState } from 'react';
import { useIntl } from '@umijs/max';
import { PROJECT_DETAIL_SECTIONS, type ProjectDetailSection } from '../../constants';
import { useProjectSessions } from '../../hooks/useProjectSessions';
import { useProjectTypeConfig } from '../../hooks/useProjectTypeConfig';
import type { ProjectSession, ProjectSpace } from '../../types';
import ProjectMembers from '../ProjectMembers';
import ProjectRequirements from '../ProjectRequirements';
import ProjectResources from '../ProjectResources';
import ProjectSessionList from '../ProjectSessionList';
import ProjectTasks from '../ProjectTasks';
import styles from '../../index.module.less';

interface Props {
  project?: ProjectSpace;
  loading?: boolean;
  onRefresh?: () => void;
  onOpenSession?: (session: ProjectSession) => void;
}

const ProjectDetail: React.FC<Props> = ({ project, loading, onRefresh, onOpenSession }) => {
  const intl = useIntl();
  const [activeSection, setActiveSection] = useState<ProjectDetailSection>('sessions');
  const { sessions, total } = useProjectSessions(project);
  const { isDevelopProjectEnabled, isOperationProjectEnabled } = useProjectTypeConfig();
  // 研发和运营能力均以静态参数为准，避免未启用环境误展示对应的业务分区。
  const isDevelopProject = isDevelopProjectEnabled && project?.projectType === 'develop';
  const isOperationProject = isOperationProjectEnabled && project?.projectType === 'operation';
  // 运营项目只保留任务、资源和成员，研发项目才展示需求；普通共享项目仍可查看成员。
  const showRequirementsSection = isDevelopProject;
  const showMembersSection = isDevelopProject || isOperationProject || !!project?.sharedFlag;
  const showSessionsSection = !isOperationProject;
  const detailSections = useMemo(
    () =>
      PROJECT_DETAIL_SECTIONS.filter((item) => {
        if (item.key === 'sessions') return showSessionsSection;
        if (item.key === 'members') return showMembersSection;
        if (item.key === 'requirements') return showRequirementsSection;
        return true;
      }),
    [showMembersSection, showRequirementsSection, showSessionsSection]
  );

  useEffect(() => {
    // 运营项目不展示会话页，其他项目隐藏成员或需求页时回退到首个可见分区。
    const currentTabHidden =
      (!showSessionsSection && activeSection === 'sessions') ||
      (!showMembersSection && activeSection === 'members') ||
      (!showRequirementsSection && activeSection === 'requirements');
    if (currentTabHidden) {
      setActiveSection(showSessionsSection ? 'sessions' : 'tasks');
    }
  }, [activeSection, showMembersSection, showRequirementsSection, showSessionsSection]);

  if (!project) {
    return <div className={styles.detailEmpty}>{intl.formatMessage({ id: 'projectSpace.selectProject' })}</div>;
  }

  const renderSessionList = () => (
    <ProjectSessionList sessions={sessions} loading={loading} onRefresh={onRefresh} onOpenSession={onOpenSession} />
  );

  const renderContent = () => {
    if (activeSection === 'sessions') {
      return renderSessionList();
    }
    if (activeSection === 'tasks') return <ProjectTasks />;
    if (activeSection === 'resources') return <ProjectResources />;
    if (activeSection === 'members') {
      return showMembersSection ? <ProjectMembers /> : renderSessionList();
    }
    return showRequirementsSection ? <ProjectRequirements /> : renderSessionList();
  };

  return (
    <section className={styles.detail}>
      <div className={styles.detailHeader}>
        <div>
          <Typography.Title level={3}>{project.projectName}</Typography.Title>
          <Typography.Text type="secondary">
            {project.description || intl.formatMessage({ id: 'projectSpace.projectCard.emptyDescription' })}
            {showSessionsSection && (
              <>
                {' · '}
                {intl.formatMessage({ id: 'projectSpace.projectCard.sessionCount' }, { count: total })}
              </>
            )}
          </Typography.Text>
        </div>
        <div className={styles.detailHeaderActions}>
          <Button icon={<ReloadOutlined />} onClick={onRefresh}>
            {intl.formatMessage({ id: 'projectSpace.detail.refresh' })}
          </Button>
          <Segmented
            value={activeSection}
            options={detailSections.map((item) => ({
              label: intl.formatMessage({ id: item.labelId }),
              value: item.key,
            }))}
            onChange={(value) => setActiveSection(value as ProjectDetailSection)}
          />
        </div>
      </div>
      <div className={styles.detailBody}>
        <Spin spinning={!!loading}>{renderContent()}</Spin>
      </div>
    </section>
  );
};

export default ProjectDetail;
