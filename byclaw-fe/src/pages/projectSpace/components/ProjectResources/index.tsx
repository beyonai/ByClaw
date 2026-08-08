import { Button, Empty, Spin, Typography, message } from 'antd';
import {
  ApartmentOutlined,
  DatabaseOutlined,
  FileTextOutlined,
  GithubOutlined,
  PlusOutlined,
  RightOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useCallback, useEffect, useState } from 'react';
import { useIntl } from '@umijs/max';
import { listProjectResources, listProjectSpaceFiles, type DevloopProjectSpaceFile } from '@/service/devloop';
import type { ProjectBoundResource, ProjectSpace } from '../../types';
import styles from '../../index.module.less';

interface Props {
  project: ProjectSpace;
  onRefreshToolbarChange?: (toolbar: React.ReactNode | null) => void;
}

// 项目资源页使用独立轻量列表，避免把侧栏完整页面嵌入四列卡片后产生宽度和定位冲突。
const ProjectResources: React.FC<Props> = ({ project, onRefreshToolbarChange }) => {
  const intl = useIntl();
  const [files, setFiles] = useState<DevloopProjectSpaceFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [boundResources, setBoundResources] = useState<ProjectBoundResource[]>(
    project.resources || project.boundResources || []
  );
  const [loadingBoundResources, setLoadingBoundResources] = useState(false);

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

  const loadBoundResources = useCallback(async () => {
    setLoadingBoundResources(true);
    try {
      const response = await listProjectResources(Number(project.projectId));
      const rows = Array.isArray(response)
        ? response
        : Array.isArray(response?.data)
          ? response.data
          : response?.list || response?.rows || response?.data?.list || response?.data?.rows || [];
      setBoundResources(rows);
    } catch (error: any) {
      setBoundResources([]);
      message.error(error?.message || intl.formatMessage({ id: 'projectSpace.resources.loadBindingsFailed' }));
    } finally {
      setLoadingBoundResources(false);
    }
  }, [intl, project.projectId]);

  useEffect(() => {
    void loadFiles();
    void loadBoundResources();
  }, [loadBoundResources, loadFiles]);

  useEffect(() => {
    // 资源 Tab 的刷新入口统一放到项目详情顶部，同时刷新共享文件与项目绑定资源。
    onRefreshToolbarChange?.(
      <Button
        size="small"
        icon={<ReloadOutlined />}
        loading={loadingFiles || loadingBoundResources}
        onClick={() => {
          void loadFiles();
          void loadBoundResources();
        }}
      >
        {intl.formatMessage({ id: 'projectSpace.detail.refresh' })}
      </Button>
    );
    return () => onRefreshToolbarChange?.(null);
  }, [intl, loadBoundResources, loadFiles, loadingBoundResources, loadingFiles, onRefreshToolbarChange]);

  const renderCardHeader = (icon: React.ReactNode, title: string, description: string, showAdd = true) => (
    <header className={styles.resourceCardHeader}>
      <div className={styles.resourceCardTitleBlock}>
        <span className={styles.resourceCardIcon}>{icon}</span>
        <div>
          <Typography.Title level={4}>{title}</Typography.Title>
          <Typography.Text type="secondary">{description}</Typography.Text>
        </div>
      </div>
      {showAdd && (
        <Button type="text" size="small" icon={<PlusOutlined />} className={styles.resourceCardAddButton}>
          {intl.formatMessage({ id: 'common.add' })}
        </Button>
      )}
    </header>
  );

  const empty = (
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={intl.formatMessage({ id: 'chatResource.empty' })} />
  );
  const boundKnowledge = boundResources.filter((resource) => resource.resourceType === 'knowledge');
  const boundOntologies = boundResources.filter((resource) => resource.resourceType === 'ontology');

  return (
    <div className={styles.resourceCategoryGrid}>
      <section className={styles.resourceCategoryCard}>
        {renderCardHeader(
          <FileTextOutlined />,
          intl.formatMessage({ id: 'projectSpace.detail.resource.sharedSpace' }),
          intl.formatMessage({ id: 'projectSpace.resources.sharedFilesDescription' }),
          false
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
        <Spin spinning={loadingBoundResources} className={styles.resourceCategoryBody}>
          {boundKnowledge.length
            ? boundKnowledge.map((resource) => (
                <div key={`${resource.resourceId}`} className={styles.resourceSimpleItem}>
                  <span className={styles.resourceSimpleIcon}>KB</span>
                  <div className={styles.resourceSimpleMain}>
                    <Typography.Text strong ellipsis={{ tooltip: resource.resourceName }}>
                      {resource.resourceName || resource.resourceId}
                    </Typography.Text>
                    <Typography.Text type="secondary" ellipsis>
                      当前项目绑定知识库
                    </Typography.Text>
                  </div>
                  <RightOutlined />
                </div>
              ))
            : !loadingBoundResources && empty}
        </Spin>
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
        <Spin spinning={loadingBoundResources} className={styles.resourceCategoryBody}>
          {boundOntologies.length
            ? boundOntologies.map((resource) => (
                <div key={`${resource.resourceId}`} className={styles.resourceSimpleItem}>
                  <span className={styles.resourceSimpleIcon}>ONTO</span>
                  <div className={styles.resourceSimpleMain}>
                    <Typography.Text strong ellipsis={{ tooltip: resource.resourceName }}>
                      {resource.resourceName || resource.resourceId}
                    </Typography.Text>
                    <Typography.Text type="secondary" ellipsis>
                      当前项目绑定本体
                    </Typography.Text>
                  </div>
                  <RightOutlined />
                </div>
              ))
            : !loadingBoundResources && empty}
        </Spin>
      </section>
    </div>
  );
};

export default ProjectResources;
