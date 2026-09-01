import { Button, Drawer, Dropdown, Empty, Input, Modal, Select, Spin, Switch, Typography, Upload, message } from 'antd';
import {
  ApartmentOutlined,
  BranchesOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  DownOutlined,
  EllipsisOutlined,
  EditOutlined,
  FullscreenExitOutlined,
  FullscreenOutlined,
  GithubOutlined,
  MoreOutlined,
  PlusOutlined,
  ReloadOutlined,
  RightOutlined,
  RobotOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useIntl } from '@umijs/max';
import { getAgentChatAvatar } from '@/utils/agent';
import AntdIcon from '@/components/AntdIcon';
import { getFileIconType } from '@/constants/icon';
import FilePreviewPanel from '@/components/ChatLayoutComp/ChatResourceWorkspace/FilePreviewPanel';
import FileResourcePanel from '@/components/ChatLayoutComp/ChatResourceWorkspace/FileResourcePanel';
import { SiderContentContext } from '@/layout/sider/siderContentContext';
import FileSpaceBlock from '@/layout/sider/components/FileSiderPanel/components/FileSpaceBlock';
import type { FileTreeItem } from '@/layout/sider/components/FileSiderPanel/constants';
import {
  ensureDirectoryPath,
  isDirectory,
  normalizeFileBrowserPath,
} from '@/layout/sider/components/FileSiderPanel/utils';
import {
  getProjectRepoFileContent,
  listProjectRepoBranches,
  listProjectRepoTree,
  listProjectRepos,
  listProjectResources,
  listScanSources,
  toggleScanSource,
  triggerScan,
  deleteScanSource,
  deleteProjectRepo,
  saveProjectResources,
  type DevloopProjectRepo,
  type DevloopProjectSpaceFile,
  type ProjectRepoBranch,
  type ProjectRepoTreeNode,
  type ProjectResourceType,
} from '@/service/devloop';
import { listResourceUseAuth } from '@/pages/manager/service/resources';
import { listOntologyBases, pageOntologyResources } from '@/service/ontology';
import { createFolder, deleteFolder, removeFile, uploadFiles as uploadKnowledgeFiles } from '@/service/knowledgeCenter';
import { ResourceTypeMap } from '@/constants/resource';
import { useDigitalEmployeeOptions } from '../../hooks/useDigitalEmployeeOptions';
import { getProjectResourceCategoryCount, supportsProjectRepositories } from '../../projectCapabilities';
import type { ProjectBoundResource, ProjectSpace } from '../../types';
import styles from '../../index.module.less';
import { queryProjectCloudDrive } from '@/components/ProjectCloudDrive';

interface Props {
  project: ProjectSpace;
  onRefreshToolbarChange?: (toolbar: React.ReactNode | null) => void;

  /** 研发、运营项目共享代码仓库新增复用项目仓库管理表单。 */
  onOpenRepositoryManager?: (repo?: DevloopProjectRepo) => void;
  onOpenScheduleTaskCreate?: () => void;
  onEditScheduleTask?: (task: any) => void;
  onResourceReference?: (resource: any) => void;
  scheduleRefreshVersion?: number;

  /** 仓库新增/编辑后由详情页递增，确保资源卡片立即重新读取列表。 */
  repositoryRefreshVersion?: number;
}

type ResourceOption = { value: string; label: string; description?: string };
type ResourceSelection = Record<ProjectResourceType, string[]>;
type RepoFileItem = { name: string; path: string; isDir: boolean; size?: number };

const EMPTY_SELECTION: ResourceSelection = {
  knowledge: [],
  digital_employee: [],
  ontology: [],
};

const toFileBrowserItem = (node: ProjectRepoTreeNode): RepoFileItem => ({
  name: node.name,
  path: normalizeFileBrowserPath(node.path),
  isDir: node.type === 'directory',
  size: node.size,
});

const getArray = (...candidates: any[]): any[] => candidates.find((candidate) => Array.isArray(candidate)) || [];

const getResourceRows = (response: any): any[] =>
  getArray(response, response?.rows, response?.list, response?.data, response?.data?.rows, response?.data?.list);

const normalizeBoundResources = (response: any): ProjectBoundResource[] =>
  getResourceRows(response).filter((resource) => resource?.resourceType && resource?.resourceId);

const ProjectResources: React.FC<Props> = ({
  project,
  onRefreshToolbarChange,
  onOpenRepositoryManager,
  onOpenScheduleTaskCreate,
  onEditScheduleTask,
  onResourceReference,
  scheduleRefreshVersion = 0,
  repositoryRefreshVersion = 0,
}) => {
  const intl = useIntl();
  const siderContentContext = useContext(SiderContentContext);
  const [files, setFiles] = useState<DevloopProjectSpaceFile[]>([]);
  const [cloudPath, setCloudPath] = useState('/');
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [fileUploading, setFileUploading] = useState(false);
  const [scheduleTasks, setScheduleTasks] = useState<any[]>([]);
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
  const [detailRepo, setDetailRepo] = useState<DevloopProjectRepo | null>(null);
  const [repoFiles, setRepoFiles] = useState<RepoFileItem[]>([]);
  const [repoFilesLoading, setRepoFilesLoading] = useState(false);
  const [childrenByPath, setChildrenByPath] = useState<Record<string, RepoFileItem[]>>({});
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);
  const [branches, setBranches] = useState<ProjectRepoBranch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>('');
  // fileName 决定预览器的类型判断与标题，path 用于抽屉标题显示完整位置。
  // content 为 null 时抽屉显示 loading，等异步填入后预览器自动刷新。
  const [filePreviewContent, setFilePreviewContent] = useState<{
    fileName: string;
    path: string;
    content: string | null;
    binary?: boolean;
  } | null>(null);
  const requestSeqRef = useRef(0);
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

  const isOperationProject = project.projectType === 'operation';
  const repositoryProject = supportsProjectRepositories(project.projectType);
  // 资源分类始终在同一行等宽铺满：研发 2 类、运营 5 类，默认和普通项目仅展示共享文件。
  const resourceCategoryCount = getProjectResourceCategoryCount(project.projectType);

  const loadFiles = useCallback(async () => {
    const cloudResourceId = project.cloudResourceId;
    if (!cloudResourceId) {
      setFiles([]);
      return;
    }
    setLoadingFiles(true);
    try {
      const nextFiles = await queryProjectCloudDrive(Number(cloudResourceId), cloudPath, intl.locale).then((items) =>
        items.map((item) => {
          const fileName = item.name;
          return {
            fileId: Number(item.fileId),
            fileName,
            fileUrl: item.path,
            isDir: item.isDir,
            directoryPath: item.path,
            size: item.size,
            projectId: Number(project.projectId),
          };
        })
      );
      setFiles(nextFiles);
    } catch (error: any) {
      setFiles([]);
      const apiMessage =
        error?.msg ||
        error?.data?.msg ||
        error?.response?.data?.msg ||
        error?.response?.data?.message ||
        error?.message;
      message.error({
        key: 'project-cloud-drive-load-error',
        content: apiMessage || intl.formatMessage({ id: 'projectSpace.resources.loadFilesFailed' }),
      });
    } finally {
      setLoadingFiles(false);
    }
  }, [cloudPath, intl, project.cloudResourceId, project.projectId, project.resourceId]);

  const loadScheduleTasks = useCallback(async () => {
    try {
      const response = await listScanSources({
        projectId: Number(project.projectId),
        onlyMine: false,
        pageNum: 1,
        pageSize: 100,
      });
      const data = response?.data ?? response;
      setScheduleTasks(Array.isArray(data) ? data : data?.list || data?.rows || []);
    } catch {
      setScheduleTasks([]);
    }
  }, [project.projectId]);

  const loadRepos = useCallback(async () => {
    if (!repositoryProject) return;
    setLoadingRepos(true);
    try {
      setRepos((await listProjectRepos(Number(project.projectId))) || []);
    } catch (error: any) {
      setRepos([]);
      message.error(error?.message || intl.formatMessage({ id: 'projectSpace.resources.loadReposFailed' }));
    } finally {
      setLoadingRepos(false);
    }
  }, [intl, project.projectId, repositoryProject]);

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
    void loadScheduleTasks();
  }, [loadBoundResources, loadFiles, loadRepos, loadScheduleTasks, repositoryRefreshVersion, scheduleRefreshVersion]);

  useEffect(() => {
    setCloudPath('/');
  }, [project.projectId]);

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
      const [
        knowledgePersonal,
        knowledgeEnterprise,
        ontologyPersonal,
        ontologyEnterprise,
        ontologyResourcePersonal,
        ontologyResourceEnterprise,
      ] = await Promise.all([
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
        const description = item.resourceDesc || item.datasetDesc || item.description || item.desc || '';
        if (value !== undefined && value !== null && label) {
          knowledgeMap.set(`${value}`, { value: `${value}`, label, description });
        }
      });

      const ontologyMap = new Map<string, ResourceOption>();
      [ontologyPersonal, ontologyEnterprise, ontologyResourcePersonal, ontologyResourceEnterprise]
        .flatMap(getResourceRows)
        .forEach((item: any) => {
          const value = item.baseId ?? item.resourceId ?? item.id;
          const label = item.displayName || item.resourceName || item.name;
          const description =
            item.resourceDesc || item.baseDesc || item.objectDesc || item.description || item.desc || '';
          if (value !== undefined && value !== null && label) {
            ontologyMap.set(`${value}`, { value: `${value}`, label, description });
          }
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
    // 资源列表也需要展示描述，因此运营项目打开详情时就加载资源元数据。
    if (isOperationProject) void loadResourceOptions();
  }, [isOperationProject, loadResourceOptions]);

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
      const optionLabelMap = new Map<string, string>(
        [...knowledgeOptions, ...ontologyOptions, ...agentOptions].map((option) => [`${option.value}`, option.label])
      );
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
      message.success(intl.formatMessage({ id: 'projectSpace.resources.saveSuccess' }));
      setResourceModalOpen(false);
      await loadBoundResources();
    } catch (error: any) {
      message.error(error?.message || intl.formatMessage({ id: 'projectSpace.resources.saveFailed' }));
    } finally {
      setResourceSaving(false);
    }
  };

  const handleDeleteRepository = (repo: DevloopProjectRepo) => {
    if (repo.repoId === undefined || repo.repoId === null) return;
    Modal.confirm({
      title: intl.formatMessage({ id: 'projectSpace.resources.deleteRepoTitle' }),
      content: intl.formatMessage(
        { id: 'projectSpace.resources.deleteRepoContent' },
        { repo: repo.repoFullName || repo.repoUrl || repo.repoId }
      ),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteProjectRepo(Number(repo.repoId));
          message.success(intl.formatMessage({ id: 'projectSpace.resources.deleteRepoSuccess' }));
          await loadRepos();
        } catch (error: any) {
          message.error(error?.message || intl.formatMessage({ id: 'projectSpace.resources.deleteRepoFailed' }));
        }
      },
    });
  };

  const loadRepoFiles = useCallback(
    async (repo: DevloopProjectRepo, branch?: string) => {
      const selectedBranch = branch || repo.defaultBranch || 'main';
      const requestSeq = ++requestSeqRef.current;
      setRepoFilesLoading(true);
      try {
        const response = await listProjectRepoTree({
          projectId: Number(project.projectId),
          repoId: repo.repoId,
          ref: selectedBranch,
        });
        if (requestSeq === requestSeqRef.current) {
          setRepoFiles((response || []).map(toFileBrowserItem));
        }
      } catch (error) {
        console.error('Failed to load repository files:', error);
        if (requestSeq === requestSeqRef.current) {
          setRepoFiles([]);
        }
      } finally {
        if (requestSeq === requestSeqRef.current) {
          setRepoFilesLoading(false);
        }
      }
    },
    [project.projectId]
  );

  const loadRepoBranches = useCallback(async (repo: DevloopProjectRepo) => {
    try {
      const branchList = await listProjectRepoBranches(repo.repoId);
      const defaultBranch = repo.defaultBranch || branchList?.[0]?.name || 'main';
      setBranches(branchList || []);
      setSelectedBranch(defaultBranch);
      return defaultBranch;
    } catch (error) {
      console.error('Failed to load repository branches:', error);
      const fallbackBranch = repo.defaultBranch || 'main';
      setBranches([]);
      setSelectedBranch(fallbackBranch);
      return fallbackBranch;
    }
  }, []);

  // 仓库详情抽屉打开时重置树/分支状态，避免上一个仓库的缓存串到当前仓库。
  const handleOpenRepoDetail = useCallback(
    async (repo: DevloopProjectRepo) => {
      setDetailRepo(repo);
      setRepoFiles([]);
      setChildrenByPath({});
      setExpandedKeys([]);
      setFilePreviewContent(null);
      const defaultBranch = await loadRepoBranches(repo);
      await loadRepoFiles(repo, defaultBranch);
    },
    [loadRepoBranches, loadRepoFiles]
  );

  const loadRepoTreeNode = useCallback(
    async (node: FileTreeItem) => {
      if (!detailRepo || !isDirectory(node)) return;
      const path = ensureDirectoryPath(normalizeFileBrowserPath(node.path));
      if (childrenByPath[path]) return;
      try {
        const response = await listProjectRepoTree({
          projectId: Number(project.projectId),
          repoId: detailRepo.repoId,
          path,
          ref: selectedBranch || detailRepo.defaultBranch || 'main',
        });
        setChildrenByPath((current) => ({
          ...current,
          [path]: (response || []).map(toFileBrowserItem),
        }));
      } catch (error) {
        console.error('Failed to load repository directory:', error);
        setChildrenByPath((current) => ({ ...current, [path]: [] }));
      }
    },
    [childrenByPath, detailRepo, project.projectId, selectedBranch]
  );

  const handleNodeClick = useCallback(
    async (event: React.MouseEvent, node: FileTreeItem) => {
      event.stopPropagation();
      if (!detailRepo || isDirectory(node)) return;
      // 点击立即开抽屉显示 loading，后台拉取内容回来后更新 content 字段触发预览器刷新。
      setFilePreviewContent({
        fileName: node.name,
        path: node.path,
        content: null,
        binary: undefined,
      });
      try {
        const file = await getProjectRepoFileContent({
          repoId: detailRepo.repoId,
          branch: selectedBranch || detailRepo.defaultBranch || 'main',
          path: node.path,
        });
        setFilePreviewContent((prev) =>
          prev
            ? {
              ...prev,
              path: file.path || prev.path,
              content: file.binary ? file.base64Content || '' : file.content || '',
              binary: file.binary,
            }
            : null
        );
      } catch (error: any) {
        setFilePreviewContent(null);
        message.error(error?.message || '文件内容加载失败');
      }
    },
    [detailRepo, selectedBranch]
  );

  const changeBranch = useCallback(
    async (branch: string) => {
      if (!detailRepo) return;
      setSelectedBranch(branch);
      setChildrenByPath({});
      setExpandedKeys([]);
      await loadRepoFiles(detailRepo, branch);
    },
    [detailRepo, loadRepoFiles]
  );

  const empty = (
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={intl.formatMessage({ id: 'chatResource.empty' })} />
  );
  // 云盘展示统一由 FileResourcePanel 负责，保留旧数据加载逻辑供刷新状态使用。
  void files;

  const cloudResourceId = project.cloudResourceId ? Number(project.cloudResourceId) : undefined;
  const handleCreateFolder = async () => {
    const name = folderName.trim();
    if (!cloudResourceId || !name) return;
    try {
      await createFolder({
        resourceId: cloudResourceId,
        directoryPath: '/',
        directoryName: name,
        directoryDescription: '',
      });
      message.success('文件夹创建成功');
      setCreateFolderOpen(false);
      setFolderName('');
      await loadFiles();
    } catch (error: any) {
      message.error(error?.message || '文件夹创建失败');
    }
  };

  const handleUploadFiles = async (fileList: File[]) => {
    if (!cloudResourceId || !fileList.length) return;
    setFileUploading(true);
    try {
      const formData = new FormData();
      fileList.forEach((file) => formData.append('files', file));
      formData.append('resourceId', String(cloudResourceId));
      formData.append('directoryPath', '/');
      await uploadKnowledgeFiles(formData);
      message.success('文件上传成功');
      await loadFiles();
    } catch (error: any) {
      message.error(error?.message || '文件上传失败');
    } finally {
      setFileUploading(false);
    }
  };

  const renderCardHeader = (
    title: string,
    cardKey: string,
    onAdd?: () => void,
    extra?: React.ReactNode,
    iconOnlyAdd = false
  ) => (
    <header className={styles.resourceCardHeader}>
      <div className={styles.resourceCardTitleBlock}>
        <Typography.Title level={4}>{title}</Typography.Title>
      </div>
      <div className={styles.resourceCardHeaderActions}>
        {extra}
        {onAdd && (
          <Button
            type="text"
            size="small"
            icon={<PlusOutlined />}
            className={iconOnlyAdd ? styles.resourceCardExpandButton : styles.resourceCardAddButton}
            aria-label={iconOnlyAdd ? intl.formatMessage({ id: 'common.add' }) : undefined}
            onClick={onAdd}
          >
            {!iconOnlyAdd && intl.formatMessage({ id: 'common.add' })}
          </Button>
        )}
        <Button
          type="text"
          size="small"
          className={styles.resourceCardExpandButton}
          icon={expandedCard === cardKey ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
          aria-label={expandedCard === cardKey ? '收起' : '展开'}
          onClick={() => setExpandedCard((current) => (current === cardKey ? null : cardKey))}
        />
      </div>
    </header>
  );

  const renderBoundResources = (
    items: ProjectBoundResource[],
    resourceType: ProjectResourceType,
    icon: React.ReactNode
  ) => {
    const iconClassName = {
      knowledge: styles.resourceKnowledgeIcon,
      digital_employee: styles.resourceEmployeeIcon,
      ontology: styles.resourceOntologyIcon,
    }[resourceType];

    const descriptionMap = new Map<string, string>(
      [
        ...knowledgeOptions.map((option) => [`knowledge:${option.value}`, option.description]),
        ...agentOptions.map((option) => [`digital_employee:${option.value}`, option.description]),
        ...ontologyOptions.map((option) => [`ontology:${option.value}`, option.description]),
      ].filter((item): item is [string, string] => Boolean(item[1]))
    );
    const resourceItems = items.map((resource) => {
      const employeeAvatar =
        resourceType === 'digital_employee' ? employeeAvatarMap.get(`${resource.resourceId}`) : undefined;
      const avatarClassName = employeeAvatar ? styles.resourceEmployeeAvatar : '';
      const description =
        resource.resourceDesc ||
        resource.description ||
        resource.desc ||
        descriptionMap.get(`${resourceType}:${resource.resourceId}`) ||
        '-';
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
            <Typography.Text type="secondary" ellipsis={{ tooltip: description }}>
              {description}
            </Typography.Text>
          </div>
        </div>
      );
    });

    return (
      <Spin spinning={loadingBoundResources} className={styles.resourceCategoryBody}>
        {items.length ? resourceItems : !loadingBoundResources && empty}
      </Spin>
    );
  };

  const boundKnowledge = boundResources.filter((resource) => resource.resourceType === 'knowledge');
  const boundEmployees = boundResources.filter((resource) => resource.resourceType === 'digital_employee');
  const boundOntologies = boundResources.filter((resource) => resource.resourceType === 'ontology');

  const renderSharedFile = (file: DevloopProjectSpaceFile) => {
    const metadata = [
      (file as any).size || (file as any).fileSize,
      (file as any).updateTime || (file as any).updatedAt,
      (file as any).creatorName,
    ]
      .filter(Boolean)
      .join(' · ');
    return (
      <div
        key={file.fileId}
        className={styles.resourceSimpleItem}
        role="button"
        tabIndex={0}
        onDoubleClick={() =>
          onResourceReference?.({
            resourceId: file.fileId,
            name: file.fileName,
            resourceName: file.fileName,
            resourceType: file.isDir ? 'COMMON_FOLDER' : 'COMMON_FILE',
            path: file.fileUrl,
          })
        }
        onClick={() => {
          if (file.isDir) {
            const nextPath = `${cloudPath.replace(/\/$/, '')}/${file.fileName}`.replace(/^\/?/, '/');
            setCloudPath(`${nextPath}/`);
          } else setPreviewFile(file);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (file.isDir) {
              const nextPath = `${cloudPath.replace(/\/$/, '')}/${file.fileName}`.replace(/^\/?/, '/');
              setCloudPath(`${nextPath}/`);
            } else setPreviewFile(file);
          }
        }}
      >
        <AntdIcon
          type={`icon-${file.isDir ? 'a-Folder-openwenjianjia-kai' : getFileIconType(file.fileName)}`}
          className={styles.resourceFileIcon}
        />
        <div className={styles.resourceSimpleMain}>
          <Typography.Text strong ellipsis={{ tooltip: file.fileName }}>
            {file.fileName}
          </Typography.Text>
          <Typography.Text type="secondary" ellipsis>
            {metadata || file.fileUrl || intl.formatMessage({ id: 'projectSpace.detail.resource.sharedSpace' })}
          </Typography.Text>
        </div>
        <Dropdown
          trigger={['click']}
          menu={{
            items: [
              { key: 'reference', label: '引用' },
              { key: 'rename', label: '重命名' },
              { key: 'delete', label: '删除', danger: true },
            ],
            onClick: async ({ key, domEvent }) => {
              domEvent.stopPropagation();
              const path = file.fileUrl || `${cloudPath}${file.fileName}`;
              if (key === 'reference')
                onResourceReference?.({
                  resourceId: file.fileId,
                  name: file.fileName,
                  resourceName: file.fileName,
                  resourceType: file.isDir ? 'COMMON_FOLDER' : 'COMMON_FILE',
                  path,
                });
              if (key === 'delete' && cloudResourceId) {
                if (file.isDir) await deleteFolder({ resourceId: cloudResourceId, directoryPath: path });
                else await removeFile({ resourceId: String(cloudResourceId), directoryPath: path });
                await loadFiles();
              }
              if (key === 'rename') message.info('请使用知识库目录管理中的重命名功能');
            },
          }}
        >
          <Button type="text" size="small" icon={<MoreOutlined />} onClick={(event) => event.stopPropagation()} />
        </Dropdown>
        <RightOutlined />
      </div>
    );
  };

  void renderSharedFile;

  const renderRepository = (repo: DevloopProjectRepo) => (
    <div
      key={`${repo.repoId || repo.repoFullName}`}
      className={styles.resourceSimpleItem}
      role="button"
      tabIndex={0}
      onClick={() => handleOpenRepoDetail(repo)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleOpenRepoDetail(repo);
        }
      }}
    >
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
        onOpenChange={() => undefined}
        menu={{
          items: [
            { key: 'edit', icon: <EditOutlined />, label: intl.formatMessage({ id: 'common.edit' }) },
            {
              key: 'delete',
              danger: true,
              icon: <DeleteOutlined />,
              label: intl.formatMessage({ id: 'common.delete' }),
            },
          ],
          onClick: ({ key, domEvent }) => {
            domEvent.stopPropagation();
            setDetailRepo(null);
            if (key === 'edit') onOpenRepositoryManager?.(repo);
            if (key === 'delete') handleDeleteRepository(repo);
          },
        }}
      >
        <span onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
          <Button
            type="text"
            size="small"
            className={styles.resourceMoreButton}
            icon={<MoreOutlined />}
            onClick={(event) => event.stopPropagation()}
          />
        </span>
      </Dropdown>
    </div>
  );

  return (
    <>
      <div
        className={styles.resourceCategoryGrid}
        style={{ gridTemplateColumns: `repeat(${resourceCategoryCount}, minmax(0, 1fr))` }}
      >
        <section
          className={`${styles.resourceCategoryCard} ${styles.resourceCloudDriveCard} ${
            expandedCard === 'cloudDrive' ? styles.resourceCategoryCardExpanded : ''
          }`}
        >
          {renderCardHeader(
            '项目云盘',
            'cloudDrive',
            undefined,
            cloudResourceId ? (
              <>
                <Button
                  type="text"
                  size="small"
                  className={styles.resourceCardExpandButton}
                  icon={<PlusOutlined />}
                  aria-label="新建文件夹"
                  onClick={() => setCreateFolderOpen(true)}
                />
                <Upload
                  showUploadList={false}
                  multiple
                  beforeUpload={(_, fileList) => {
                    void handleUploadFiles(fileList as unknown as File[]);
                    return false;
                  }}
                >
                  <Button
                    type="text"
                    size="small"
                    className={styles.resourceCardExpandButton}
                    icon={<UploadOutlined />}
                    aria-label="上传文件"
                    loading={fileUploading}
                  />
                </Upload>
              </>
            ) : undefined
          )}
          <FileResourcePanel
            scope="project"
            sessionId=""
            projectId={Number(project.projectId)}
            project={project}
            resourceId={cloudResourceId ? String(cloudResourceId) : undefined}
            fillContainer
            onOpenDetail={(panel, options) => siderContentContext.setDetailPanel?.(panel, options)}
            onPreviewFile={(item) => {
              setPreviewFile({
                fileId: Number((item as any).fileId),
                fileName: item.name,
                fileUrl: item.path,
                isDir: false,
                projectId: Number(project.projectId),
              } as DevloopProjectSpaceFile);
            }}
          />
        </section>

        {repositoryProject && (
          <section
            className={`${styles.resourceCategoryCard} ${
              expandedCard === 'code' ? styles.resourceCategoryCardExpanded : ''
            }`}
          >
            {renderCardHeader(
              intl.formatMessage({ id: 'projectSpace.resources.sharedCode' }),
              'code',
              onOpenRepositoryManager ? () => onOpenRepositoryManager() : undefined,
              undefined,
              true
            )}
            <Spin spinning={loadingRepos} className={styles.resourceCategoryBody}>
              {repos.length ? repos.map(renderRepository) : !loadingRepos && empty}
            </Spin>
          </section>
        )}

        <section
          className={`${styles.resourceCategoryCard} ${
            expandedCard === 'schedule' ? styles.resourceCategoryCardExpanded : ''
          }`}
        >
          <header className={styles.resourceCardHeader}>
            <div className={styles.resourceCardTitleBlock}>
              <Typography.Title level={4}>
                {intl.formatMessage({ id: 'employees.scheduleTaskList.title', defaultMessage: '定时任务' })}
              </Typography.Title>
            </div>
            <div className={styles.resourceCardHeaderActions}>
              <Button
                type="text"
                size="small"
                icon={<PlusOutlined />}
                className={styles.resourceCardExpandButton}
                aria-label={intl.formatMessage({ id: 'common.add' })}
                onClick={() => onOpenScheduleTaskCreate?.()}
              />
              <Button
                type="text"
                size="small"
                className={styles.resourceCardExpandButton}
                icon={expandedCard === 'schedule' ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
                onClick={() => setExpandedCard((current) => (current === 'schedule' ? null : 'schedule'))}
              />
            </div>
          </header>
          <div className={styles.projectScheduleBody}>
            {scheduleTasks.length ? (
              <div className={styles.projectScheduleList}>
                {scheduleTasks.map((task) => (
                  <div key={task.sourceId} className={styles.projectScheduleRow}>
                    <Switch
                      className={styles.projectScheduleSwitch}
                      size="small"
                      checked={task.enabled === true || task.enabled === 1 || task.enabled === '1'}
                      onChange={async (checked) => {
                        await toggleScanSource(Number(task.sourceId), checked ? '1' : '0');
                        await loadScheduleTasks();
                      }}
                    />
                    <Typography.Text strong ellipsis={{ tooltip: task.sourceName }}>
                      {task.sourceName || '-'}
                    </Typography.Text>
                    <Dropdown
                      trigger={['hover']}
                      menu={{
                        items: [
                          { key: 'run', label: '立即执行' },
                          { key: 'edit', label: '编辑' },
                          { key: 'delete', label: '删除', danger: true },
                        ],
                        onClick: async ({ key }) => {
                          if (key === 'run') {
                            try {
                              await triggerScan(Number(task.sourceId));
                              message.success('定时任务已开始执行');
                              await loadScheduleTasks();
                            } catch (error: any) {
                              message.error(error?.message || '定时任务执行失败');
                            }
                          }
                          if (key === 'edit') onEditScheduleTask?.(task);
                          if (key === 'delete') {
                            Modal.confirm({
                              title: '确认删除定时任务？',
                              content: task.sourceName || '该定时任务',
                              okButtonProps: { danger: true },
                              onOk: async () => {
                                await deleteScanSource(Number(task.sourceId));
                                await loadScheduleTasks();
                              },
                            });
                          }
                        },
                      }}
                    >
                      <Button type="text" size="small" icon={<EllipsisOutlined />} />
                    </Dropdown>
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.projectScheduleEmpty}>
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={intl.formatMessage({
                    id: 'employees.scheduleTaskList.empty',
                    defaultMessage: '暂无定时任务',
                  })}
                />
              </div>
            )}
          </div>
        </section>

        {isOperationProject && (
          <section
            className={`${styles.resourceCategoryCard} ${
              expandedCard === 'knowledge' ? styles.resourceCategoryCardExpanded : ''
            }`}
          >
            {renderCardHeader(
              intl.formatMessage({ id: 'projectSpace.resources.sharedKnowledge' }),
              'knowledge',
              openResourceModal
            )}
            {renderBoundResources(boundKnowledge, 'knowledge', <DatabaseOutlined />)}
          </section>
        )}

        {isOperationProject && (
          <section
            className={`${styles.resourceCategoryCard} ${
              expandedCard === 'employee' ? styles.resourceCategoryCardExpanded : ''
            }`}
          >
            {renderCardHeader(
              intl.formatMessage({ id: 'projectSpace.resources.sharedEmployee' }),
              'employee',
              openResourceModal
            )}
            {renderBoundResources(boundEmployees, 'digital_employee', <RobotOutlined />)}
          </section>
        )}

        {isOperationProject && (
          <section
            className={`${styles.resourceCategoryCard} ${
              expandedCard === 'ontology' ? styles.resourceCategoryCardExpanded : ''
            }`}
          >
            {renderCardHeader(
              intl.formatMessage({ id: 'projectSpace.resources.sharedOntology' }),
              'ontology',
              openResourceModal
            )}
            {renderBoundResources(boundOntologies, 'ontology', <ApartmentOutlined />)}
          </section>
        )}
      </div>

      <Modal
        open={createFolderOpen}
        title="新建文件夹"
        onCancel={() => setCreateFolderOpen(false)}
        onOk={() => void handleCreateFolder()}
        okButtonProps={{ disabled: !folderName.trim() }}
        destroyOnClose
      >
        <Input
          value={folderName}
          placeholder="请输入文件夹名称"
          maxLength={100}
          onChange={(event) => setFolderName(event.target.value)}
        />
      </Modal>

      {isOperationProject && (
        <Modal
          open={resourceModalOpen}
          title={intl.formatMessage({ id: 'projectSpace.resources.bindingTitle' })}
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
                <Typography.Text strong>
                  {intl.formatMessage({ id: 'projectSpace.resources.knowledge' })}
                </Typography.Text>
                <Select
                  mode="multiple"
                  value={selectedResources.knowledge}
                  options={knowledgeOptions}
                  loading={resourceOptionsLoading}
                  showSearch
                  optionFilterProp="label"
                  placeholder={intl.formatMessage({ id: 'projectSpace.resources.knowledgePlaceholder' })}
                  onChange={(value) => setSelectedResources((current) => ({ ...current, knowledge: value }))}
                />
              </div>
              <div>
                <Typography.Text strong>
                  {intl.formatMessage({ id: 'projectSpace.resources.employee' })}
                </Typography.Text>
                <Select
                  mode="multiple"
                  value={selectedResources.digital_employee}
                  options={agentOptions}
                  loading={agentOptionsLoading}
                  showSearch
                  optionFilterProp="label"
                  placeholder={intl.formatMessage({ id: 'projectSpace.resources.employeePlaceholder' })}
                  onChange={(value) => setSelectedResources((current) => ({ ...current, digital_employee: value }))}
                />
              </div>
              <div>
                <Typography.Text strong>
                  {intl.formatMessage({ id: 'projectSpace.resources.ontology' })}
                </Typography.Text>
                <Select
                  mode="multiple"
                  value={selectedResources.ontology}
                  options={ontologyOptions}
                  loading={resourceOptionsLoading}
                  showSearch
                  optionFilterProp="label"
                  placeholder={intl.formatMessage({ id: 'projectSpace.resources.ontologyPlaceholder' })}
                  onChange={(value) => setSelectedResources((current) => ({ ...current, ontology: value }))}
                />
              </div>
            </div>
          </Spin>
        </Modal>
      )}

      <Drawer
        title={previewFile?.fileName || intl.formatMessage({ id: 'projectSpace.resources.filePreview' })}
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
            resourceId={project.cloudResourceId ? `${project.cloudResourceId}` : undefined}
            path={previewFile.fileUrl || `/${previewFile.fileName}`}
            fileUrl={undefined}
            source="dataset"
          />
        )}
      </Drawer>

      <Drawer
        title={
          detailRepo?.repoFullName || detailRepo?.repoUrl || intl.formatMessage({ id: 'projectSpace.repository.add' })
        }
        open={!!detailRepo}
        placement="right"
        width="60vw"
        destroyOnClose
        onClose={() => {
          setDetailRepo(null);
          setRepoFiles([]);
          setChildrenByPath({});
          setExpandedKeys([]);
          setBranches([]);
          setSelectedBranch('');
          setFilePreviewContent(null);
        }}
        styles={{ body: { padding: 10 } }}
      >
        {detailRepo && (
          <FileSpaceBlock
            title={detailRepo.repoFullName || ''}
            fillContainer
            loading={repoFilesLoading}
            items={repoFiles}
            currentPath="/"
            emptyText={intl.formatMessage({ id: 'projectSpace.detail.repo.emptyFiles' })}
            resourceEmptyStyle
            childrenByPath={childrenByPath}
            expandedKeys={expandedKeys}
            onExpand={setExpandedKeys}
            onLoadData={loadRepoTreeNode}
            onNodeClick={handleNodeClick}
            headerExtra={
              branches.length > 0 && (
                <Dropdown
                  menu={{
                    items: branches.map((branch) => ({
                      key: branch.name,
                      label: branch.name,
                      onClick: () => void changeBranch(branch.name),
                    })),
                  }}
                  trigger={['click']}
                >
                  <Button type="text" size="small" icon={<DownOutlined />} iconPosition="end" title={selectedBranch}>
                    <BranchesOutlined />
                    <span>{selectedBranch.length > 10 ? `${selectedBranch.substring(0, 10)}...` : selectedBranch}</span>
                  </Button>
                </Dropdown>
              )
            }
          />
        )}
      </Drawer>

      <Drawer
        title={filePreviewContent?.path || ''}
        open={!!filePreviewContent}
        placement="right"
        width="50vw"
        mask={false}
        destroyOnClose
        onClose={() => setFilePreviewContent(null)}
        styles={{ body: { padding: 0, overflow: 'hidden' } }}
      >
        {filePreviewContent && (
          <FilePreviewPanel
            fileName={filePreviewContent.fileName}
            content={{ data: filePreviewContent.content, binary: filePreviewContent.binary }}
          />
        )}
      </Drawer>
    </>
  );
};

export default ProjectResources;
