import { Button, Empty, Spin, Typography, message } from 'antd';
import {
  ApartmentOutlined,
  DatabaseOutlined,
  FileTextOutlined,
  GithubOutlined,
  PlusOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { useCallback, useEffect, useState } from 'react';
import { useIntl } from '@umijs/max';
import { listProjectSpaceFiles, type DevloopProjectSpaceFile } from '@/service/devloop';
import ObjectFilesPanel from '@/components/ChatLayoutComp/ChatResourceWorkspace/ObjectFilesPanel';
import type { ProjectSpace } from '../../types';
import styles from '../../index.module.less';

interface Props {
  project: ProjectSpace;
}

// 项目资源页使用独立轻量列表，避免把侧栏完整页面嵌入四列卡片后产生宽度和定位冲突。
const ProjectResources: React.FC<Props> = ({ project }) => {
  const intl = useIntl();
  const [files, setFiles] = useState<DevloopProjectSpaceFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);

  const loadFiles = useCallback(async () => {
    setLoadingFiles(true);
    try {
      setFiles((await listProjectSpaceFiles(Number(project.projectId))) || []);
    } catch (error: any) {
      setFiles([]);
      message.error(error?.message || intl.formatMessage({ id: 'projectSpace.resources.loadFilesFailed' }));
    } finally {
      setLoadingFiles(false);
    }
  }, [intl, project.projectId]);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  const renderCardHeader = (icon: React.ReactNode, title: string, description: string) => (
    <header className={styles.resourceCardHeader}>
      <div className={styles.resourceCardTitleBlock}>
        <span className={styles.resourceCardIcon}>{icon}</span>
        <div>
          <Typography.Title level={4}>{title}</Typography.Title>
          <Typography.Text type="secondary">{description}</Typography.Text>
        </div>
      </div>
      <Button type="text" size="small" icon={<PlusOutlined />} className={styles.resourceCardAddButton}>
        {intl.formatMessage({ id: 'common.add' })}
      </Button>
    </header>
  );

  const empty = (
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={intl.formatMessage({ id: 'chatResource.empty' })} />
  );

  return (
    <div className={styles.resourceCategoryGrid}>
      <section className={styles.resourceCategoryCard}>
        {renderCardHeader(
          <FileTextOutlined />,
          intl.formatMessage({ id: 'projectSpace.detail.resource.sharedSpace' }),
          intl.formatMessage({ id: 'projectSpace.resources.sharedFilesDescription' })
        )}
        <Spin spinning={loadingFiles} className={styles.resourceCategoryBody}>
          {files.length
            ? files.map((file) => (
              <div key={file.fileId} className={styles.resourceSimpleItem}>
                <span className={styles.resourceSimpleIcon}>DOC</span>
                <div className={styles.resourceSimpleMain}>
                  <Typography.Text strong ellipsis={{ tooltip: file.fileName }}>
                    {file.fileName}
                  </Typography.Text>
                  <Typography.Text type="secondary" ellipsis>
                    {file.fileUrl || intl.formatMessage({ id: 'projectSpace.detail.resource.sharedSpace' })}
                  </Typography.Text>
                </div>
                <RightOutlined />
              </div>
            ))
            : !loadingFiles && empty}
        </Spin>
      </section>

      <section className={styles.resourceCategoryCard}>
        {renderCardHeader(
          <DatabaseOutlined />,
          intl.formatMessage({ id: 'projectSpace.resources.sharedKnowledge' }),
          intl.formatMessage({ id: 'projectSpace.resources.sharedKnowledgeDescription' })
        )}
        <div className={styles.resourceCategoryBody}>{empty}</div>
      </section>

      <section className={styles.resourceCategoryCard}>
        {renderCardHeader(
          <GithubOutlined />,
          intl.formatMessage({ id: 'projectSpace.resources.sharedCode' }),
          intl.formatMessage({ id: 'projectSpace.resources.sharedCodeDescription' })
        )}
        <div className={styles.resourceCategoryBody}>
          {project.projectType === 'develop' && project.repos?.length
            ? project.repos.map((repo) => (
              <div key={`${repo.repoId || repo.repoFullName}`} className={styles.resourceSimpleItem}>
                <span className={`${styles.resourceSimpleIcon} ${styles.resourceRepoIcon}`}>
                  <GithubOutlined />
                </span>
                <div className={styles.resourceSimpleMain}>
                  <Typography.Text strong ellipsis={{ tooltip: repo.repoFullName }}>
                    {repo.repoFullName}
                  </Typography.Text>
                  <Typography.Text type="secondary" ellipsis>
                    {repo.repoUrl || repo.defaultBranch || '-'}
                  </Typography.Text>
                </div>
                <RightOutlined />
              </div>
            ))
            : empty}
        </div>
      </section>

      <section className={styles.resourceCategoryCard}>
        {renderCardHeader(
          <ApartmentOutlined />,
          intl.formatMessage({ id: 'projectSpace.resources.sharedOntology' }),
          intl.formatMessage({ id: 'projectSpace.resources.sharedOntologyDescription' })
        )}
        <ObjectFilesPanel projectId={project.projectId} />
      </section>
    </div>
  );
};

export default ProjectResources;
