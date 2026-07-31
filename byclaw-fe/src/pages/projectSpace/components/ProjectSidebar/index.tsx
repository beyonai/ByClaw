import { Button, Empty, Input, Spin, Tag } from 'antd';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import classNames from 'classnames';
import { PROJECT_TYPE_MESSAGE_ID } from '../../constants';
import type { ProjectSpace } from '../../types';
import styles from '../../index.module.less';

interface Props {
  projects: ProjectSpace[];
  loading?: boolean;
  keyword: string;
  activeProjectId?: string;
  onKeywordChange: (value: string) => void;
  onCreateProject: () => void;
  onSelectProject: (project: ProjectSpace) => void;
}

// 项目类型标签在卡片和侧栏保持同一套颜色语义，避免同一项目在不同入口识别不一致。
const getProjectTagColor = (project: ProjectSpace) => {
  if (project.projectType === 'develop') return 'purple';
  if (project.projectType === 'operation') return 'cyan';
  return 'blue';
};

const ProjectSidebar: React.FC<Props> = ({
  projects,
  loading,
  keyword,
  activeProjectId,
  onKeywordChange,
  onCreateProject,
  onSelectProject,
}) => {
  const intl = useIntl();

  return (
    <aside className={styles.sidebar}>
      <div className={styles.sidebarHeader}>
        <Input
          allowClear
          value={keyword}
          prefix={<SearchOutlined />}
          placeholder={intl.formatMessage({ id: 'projectSpace.sidebar.searchPlaceholder' })}
          onChange={(event) => onKeywordChange(event.target.value)}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={onCreateProject}>
          {intl.formatMessage({ id: 'projectSpace.createProject' })}
        </Button>
      </div>
      <Spin spinning={!!loading}>
        <div className={styles.sidebarList}>
          {projects.length ? (
            projects.map((project) => (
              <button
                type="button"
                key={project.projectId}
                className={classNames(styles.sidebarProject, {
                  [styles.sidebarProjectActive]: project.projectId === activeProjectId,
                })}
                onClick={() => onSelectProject(project)}
              >
                <span className={styles.sidebarProjectMain}>
                  <strong>{project.projectName}</strong>
                  <small>
                    {project.description || intl.formatMessage({ id: 'projectSpace.projectCard.emptyDescription' })}
                  </small>
                </span>
                <Tag bordered={false} color={getProjectTagColor(project)}>
                  {intl.formatMessage({ id: PROJECT_TYPE_MESSAGE_ID[project.projectType] })}
                </Tag>
              </button>
            ))
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={intl.formatMessage({ id: 'projectSpace.emptyProjects' })}
            />
          )}
        </div>
      </Spin>
    </aside>
  );
};

export default ProjectSidebar;
