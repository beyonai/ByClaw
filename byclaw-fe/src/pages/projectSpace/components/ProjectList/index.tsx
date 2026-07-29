import { Empty, Spin } from 'antd';
import ProjectCard from '../ProjectCard';
import type { ProjectSpace } from '../../types';
import styles from '../../index.module.less';

interface Props {
  projects: ProjectSpace[];
  loading?: boolean;
  activeProjectId?: string;
  onSelectProject?: (project: ProjectSpace) => void;
}

const ProjectList: React.FC<Props> = ({ projects, loading, activeProjectId, onSelectProject }) => {
  return (
    <Spin spinning={!!loading}>
      {projects.length ? (
        <div className={styles.projectGrid}>
          {projects.map((project) => (
            <ProjectCard
              key={project.projectId}
              project={project}
              active={project.projectId === activeProjectId}
              onSelect={onSelectProject}
            />
          ))}
        </div>
      ) : (
        <Empty description="暂无项目空间" />
      )}
    </Spin>
  );
};

export default ProjectList;
