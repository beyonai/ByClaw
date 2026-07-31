import { Card, Tag } from 'antd';
import { FolderOpenOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import classNames from 'classnames';
import { PROJECT_TYPE_MESSAGE_ID } from '../../constants';
import type { ProjectSpace } from '../../types';
import styles from '../../index.module.less';

interface Props {
  project: ProjectSpace;
  active?: boolean;
  onSelect?: (project: ProjectSpace) => void;
}

const ProjectCard: React.FC<Props> = ({ project, active, onSelect }) => {
  const intl = useIntl();
  // 运营项目使用青色，与研发紫色及普通项目蓝色保持一致的类型识别。
  const projectTagColor =
    project.projectType === 'develop' ? 'purple' : project.projectType === 'operation' ? 'cyan' : 'blue';

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
        <Tag bordered={false} color={projectTagColor}>
          {intl.formatMessage({ id: PROJECT_TYPE_MESSAGE_ID[project.projectType] })}
        </Tag>
      </div>
      <div className={styles.projectName}>{project.projectName}</div>
      <div className={styles.projectDesc}>
        {project.description || intl.formatMessage({ id: 'projectSpace.projectCard.emptyDescription' })}
      </div>
      <div className={styles.projectMeta}>
        <span>
          {intl.formatMessage({ id: 'projectSpace.projectCard.sessionCount' }, { count: project.sessionCount || 0 })}
        </span>
        <span>
          {intl.formatMessage({ id: 'projectSpace.projectCard.taskCount' }, { count: project.taskCount || 0 })}
        </span>
        <span>
          {intl.formatMessage({ id: 'projectSpace.projectCard.fileCount' }, { count: project.fileCount || 0 })}
        </span>
      </div>
    </Card>
  );
};

export default ProjectCard;
