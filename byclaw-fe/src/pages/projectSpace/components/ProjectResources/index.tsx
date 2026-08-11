import { Button, Drawer, Dropdown, Empty, Modal, Select, Spin, Typography, message } from 'antd';
import {
  ApartmentOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  EditOutlined,
  FileTextOutlined,
  GithubOutlined,
  MoreOutlined,
  PlusOutlined,
  ReloadOutlined,
  RightOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useIntl } from '@umijs/max';
import { getAgentChatAvatar } from '@/utils/agent';
import AntdIcon from '@/components/AntdIcon';
import { getFileIconType } from '@/constants/icon';
import {
  listProjectRepos,
  listProjectResources,
  listProjectSpaceFiles,
  deleteProjectRepo,
  saveProjectResources,
  type DevloopProjectRepo,
  type DevloopProjectSpaceFile,
  type ProjectResourceType,
} from '@/service/devloop';
import { listResourceUseAuth } from '@/pages/manager/service/resources';
import { listOntologyBases, pageOntologyResources } from '@/service/ontology';
import { ResourceTypeMap } from '@/constants/resource';
import FilePreviewPanel from '@/components/ChatLayoutComp/ChatResourceWorkspace/FilePreviewPanel';
import { useDigitalEmployeeOptions } from '../../hooks/useDigitalEmployeeOptions';
import type { ProjectBoundResource, ProjectSpace } from '../../types';
import styles from '../../index.module.less';

interface Props {
  project: ProjectSpace;
  onRefreshToolbarChange?: (toolbar: React.ReactNode | null) => void;

  /** 研发项目共享代码仓库新增复用项目仓库管理表单。 */
  onOpenRepositoryManager?: (repo?: DevloopProjectRepo) => void;

  /** 仓库新增/编辑后由详情页递增，确保资源卡片立即重新读取列表。 */
  repositoryRefreshVersion?: number;
}

type ResourceOption = { value: string; label: string };
type ResourceSelection = Record<ProjectResourceType, string[]>;

const EMPTY_SELECTION: ResourceSelection = {
  knowledge: [],
  digital_employee: [],
  ontology: [],
};

const getArray = (...candidates: any[]): any[] => candidates.find((candidate) => Array.isArray(candidate)) || [];

const getResourceRows = (response: any): any[] =>
  getArray(response, response?.rows, response?.list, response?.data, response?.data?.rows, response?.data?.list);

const normalizeBoundResources = (response: any): ProjectBoundResource[] =>
  getResourceRows(response).filter((resource) => resource?.resourceType && resource?.resourceId);

const ProjectResources: React.FC<Props> = ({
  project,
  onRefreshToolbarChange,
  onOpenRepositoryManager,
  repositoryRefreshVersion = 0,
}) => {
  const intl = useIntl();
  const [files, setFiles] = useState<DevloopProjectSpaceFile[]>([]);
  const [repos, setRepos] = useState<DevloopProjectRepo[]>([]);
  const [boundResources, setBoundResources] = useState<ProjectBoundResource[]>(
    project.resources || project.boundResources || []
  );
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [loadingBoundResources, setLoadingBoundResources] = useState(false);
  const [resourceOptionsLoading, setResourceOptionsLoading] = useState(false);
  const [resourceSaving, setResourceSaving] = useState(false);
  const [resourceModalOpen, setResourceModalOpen] = useState(false);
  const [previewFile, setPreviewFile] = useState<DevloopProjectSpaceFile | null>(null);
  const [knowledgeOptions, setKnowledgeOptions] = useState<ResourceOption[]>([]);
  const [ontologyOptions, setOntologyOptions] = useState<ResourceOption[]>([]);
  const [selectedResources, setSelectedResources] = useState<ResourceSelection>(EMPTY_SELECTION);
  const { options: agentOptions, loading: agentOptionsLoading } = useDigitalEmployeeOptions(
    project.projectType === 'operation'
  );
  // 项目绑定表只保存资源 ID 和名称，数字员工头像需按 ID 从员工模块数据中补齐。
  const employeeAvatarMap = useMemo(
    () => new Map(agentOptions.map((option) => [`${option.value}`, option.chatAvatar])),
    [agentOptions]
  );

  const isDevelopProject = project.projectType === 'develop';
  const isOperationProject = project.projectType === 'operation';
  // 资源分类始终在同一行等宽铺满：研发 2 类、运营 4 类，默认和普通项目仅展示共享文件。
  const resourceCategoryCount = isDevelopProject ? 2 : isOperationProject ? 4 : 1;

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

  const loadRepos = useCallback(async () => {
    if (!isDevelopProject) return;
    setLoadingRepos(true);
    try {
      setRepos((await listProjectRepos(Number(project.projectId))) || []);
    } catch (error: any) {
      setRepos([]);
      message.error(error?.message || '仓库加载失败');
    } finally {
      setLoadingRepos(false);
    }
  }, [isDevelopProject, project.projectId]);

  const loadBoundResources = useCallback(async () => {
    if (!isOperationProject) return;
    setLoadingBoundResources(true);
    try {
      const rows = normalizeBoundResources(await listProjectResources(Number(project.projectId)));
      setBoundResources(rows);
      setSelectedResources({
        knowledge: rows
          .filter((resource) => resource.resourceType === 'knowledge')
          .map((resource) => `${resource.resourceId}`),
        digital_employee: rows
          .filter((resource) => resource.resourceType === 'digital_employee')
          .map((resource) => `${resource.resourceId}`),
        ontology: rows
          .filter((resource) => resource.resourceType === 'ontology')
          .map((resource) => `${resource.resourceId}`),
      });
    } catch (error: any) {
      setBoundResources([]);
      setSelectedResources(EMPTY_SELECTION);
      message.error(error?.message || intl.formatMessage({ id: 'projectSpace.resources.loadBindingsFailed' }));
    } finally {
      setLoadingBoundResources(false);
    }
  }, [intl, isOperationProject, project.projectId]);

  useEffect(() => {
    void loadFiles();
    void loadRepos();
    void loadBoundResources();
  }, [loadBoundResources, loadFiles, loadRepos, repositoryRefreshVersion]);

  const loadResourceOptions = useCallback(async () => {
    if (!isOperationProject) return;
    setResourceOptionsLoading(true);
    try {
      const knowledgeQuery = {
        pageNum: 1,
        pageSize: 100,
        resourceBizTypeList: [
          ResourceTypeMap.knowledgeBase,
          ResourceTypeMap.knowledgeBaseQa,
          ResourceTypeMap.knowledgeBaseTerm,
        ],
        resourceStatus: '2',
      };
      const [knowledgePersonal, knowledgeEnterprise, ontologyPersonal, ontologyEnterprise, ontologyResourcePersonal, ontologyResourceEnterprise] =
        await Promise.all([
          listResourceUseAuth({ ...knowledgeQuery, ownerType: 'personal', permission: '' }),
          listResourceUseAuth({ ...knowledgeQuery, ownerType: 'enterprise', permission: '', belong: 'ALL' }),
          listOntologyBases({ ownerType: 'personal' }),
          listOntologyBases({ ownerType: 'enterprise' }),
          pageOntologyResources({
            ownerType: 'personal',
            resourceBizTypeList: ['VIEW', 'OBJECT'],
            statusList: [0, 1, 2, 3, 4, 5],
            pageNum: 1,
            pageSize: 1000,
          }),
          pageOntologyResources({
            ownerType: 'enterprise',
            resourceBizTypeList: ['VIEW', 'OBJECT'],
            statusList: [0, 1, 2, 3, 4, 5],
            pageNum: 1,
            pageSize: 1000,
          }),
        ]);

      const knowledgeMap = new Map<string, ResourceOption>();
      [knowledgePersonal, knowledgeEnterprise].flatMap(getResourceRows).forEach((item: any) => {
        const value = item.resourceId ?? item.resourceSourcePkId ?? item.datasetId ?? item.id;
        const label = item.resourceName || item.datasetName || item.name;
        if (value !== undefined && value !== null && label) knowledgeMap.set(`${value}`, { value: `${value}`, label });
      });

      const ontologyMap = new Map<string, ResourceOption>();
      [
        ontologyPersonal,
        ontologyEnterprise,
        ontologyResourcePersonal,
        ontologyResourceEnterprise,
      ].flatMap(getResourceRows).forEach((item: any) => {
        const value = item.baseId ?? item.resourceId ?? item.id;
        const label = item.displayName || item.resourceName || item.name;
        if (value !== undefined && value !== null && label) ontologyMap.set(`${value}`, { value: `${value}`, label });
      });

      setKnowledgeOptions(Array.from(knowledgeMap.values()));
      setOntologyOptions(Array.from(ontologyMap.values()));
    } catch (error) {
      console.error('Failed to load project resource options:', error);
      setKnowledgeOptions([]);
      setOntologyOptions([]);
    } finally {
      setResourceOptionsLoading(false);
    }
  }, [isOperationProject]);

  useEffect(() => {
    if (resourceModalOpen) void loadResourceOptions();
  }, [loadResourceOptions, resourceModalOpen]);

  useEffect(() => {
    // 资源 Tab 的刷新入口统一放到项目详情顶部，同时刷新各资源列表。
    onRefreshToolbarChange?.(
      <Button
        size="small"
        icon={<ReloadOutlined />}
        loading={loadingFiles || loadingRepos || loadingBoundResources}
        onClick={() => {
          void loadFiles();
          void loadRepos();
          void loadBoundResources();
        }}
      >
        {intl.formatMessage({ id: 'projectSpace.detail.refresh' })}
      </Button>
    );
    return () => onRefreshToolbarChange?.(null);
  }, [
    intl,
    loadBoundResources,
    loadFiles,
    loadRepos,
    loadingBoundResources,
    loadingFiles,
    loadingRepos,
    onRefreshToolbarChange,
  ]);

  const openResourceModal = () => {
    setSelectedResources({
      knowledge: boundResources
        .filter((resource) => resource.resourceType === 'knowledge')
        .map((resource) => `${resource.resourceId}`),
      digital_employee: boundResources
        .filter((resource) => resource.resourceType === 'digital_employee')
        .map((resource) => `${resource.resourceId}`),
      ontology: boundResources
        .filter((resource) => resource.resourceType === 'ontology')
        .map((resource) => `${resource.resourceId}`),
    });
    setResourceModalOpen(true);
  };

  const saveResourceBindings = async () => {
    if (resourceSaving) return;
    setResourceSaving(true);
    try {
      const optionLabelMap = new Map<string, string>([
        ...knowledgeOptions,
        ...ontologyOptions,
        ...agentOptions,
      ].map((option) => [`${option.value}`, option.label]));
      const previousNameMap = new Map(
        boundResources.map((resource) => [`${resource.resourceType}:${resource.resourceId}`, resource.resourceName])
      );
      const resources = (Object.entries(selectedResources) as [ProjectResourceType, string[]][]).flatMap(
        ([resourceType, resourceIds]) =>
          resourceIds.map((resourceId, index) => ({
            resourceType,
            resourceId,
            resourceName:
              optionLabelMap.get(`${resourceId}`) || previousNameMap.get(`${resourceType}:${resourceId}`) || undefined,
            sortNo: index,
          }))
      );
      await saveProjectResources({ projectId: Number(project.projectId), resources });
      message.success('项目共享资源已更新');
      setResourceModalOpen(false);
      await loadBoundResources();
    } catch (error: any) {
      message.error(error?.message || '项目共享资源保存失败');
    } finally {
      setResourceSaving(false);
    }
  };

  const handleDeleteRepository = (repo: DevloopProjectRepo) => {
    if (repo.repoId === undefined || repo.repoId === null) return;
    Modal.confirm({
      title: '删除项目仓库',
      content: `确定删除“${repo.repoFullName || repo.repoUrl || repo.repoId}”吗？`,
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteProjectRepo(Number(repo.repoId));
          message.success('仓库已删除');
          await loadRepos();
        } catch (error: any) {
          message.error(error?.message || '仓库删除失败');
        }
      },
    });
  };

  const empty = (
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={intl.formatMessage({ id: 'chatResource.empty' })} />
  );

  const renderCardHeader = (
    icon: React.ReactNode,
    title: string,
    description: string,
    onAdd?: () => void
  ) => (
    <header className={styles.resourceCardHeader}>
      <div className={styles.resourceCardTitleBlock}>
        <span className={styles.resourceCardIcon}>{icon}</span>
        <div>
          <Typography.Title level={4}>{title}</Typography.Title>
          <Typography.Text type="secondary">{description}</Typography.Text>
        </div>
      </div>
      {onAdd && (
        <Button type="text" size="small" icon={<PlusOutlined />} className={styles.resourceCardAddButton} onClick={onAdd}>
          {intl.formatMessage({ id: 'common.add' })}
        </Button>
      )}
    </header>
  );

  const renderBoundResources = (
    items: ProjectBoundResource[],
    resourceType: ProjectResourceType,
    icon: React.ReactNode,
    fallback: string
  ) => {
    const iconClassName = {
      knowledge: styles.resourceKnowledgeIcon,
      digital_employee: styles.resourceEmployeeIcon,
      ontology: styles.resourceOntologyIcon,
    }[resourceType];

    return (
      <Spin spinning={loadingBoundResources} className={styles.resourceCategoryBody}>
        {items.length
          ? items.map((resource) => {
            const employeeAvatar =
              resourceType === 'digital_employee' ? employeeAvatarMap.get(`${resource.resourceId}`) : undefined;
            const avatarClassName = employeeAvatar ? styles.resourceEmployeeAvatar : '';

            return (
              <div
                key={`${resourceType}:${resource.resourceId}`}
                className={`${styles.resourceSimpleItem} ${styles.resourceBoundItem}`}
              >
                <span
                  className={`${styles.resourceSimpleIcon} ${styles.resourceBoundIcon} ${iconClassName} ${avatarClassName}`}
                >
                  {employeeAvatar ? getAgentChatAvatar(employeeAvatar) : icon}
                </span>
                <div className={styles.resourceSimpleMain}>
                  <Typography.Text strong ellipsis={{ tooltip: resource.resourceName }}>
                    {resource.resourceName || resource.resourceId}
                  </Typography.Text>
                  <Typography.Text type="secondary" ellipsis>
                    {fallback}
                  </Typography.Text>
                </div>
              </div>
            );
          })
          : !loadingBoundResources && empty}
      </Spin>
    );
  };

  const boundKnowledge = boundResources.filter((resource) => resource.resourceType === 'knowledge');
  const boundEmployees = boundResources.filter((resource) => resource.resourceType === 'digital_employee');
  const boundOntologies = boundResources.filter((resource) => resource.resourceType === 'ontology');

  return (
    <>
      <div
        className={styles.resourceCategoryGrid}
        style={{ gridTemplateColumns: `repeat(${resourceCategoryCount}, minmax(0, 1fr))` }}
      >
        <section className={styles.resourceCategoryCard}>
          {renderCardHeader(
            <FileTextOutlined />,
            intl.formatMessage({ id: 'projectSpace.detail.resource.sharedSpace' }),
            intl.formatMessage({ id: 'projectSpace.resources.sharedFilesDescription' })
          )}
          <Spin spinning={loadingFiles} className={styles.resourceCategoryBody}>
            {files.length
              ? files.map((file) => (
                <div
                  key={file.fileId}
                  className={styles.resourceSimpleItem}
                  role="button"
                  tabIndex={0}
                  onClick={() => setPreviewFile(file)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') setPreviewFile(file);
                  }}
                >
                  <AntdIcon
                    type={`icon-${getFileIconType(file.fileName)}`}
                    className={styles.resourceFileIcon}
                  />
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

        {isDevelopProject ? (
          <section className={styles.resourceCategoryCard}>
            {renderCardHeader(
              <GithubOutlined />,
              intl.formatMessage({ id: 'projectSpace.resources.sharedCode' }),
              intl.formatMessage({ id: 'projectSpace.resources.sharedCodeDescription' }),
              onOpenRepositoryManager ? () => onOpenRepositoryManager() : undefined
            )}
            <Spin spinning={loadingRepos} className={styles.resourceCategoryBody}>
              {repos.length
                ? repos.map((repo) => (
                  <div key={`${repo.repoId || repo.repoFullName}`} className={styles.resourceSimpleItem}>
                    <span className={`${styles.resourceSimpleIcon} ${styles.resourceRepoIcon}`}>
                      <GithubOutlined />
                    </span>
                    <div className={styles.resourceSimpleMain}>
                      <Typography.Text strong ellipsis={{ tooltip: repo.repoFullName }}>
                        {repo.repoFullName || repo.repoUrl || repo.repoId}
                      </Typography.Text>
                      <Typography.Text type="secondary" ellipsis>
                        {[repo.repoUrl, repo.defaultBranch, repo.description].filter(Boolean).join(' · ') || '-'}
                      </Typography.Text>
                    </div>
                    <Dropdown
                      trigger={['hover']}
                      menu={{
                        items: [
                          { key: 'edit', icon: <EditOutlined />, label: '编辑' },
                          { key: 'delete', danger: true, icon: <DeleteOutlined />, label: '删除' },
                        ],
                        onClick: ({ key }) => {
                          if (key === 'edit') onOpenRepositoryManager?.(repo);
                          if (key === 'delete') handleDeleteRepository(repo);
                        },
                      }}
                    >
                      <Button
                        type="text"
                        size="small"
                        className={styles.resourceMoreButton}
                        icon={<MoreOutlined />}
                        onClick={(event) => event.stopPropagation()}
                      />
                    </Dropdown>
                  </div>
                ))
                : !loadingRepos && empty}
            </Spin>
          </section>
        ) : isOperationProject ? (
          <section className={styles.resourceCategoryCard}>
            {renderCardHeader(
              <DatabaseOutlined />,
              intl.formatMessage({ id: 'projectSpace.resources.sharedKnowledge' }),
              intl.formatMessage({ id: 'projectSpace.resources.sharedKnowledgeDescription' }),
              openResourceModal
            )}
            {renderBoundResources(boundKnowledge, 'knowledge', <DatabaseOutlined />, '当前项目绑定知识库')}
          </section>
        ) : null}

        {isOperationProject && (
          <section className={styles.resourceCategoryCard}>
            {renderCardHeader(
              <RobotOutlined />,
              '共享数字员工',
              '绑定的数字员工',
              openResourceModal
            )}
            {renderBoundResources(boundEmployees, 'digital_employee', <RobotOutlined />, '当前项目绑定数字员工')}
          </section>
        )}

        {isOperationProject && (
          <section className={styles.resourceCategoryCard}>
            {renderCardHeader(
              <ApartmentOutlined />,
              intl.formatMessage({ id: 'projectSpace.resources.sharedOntology' }),
              intl.formatMessage({ id: 'projectSpace.resources.sharedOntologyDescription' }),
              openResourceModal
            )}
            {renderBoundResources(boundOntologies, 'ontology', <ApartmentOutlined />, '当前项目绑定本体')}
          </section>
        )}
      </div>

      {isOperationProject && (
        <Modal
          open={resourceModalOpen}
          title="绑定项目资源"
          width={640}
          centered
          destroyOnClose
          confirmLoading={resourceSaving}
          onCancel={() => setResourceModalOpen(false)}
          onOk={() => void saveResourceBindings()}
        >
          <Spin spinning={resourceOptionsLoading || agentOptionsLoading || loadingBoundResources}>
            <div className={styles.projectResourceBindingModal}>
              <div>
                <Typography.Text strong>知识库</Typography.Text>
                <Select
                  mode="multiple"
                  value={selectedResources.knowledge}
                  options={knowledgeOptions}
                  loading={resourceOptionsLoading}
                  showSearch
                  optionFilterProp="label"
                  placeholder="请选择项目知识库"
                  onChange={(value) => setSelectedResources((current) => ({ ...current, knowledge: value }))}
                />
              </div>
              <div>
                <Typography.Text strong>数字员工</Typography.Text>
                <Select
                  mode="multiple"
                  value={selectedResources.digital_employee}
                  options={agentOptions}
                  loading={agentOptionsLoading}
                  showSearch
                  optionFilterProp="label"
                  placeholder="请选择项目数字员工"
                  onChange={(value) =>
                    setSelectedResources((current) => ({ ...current, digital_employee: value }))
                  }
                />
              </div>
              <div>
                <Typography.Text strong>本体</Typography.Text>
                <Select
                  mode="multiple"
                  value={selectedResources.ontology}
                  options={ontologyOptions}
                  loading={resourceOptionsLoading}
                  showSearch
                  optionFilterProp="label"
                  placeholder="请选择项目本体"
                  onChange={(value) => setSelectedResources((current) => ({ ...current, ontology: value }))}
                />
              </div>
            </div>
          </Spin>
        </Modal>
      )}

      <Drawer
        title={previewFile?.fileName || '文件预览'}
        open={!!previewFile}
        placement="right"
        width="50vw"
        mask={false}
        destroyOnClose
        onClose={() => setPreviewFile(null)}
        styles={{ body: { padding: 0, overflow: 'hidden' } }}
      >
        {previewFile && (
          <FilePreviewPanel
            fileName={previewFile.fileName}
            resourceId={project.resourceId ? `${project.resourceId}` : undefined}
            path={previewFile.fileUrl || `/by/.project/${previewFile.fileName}`}
            fileUrl={previewFile.fileUrl || undefined}
            source="fileBrowser"
          />
        )}
      </Drawer>
    </>
  );
};

export default ProjectResources;
