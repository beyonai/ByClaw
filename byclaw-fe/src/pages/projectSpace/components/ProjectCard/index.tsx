import { Card, Tag } from 'antd';
import { FolderOpenOutlined } from '@ant-design/icons';
import classNames from 'classnames';
import { PROJECT_TYPE_LABEL } from '../../constants';
import type { ProjectSpace } from '../../types';
import styles from '../../index.module.less';

interface Props {
  project: ProjectSpace;
  active?: boolean;
  onSelect?: (project: ProjectSpace) => void;
}

const ProjectCard: React.FC<Props> = ({ project, active, onSelect }) => {
  return (
    <Card
      hoverable
      className={classNames(styles.projectCard, { [styles.projectCardActive]: active })}
      onClick={() => onSelect?.(project)}
    >
      <div className={styles.projectCardHeader}>
        <span className={styles.projectIcon}>
          <FolderOpenOutlined />
        </span>
        <Tag bordered={false} color={project.projectType === 'develop' ? 'purple' : 'blue'}>
          {PROJECT_TYPE_LABEL[project.projectType]}
        </Tag>
      </div>
      <div className={styles.projectName}>{project.projectName}</div>
      <div className={styles.projectDesc}>{project.description || '暂无项目描述'}</div>
      <div className={styles.projectMeta}>
        <span>{project.sessionCount || 0} 会话</span>
        <span>{project.taskCount || 0} 任务</span>
        <span>{project.fileCount || 0} 文件</span>
      </div>
    </Card>
  );
};

export default ProjectCard;
