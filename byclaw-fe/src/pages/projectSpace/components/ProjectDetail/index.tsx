import { Button, Segmented, Spin, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { PROJECT_DETAIL_SECTIONS, type ProjectDetailSection } from '../../constants';
import { useProjectSessions } from '../../hooks/useProjectSessions';
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
  const [activeSection, setActiveSection] = useState<ProjectDetailSection>('sessions');
  const { sessions, total } = useProjectSessions(project);

  if (!project) {
    return <div className={styles.detailEmpty}>请选择一个项目空间</div>;
  }

  const renderContent = () => {
    if (activeSection === 'sessions') {
      return (
        <ProjectSessionList sessions={sessions} loading={loading} onRefresh={onRefresh} onOpenSession={onOpenSession} />
      );
    }
    if (activeSection === 'tasks') return <ProjectTasks />;
    if (activeSection === 'resources') return <ProjectResources />;
    if (activeSection === 'members') return <ProjectMembers />;
    return <ProjectRequirements />;
  };

  return (
    <section className={styles.detail}>
      <div className={styles.detailHeader}>
        <div>
          <Typography.Title level={3}>{project.projectName}</Typography.Title>
          <Typography.Text type="secondary">
            {project.description || '暂无项目描述'} · {total} 个会话
          </Typography.Text>
        </div>
        <div className={styles.detailHeaderActions}>
          <Button icon={<ReloadOutlined />} onClick={onRefresh}>
            刷新详情
          </Button>
          <Segmented
            value={activeSection}
            options={PROJECT_DETAIL_SECTIONS.map((item) => ({ label: item.label, value: item.key }))}
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
