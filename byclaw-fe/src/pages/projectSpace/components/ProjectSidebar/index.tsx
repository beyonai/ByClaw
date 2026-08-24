import { Button, Empty, Input, Spin, Tag } from 'antd';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import classNames from 'classnames';
import type { ProjectSpace } from '../../types';
import { getProjectTagMeta } from '../../utils';
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
            projects.map((project) => {
              const projectTag = getProjectTagMeta(project);
              return (
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
                  <Tag
                    bordered={false}
                    className={classNames(styles.projectTypeTag, styles[`projectTypeTag${projectTag.classSuffix}`])}
                  >
                    {intl.formatMessage({ id: projectTag.messageId })}
                  </Tag>
                </button>
              );
            })
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
