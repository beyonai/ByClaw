import { GET, POST, type ConfigType } from '@/service/common/request';

const withResourceImplDefaults = (data: any = {}) => ({
  ...data,
  implType: data?.implType ?? '',
  workerAgentType: data?.workerAgentType ?? '',
});

export interface KnowledgeCapability {
  knowledgeMode: 'BYAI' | 'THIRD_PARTY';
  allowKnowledgeBaseCreate: boolean;
  allowKnowledgeBaseEdit: boolean;
  allowKnowledgeBaseDelete: boolean;
  allowKnowledgeImport: boolean;
}

export interface EcosystemConnector {
  connectorCode: string;
  connectorName: string;
  category: string;
  available: boolean;
  requiresLocalAgent: boolean;
  requiresBrowserAuth?: boolean;
  runLocations: string[];
  authTypes: string[];
  collectModes?: string[];
  defaultCollectMode?: string;
  capabilities: string[];
  runtimeType: string;
  status: string;
  description: string;
}

export interface EcosystemAgentStatus {
  connected: boolean;
  agentName: string;
  runtimeName: string;
  runtimeVersion: string;
  browserBridgeStatus: string;
  chromeProfile: string;
  lastHeartbeatTime: string;
  siteSessions: Array<{
    siteCode: string;
    siteName: string;
    status: string;
    statusName: string;
  }>;
}

export interface EcosystemSignal {
  signalType: string;
  signalTypeName: string;
  signalCode: string;
  signalName: string;
  confidence: number;
  source: string;
}

export interface EcosystemConnection {
  connectionId: string;
  connectorCode: string;
  ownerType: string;
  authType: string;
  authTypeName: string;
  connectionName: string;
  runLocation: string;
  runLocationName: string;
  credentialConfig?: {
    hasToken?: boolean;
    tokenLast4?: string;
    account?: string;
    imapHost?: string;
    imapPort?: string | number;
    imapSsl?: boolean | string;
    imapFolder?: string;
    oauthProvider?: string;
  };
  runtimeConfig?: Record<string, any>;
  siteSessions?: Array<Record<string, any>>;
  status: string;
  statusName: string;
  lastCheckTime?: string;
  createTime?: string;
}

export interface EcosystemTask {
  taskId: string;
  taskName: string;
  connectorCode: string;
  connectionId?: string;
  connectionName?: string;
  connectionStatus?: string;
  authType?: string;
  lastCheckTime?: string;
  sourceName: string;
  sourceUrl: string;
  scope: string;
  ownerType: string;
  runLocation: string;
  collectMode?: string;
  scheduleType: string;
  scheduleTypeName?: string;
  scheduleConfig?: Record<string, any>;
  nextRunTime?: string;
  lastScheduledRunTime?: string;
  importTarget: string;
  targetName: string;
  status: string;
  createTime: string;
  lastRunId?: string;
  lastRunStatus?: string;
  lastRunStatusName?: string;
  lastRunTime?: string;
  lastMarkdownCount?: number;
  lastFailedCount?: number;
  signals: EcosystemSignal[];
}

export interface EcosystemRun {
  runId: string;
  taskId: string;
  status: string;
  currentStep: string;
  totalCount: number;
  markdownCount: number;
  assetCount: number;
  failedCount: number;
  needActionType?: string;
  needActionMessage?: string;
  needActionStatus?: string;
  storagePath: string;
  targetName: string;
  startedAt: string;
  finishedAt: string;
  steps: Array<{
    stepCode: string;
    stepName: string;
    status: string;
    statusName: string;
    message: string;
  }>;
  artifacts: Array<{
    artifactType: string;
    artifactName: string;
    storagePath: string;
    itemCount: number;
    fileId?: string;
    fileUrl?: string;
    contentType?: string;
    fileSystemType?: string;
    sourceUrl?: string;
  }>;
  signals: EcosystemSignal[];
}

export interface EcosystemTaskCreatePayload {
  taskName: string;
  connectorCode: string;
  connectionId?: string | number;
  sourceUrl?: string;
  scope?: string;
  ownerType: string;
  runLocation: string;
  collectMode?: string;
  scheduleType: string;
  scheduleConfig?: Record<string, any>;
  importTarget: string;
  catalogId?: string | number;
  knowledgeBaseId?: string;
  knowledgeBaseResourceId?: string | number;
  knowledgeBaseName?: string;
  project?: string;
  product?: string;
  customer?: string;
  domain?: string;
  signalTags?: string[];
  assets?: Array<{
    assetType?: string;
    fileName?: string;
    contentType?: string;
    dataUrl?: string;
    sourceUrl?: string;
    alt?: string;
  }>;
  options?: Record<string, any>;
}

export interface EcosystemConnectionSavePayload {
  connectionId?: string | number;
  connectorCode: string;
  authType: string;
  runLocation: string;
  collectMode?: string;
  connectionName?: string;
  token?: string;
  account?: string;
  imapHost?: string;
  imapPort?: string | number;
  imapSsl?: boolean | string;
  imapFolder?: string;
  oauthProvider?: string;
  chromeProfile?: string;
  openCliProfile?: string;
  serverEndpoint?: string;
  siteSessions?: Array<Record<string, any>>;
}

export interface EcosystemSkillPlanPayload extends Partial<EcosystemTaskCreatePayload> {
  originalText?: string;
  text?: string;
  chatSessionId?: string | number;
  chatQueryMessageId?: string | number;
}

export interface EcosystemSkillPlanResult {
  plan: Record<string, any>;
  ready: boolean;
  missingActions: string[];
  card: Record<string, any>;
}

// 查询我创建的文档库列表
export const getResourceListByPage = (data: any) => POST<any>('/byaiService/datasetController/selectDatasetByQo', data);

// 添加文档库（弃用）
export const createResource = (data: any) =>
  POST<any>('/byaiService/datasetController/createDataset', withResourceImplDefaults(data));

// 编辑文档库
export const updateResource = (data: any) =>
  POST<any>('/byaiService/datasetController/updateDataset', withResourceImplDefaults(data));

// 删除文档库
export const deleteResource = (data: any) => POST<any>('/byaiService/datasetController/deleteDataset', data);

// 添加文档库、一键发布
export const createAndShelf = (data: any) =>
  POST<any>('/byaiService/datasetController/createDataset', withResourceImplDefaults(data));

// 查询文档库详情
export const queryResourceDetail = (data: any) => {
  return GET<any>('/byaiService/datasetController/detail', data);
};

// 查询知识库页面能力开关
export const queryKnowledgeCapability = () =>
  GET<KnowledgeCapability>('/byaiService/datasetController/queryKnowledgeCapability');

// 生态采集：连接器清单
export const queryEcosystemConnectors = () => GET<EcosystemConnector[]>('/byaiService/ecosystemCollection/connectors');

// 生态采集：Browser Bridge 状态
export const queryEcosystemBrowserBridgeStatus = () =>
  GET<EcosystemAgentStatus>('/byaiService/ecosystemCollection/browserBridge/status');

// 生态采集：用户连接列表
export const queryEcosystemConnections = (data?: { connectorCode?: string }) =>
  GET<EcosystemConnection[]>('/byaiService/ecosystemCollection/connections', data || {});

// 生态采集：保存用户连接
export const saveEcosystemConnection = (data: EcosystemConnectionSavePayload) =>
  POST<EcosystemConnection>('/byaiService/ecosystemCollection/connections', data);

// 生态采集：创建任务
export const createEcosystemTask = (data: EcosystemTaskCreatePayload) =>
  POST<EcosystemTask>('/byaiService/ecosystemCollection/tasks', data);

// 生态采集：任务列表
export const queryEcosystemTasks = () => GET<EcosystemTask[]>('/byaiService/ecosystemCollection/tasks');

// 生态采集：更新任务状态
export const updateEcosystemTaskStatus = (data: {
  taskId: string | number;
  status: 'CREATED' | 'DISABLED' | 'ARCHIVED';
}) => POST<EcosystemTask>('/byaiService/ecosystemCollection/tasks/status', data);

// 生态采集：启动一次运行
export const startEcosystemRun = (data: { taskId: string | number; triggerType: string }) =>
  POST<EcosystemRun>('/byaiService/ecosystemCollection/runs/start', data);

// 生态采集：查询运行详情
export const queryEcosystemRun = (data: { runId: string | number }) =>
  GET<EcosystemRun>('/byaiService/ecosystemCollection/runs/detail', data);

// 生态采集：处理运行中的待用户动作
export const handleEcosystemRunAction = (data: { runId: string | number; action: string }) =>
  POST<EcosystemRun>('/byaiService/ecosystemCollection/runs/action', data);

// 生态采集：OpenClaw 技能入口生成采集计划
export const buildEcosystemSkillPlan = (data: EcosystemSkillPlanPayload) =>
  POST<EcosystemSkillPlanResult>('/byaiService/ecosystemCollection/skill/plan', data);

// 生态采集：OpenClaw 技能入口确认后启动采集
export const startEcosystemSkillCollection = (data: { plan: Record<string, any> }) =>
  POST<{ task: EcosystemTask; run: EcosystemRun; taskId: string; runId: string; status: string; message: string }>(
    '/byaiService/ecosystemCollection/skill/start',
    data
  );

// 分享文档库
export const share = (data: any) => POST<any>('/byaiService/datasetController/share', data);

// 获取分享详情
export const listAuthDetail = (data: any) => POST<any>('/byaiService/datasetController/listAuthDetail', data);

// 分享给我的文档库列表
export const beShared = (data: any) => POST<any>('/byaiService/datasetController/beShared', data);

// 查询授权给我的文档列表
export const queryAuthDoc = (data: any) => POST<any>('/byaiService/api/v2/resource/queryAuthDoc', data);

// 删除分享给我的文档库
export const delShare = (data: any) => POST<any>('/byaiService/datasetController/delShare', data);

// 新建文件夹
export const createFolder = (data: any) => POST<any>('/byaiService/datasetController/createFolder', data);

// 查询文件列表
export const getDataList = (data: any) => POST<any>('/byaiService/datasetController/getDataList', data);

/** 按层级查询目录与文件 */
export interface QueryDirAndFileByLevelParams {
  resourceId: number;

  /** 当前所在目录路径，根目录为 "/" */
  directoryPath: string;
}

/** queryDirAndFileByLevel 单条记录 */
export interface QueryDirAndFileByLevelItem {
  id: number;
  name: string;
  type: 'directory' | 'file';
  fileId: number | null;
  fileName: string | null;
  createTime: string;

  /** 后端若返回则与构建、下载等接口的路径语义一致 */
  directoryPath?: string;
}

/** datasetController/build 请求体 */
export interface BuildDatasetPayload {
  directoryPath: string;
  resourceId: string;
}

// 查询文件夹和文件列表
export const queryDirAndFileByLevel = (data: QueryDirAndFileByLevelParams) =>
  POST<QueryDirAndFileByLevelItem[]>('/byaiService/datasetController/queryDirAndFileByLevel', data);

/** datasetController/renameFolder 请求体 */
export interface RenameFolderPayload {
  resourceId: number;
  directoryName: string;
  directoryPath: string;
}

// 文件夹重命名（body 仅含 resourceId、directoryName、directoryPath）
export const renameFolder = (data: RenameFolderPayload) =>
  POST<any>('/byaiService/datasetController/renameFolder', data, { languageConf: false });

/** datasetController/deleteFolder 请求体 */
export interface DeleteFolderPayload {
  resourceId: number;
  directoryPath: string;
}

// 删除文件夹（body 仅含 resourceId、directoryPath）
export const deleteFolder = (data: DeleteFolderPayload) =>
  POST<any>('/byaiService/datasetController/deleteFolder', data, { languageConf: false });

// 获取目录树
export const catalogTree = (data: any) => POST<any>('/byaiService/datasetController/catalogTree', data);

/** 删除知识库文件（body 仅含 directoryPath、resourceId，不再附带 language） */
export interface RemoveFilePayload {
  directoryPath: string;
  resourceId: string;
}

// 修改文件
export const updateFileInfo = (data: any) => POST<any>('/byaiService/datasetController/updateFileInfo', data);

// 权限列表
export const getPriviledgeList = (data: any) => POST<any>('/byaiService/datasetController/getPriviledgeList', data);

// 文件构建
export const buildDataset = (data: BuildDatasetPayload) => POST<any>('/byaiService/datasetController/build', data);

/** datasetController/fileBuildStatus 查询参数 */
export interface FileBuildStatusParams {
  resourceId: string | number;
  directoryPath: string;
}

// 查询文件构建状态
export const getFileBuildStatus = (data: FileBuildStatusParams) =>
  GET<any>('/byaiService/datasetController/fileBuildStatus', data);

// 上传文件
export const uploadFiles = (data: FormData) =>
  POST<any>('/byaiService/datasetController/uploadFiles', data, {
    timeout: 8 * 60 * 1000,
    headers: {
      'Content-Type': 'multipart/form-data; charset=utf-8',
    },
  });

// 删除文件
export const removeFile = (data: RemoveFilePayload, config?: ConfigType) =>
  POST<any>('/byaiService/datasetController/removeFile', data, {
    languageConf: false,
    ...config,
  });
