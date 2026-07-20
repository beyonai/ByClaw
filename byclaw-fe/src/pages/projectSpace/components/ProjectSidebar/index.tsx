import { Button, Empty, Input, Spin, Tag } from 'antd';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import classNames from 'classnames';
import { PROJECT_TYPE_LABEL } from '../../constants';
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

const ProjectSidebar: React.FC<Props> = ({
  projects,
  loading,
  keyword,
  activeProjectId,
  onKeywordChange,
  onCreateProject,
  onSelectProject,
}) => {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.sidebarHeader}>
        <Input
          allowClear
          value={keyword}
          prefix={<SearchOutlined />}
          placeholder="搜索项目或会话"
          onChange={(event) => onKeywordChange(event.target.value)}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={onCreateProject}>
          新建项目
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
                  <small>{project.description || '暂无项目描述'}</small>
                </span>
                <Tag bordered={false} color={project.projectType === 'develop' ? 'purple' : 'blue'}>
                  {PROJECT_TYPE_LABEL[project.projectType]}
                </Tag>
              </button>
            ))
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无项目空间" />
          )}
        </div>
      </Spin>
    </aside>
  );
};

export default ProjectSidebar;
