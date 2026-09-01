import { Card } from 'antd';
import { ShareAltOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import classNames from 'classnames';
import type { ProjectSpace } from '../../types';
import styles from '../../index.module.less';

interface Props {
  project: ProjectSpace;
  active?: boolean;
  onSelect?: (project: ProjectSpace) => void;
}

const ProjectCard: React.FC<Props> = ({ project, active, onSelect }) => {
  const intl = useIntl();

  return (
    <Card
      hoverable
      className={classNames(styles.projectCard, { [styles.projectCardActive]: active })}
      onClick={() => onSelect?.(project)}
    >
      <div className={styles.projectCardHeader}>
        <span className={styles.projectIcon}>
          <ShareAltOutlined />
        </span>
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
