import { GET, POST } from '@/service/common/request';

/**
 * 本体服务前端调用层。
 *
 * 统一走 ByClaw 后端 `/ontology/*`（后端再包 datacloud + 快照进 ss_resource），
 * 前端不再直连 datacloud；浏览/绑定都经过后端，保证走授权与 ss_resource 一致性。
 */
const ontologyRequestConfig = {
  responseCfg: {
    customHandle: true,
    hideErrorTips: true,
  },
};

export const DEFAULT_ONTOLOGY_SYSTEM_CODE = 'BYCLAW_DATACLOUD';

const normalizeOwnerType = (ownerType?: string) => ownerType || 'personal';
const normalizeSystemCode = (systemCode?: string) => systemCode || DEFAULT_ONTOLOGY_SYSTEM_CODE;

export interface OntologyBase {
  baseId: string;
  displayName: string;
  description?: string;
  ownerType?: string;
  sourceType?: 'LOCAL' | 'REMOTE' | string;
  sourceUrl?: string;
  healthStatus?: string;
  resourceId?: string | number;
  // 所属本体库编码：后端存扩展表 ss_res_ext_ontology.pid，随 ss_resource 列表 join 下发为 pid
  pid?: string;
  ontologyBaseCode?: string;
  // 资源授权标志位（后端按 ss_resource 规则下发）
  canManageAuth?: boolean;
  canUseAuth?: boolean;
  canApplyUse?: boolean;
  canAuditUse?: boolean;
}

export interface OntologyScene {
  sceneId: string;
  sceneName: string;
  sceneCode?: string;
  sceneDesc?: string;
}

export interface OntologyObject {
  objectCode: string;
  objectName: string;
  objectDesc?: string;
  objectSource?: string;
  conceptType?: string;
  fieldCount?: number;
  actionCount?: number;
  properties?: any[];
  actions?: any[];
}

export interface OntologyView {
  viewCode: string;
  viewName: string;
  description?: string;
  objectCodes?: string[];
  properties?: any[];
}

export interface OntologyRelation {
  relationCode: string;
  relationName: string;
  relationCardinality?: string;
  sourceObjectCode?: string;
  sourceObjectName?: string;
  targetObjectCode?: string;
  targetObjectName?: string;
  relationDesc?: string;
}

export interface OntologySceneDetails {
  sceneId?: string;
  sceneName?: string;
  sceneCode?: string;
  sceneDesc?: string;
  objects?: OntologyObject[];
  views?: OntologyView[];
  relations?: OntologyRelation[];
  actions?: any[];
  dbsources?: any[];
  datasources?: any[];
}

/** 列出本体库（个人/企业 tab 与 sider 用；后端读 ss_resource ONTOLOGY_BASE）。 */
export function listOntologyBases(params: { ownerType?: string; queryKeyword?: string } = {}) {
  return POST<any>(
    '/byaiService/ontology/base/list',
    { ownerType: params.ownerType, queryKeyword: params.queryKeyword },
    ontologyRequestConfig
  );
}

/** 列出本体库下的场景。 */
export function listOntologyScenes(params: { ownerType?: string; baseId: string; queryKeyword?: string }) {
  return POST<any>(
    '/byaiService/ontology/scene/list',
    {
      ownerType: normalizeOwnerType(params.ownerType),
      baseId: params.baseId,
      queryKeyword: params.queryKeyword,
    },
    ontologyRequestConfig
  );
}

/** 查询场景详情（对象/视图/关系）。 */
export function getOntologySceneDetails(params: {
  ownerType?: string;
  baseId: string;
  sceneId: string;
  objectCode?: string;
  viewCode?: string;
}) {
  return POST<any>(
    '/byaiService/ontology/scene/detail',
    {
      ownerType: normalizeOwnerType(params.ownerType),
      baseId: params.baseId,
      sceneId: params.sceneId,
      objectCode: params.objectCode,
      viewCode: params.viewCode,
    },
    ontologyRequestConfig
  );
}

/** 获取对象详情（属性 + 动作）。 */
export function getOntologyObjectDetail(params: { objectCode: string; systemCode?: string }) {
  return POST<any>(
    '/byaiService/ontology/object/detail',
    {
      objectCode: params.objectCode,
      systemCode: normalizeSystemCode(params.systemCode),
    },
    ontologyRequestConfig
  );
}

/** 本体库 ss_resource 子树（库/场景/对象/视图），供按粒度安装选择器使用。 */
export function getOntologyBaseTree(params: { baseId: string }) {
  return POST<any>('/byaiService/ontology/base/tree', { baseId: params.baseId }, ontologyRequestConfig);
}

/** 解绑单个本体资源（视图/对象/场景/库）与数字员工的绑定关系。 */
export function unbindOntologyResource(body: { digitalEmployeeId: string | number; relResourceId: string | number }) {
  return POST<any>('/byaiService/ontology/bind/unbind', body, ontologyRequestConfig);
}

/** 单条刷新明细。 */
export interface OntologyRefreshDetail {
  baseCode: string;
  baseName: string;
  action: 'insert' | 'update' | 'offline' | string;
}

/** 刷新结果：汇总 + 明细。 */
export interface OntologyRefreshResult {
  total: number;
  added: number;
  updated: number;
  offline: number;
  details: OntologyRefreshDetail[];
}

/** 刷新企业本体库：从本体管理门户拉取最新本体库并 upsert 进资源体系。 */
export function refreshOntologyBases(params: { ownerType?: string } = {}) {
  return POST<any>(
    '/byaiService/ontology/base/refresh',
    { ownerType: params.ownerType || 'enterprise' },
    ontologyRequestConfig
  );
}

/** 注销/删除本体库（LOCAL 级联 / REMOTE 取消注册）。 */
export function deleteOntologyBase(params: { ownerType?: string; baseId: string }) {
  return POST<any>(
    '/byaiService/ontology/base/delete',
    {
      ownerType: normalizeOwnerType(params.ownerType),
      baseId: params.baseId,
    },
    ontologyRequestConfig
  );
}

type OntologyPayload = Record<string, any>;

const ontologyPost = <T = any>(url: string, body: OntologyPayload) => POST<T>(url, body, ontologyRequestConfig);

/** 本体资源分页查询（开放资源分页接口，后端封装 datacloud/资源库查询）。 */
export function pageOntologyResources(params: {
  ownerType?: string;
  resourceBizType?: 'OBJECT' | 'VIEW' | string;
  resourceBizTypeList?: string[];
  systemCode?: string;
  keyword?: string;
  catalogId?: string | number;
  statusList?: number[];
  permission?: string;
  pageNum?: number;
  pageSize?: number;
}) {
  const keyword = params.keyword?.trim();
  return ontologyPost('/byaiService/ontology/resource/page', {
    // 未传 ownerType 时由后端按当前用户可见范围返回（创建+授权）；指定 enterprise 时保留官方推荐口径。
    ...(params.ownerType ? { ownerType: params.ownerType } : {}),
    resourceBizType: params.resourceBizType,
    resourceBizTypeList: params.resourceBizTypeList,
    systemCode: normalizeSystemCode(params.systemCode),
    keyword,
    resourceName: keyword,
    ...(params.catalogId === undefined || params.catalogId === '' ? {} : { catalogId: params.catalogId }),
    statusList: params.statusList,
    permission: params.permission,
    pageNum: params.pageNum || 1,
    pageSize: params.pageSize || 20,
  });
}

/** 当前用户是否可同步企业本体资源（仅 adminvip）。 */
export function checkOntologyEnterpriseResourceSyncPermission() {
  return GET<any>('/byaiService/ontology/resource/sync/permission', {}, ontologyRequestConfig);
}

/** 从 datacloud 分页同步本体资源到资源表。 */
export function syncOntologyResources(params: {
  ownerType?: string;
  resourceBizType?: 'OBJECT' | 'VIEW' | string;
  resourceBizTypeList?: string[];
  systemCode?: string;
  keyword?: string;
  catalogId?: string | number;
  pageNum?: number;
  pageSize?: number;
}) {
  const keyword = params.keyword?.trim();
  return ontologyPost('/byaiService/ontology/resource/sync', {
    ownerType: normalizeOwnerType(params.ownerType),
    resourceBizType: params.resourceBizType,
    resourceBizTypeList: params.resourceBizTypeList,
    systemCode: normalizeSystemCode(params.systemCode),
    keyword,
    resourceName: keyword,
    ...(params.catalogId === undefined || params.catalogId === '' ? {} : { catalogId: params.catalogId }),
    pageNum: params.pageNum || 1,
    pageSize: params.pageSize || 100,
  });
}

/** 创建场景。 */
export function createOntologyScene(params: { baseId: string; payload?: OntologyPayload } & OntologyPayload) {
  return ontologyPost('/byaiService/ontology/scene/create', params);
}

/** 更新场景。 */
export function updateOntologyScene(
  params: { baseId: string; sceneId: string; payload?: OntologyPayload } & OntologyPayload
) {
  return ontologyPost('/byaiService/ontology/scene/update', params);
}

/** 删除场景。 */
export function deleteOntologyScene(params: { baseId: string; sceneId: string }) {
  return ontologyPost('/byaiService/ontology/scene/delete', params);
}

/** 场景下本体分页查询。 */
export function pageSceneOntologies(params: {
  baseId: string;
  sceneId: string;
  page?: number;
  pageSize?: number;
  keyword?: string;
  cacheMode?: string;
}) {
  return ontologyPost('/byaiService/ontology/scene/ontology/page', params);
}

/** 添加场景成员。 */
export function addOntologySceneMembers(
  params: { baseId: string; sceneId: string; payload?: OntologyPayload } & OntologyPayload
) {
  return ontologyPost('/byaiService/ontology/scene/member/add', params);
}

/** 移除场景成员。 */
export function removeOntologySceneMembers(
  params: { baseId: string; sceneId: string; payload?: OntologyPayload } & OntologyPayload
) {
  return ontologyPost('/byaiService/ontology/scene/member/remove', params);
}

/** 对象列表。 */
export function listOntologyObjects(params: { baseId: string; cacheMode?: string }) {
  return ontologyPost('/byaiService/ontology/object/list', params);
}

/** 创建对象。 */
export function createOntologyObject(params: { baseId: string; payload?: OntologyPayload } & OntologyPayload) {
  return ontologyPost('/byaiService/ontology/object/create', params);
}

/** 更新对象。 */
export function updateOntologyObject(
  params: { baseId: string; objectCode: string; payload?: OntologyPayload } & OntologyPayload
) {
  return ontologyPost('/byaiService/ontology/object/update', params);
}

/** 删除对象。 */
export function deleteOntologyObject(params: { baseId: string; objectCode: string }) {
  return ontologyPost('/byaiService/ontology/object/delete', params);
}

/** 视图列表。 */
export function listOntologyViews(params: { baseId: string; cacheMode?: string }) {
  return ontologyPost('/byaiService/ontology/view/list', params);
}

/** 视图详情。 */
export function getOntologyViewDetail(params: { viewCode: string; systemCode?: string }) {
  return ontologyPost('/byaiService/ontology/view/detail', {
    viewCode: params.viewCode,
    systemCode: normalizeSystemCode(params.systemCode),
  });
}

/** 根据视图编码查询对象列表。 */
export function listOntologyObjectsByView(params: { viewCode: string; systemCode?: string }) {
  return ontologyPost('/byaiService/ontology/view/objects', {
    viewCode: params.viewCode,
    systemCode: normalizeSystemCode(params.systemCode),
  });
}

/** 创建视图。 */
export function createOntologyView(params: { baseId: string; payload?: OntologyPayload } & OntologyPayload) {
  return ontologyPost('/byaiService/ontology/view/create', params);
}

/** 更新视图。 */
export function updateOntologyView(
  params: { baseId: string; viewCode: string; payload?: OntologyPayload } & OntologyPayload
) {
  return ontologyPost('/byaiService/ontology/view/update', params);
}

/** 删除视图。 */
export function deleteOntologyView(params: { baseId: string; viewCode: string }) {
  return ontologyPost('/byaiService/ontology/view/delete', params);
}

/** 关系列表。 */
export function listOntologyRelations(params: { baseId: string; cacheMode?: string }) {
  return ontologyPost('/byaiService/ontology/relation/list', params);
}

/** 根据对象编码查询关系详情列表。 */
export function listOntologyRelationsByObject(params: { objectCode: string; systemCode?: string }) {
  return ontologyPost('/byaiService/ontology/object/relations', {
    objectCode: params.objectCode,
    systemCode: normalizeSystemCode(params.systemCode),
  });
}

/** 关系详情。 */
export function getOntologyRelationDetail(params: { baseId: string; relationCode: string; cacheMode?: string }) {
  return ontologyPost('/byaiService/ontology/relation/detail', params);
}

/** 创建关系。 */
export function createOntologyRelation(params: { baseId: string; payload?: OntologyPayload } & OntologyPayload) {
  return ontologyPost('/byaiService/ontology/relation/create', params);
}

/** 更新关系。 */
export function updateOntologyRelation(
  params: { baseId: string; relationCode: string; payload?: OntologyPayload } & OntologyPayload
) {
  return ontologyPost('/byaiService/ontology/relation/update', params);
}

/** 删除关系。 */
export function deleteOntologyRelation(params: { baseId: string; relationCode: string }) {
  return ontologyPost('/byaiService/ontology/relation/delete', params);
}

/** 数据源列表。 */
export function listOntologyDatasources(params: { baseId: string; cacheMode?: string }) {
  return ontologyPost('/byaiService/ontology/datasource/list', params);
}

/** 数据源详情。 */
export function getOntologyDatasourceDetail(params: { baseId: string; dbId: string; cacheMode?: string }) {
  return ontologyPost('/byaiService/ontology/datasource/detail', params);
}

/** 创建数据源。 */
export function createOntologyDatasource(params: { baseId: string; payload?: OntologyPayload } & OntologyPayload) {
  return ontologyPost('/byaiService/ontology/datasource/create', params);
}

/** 删除数据源。 */
export function deleteOntologyDatasource(params: { baseId: string; dbId: string }) {
  return ontologyPost('/byaiService/ontology/datasource/delete', params);
}

/** 对象动作列表。 */
export function listOntologyActions(params: { baseId: string; objectCode: string; cacheMode?: string }) {
  return ontologyPost('/byaiService/ontology/action/list', params);
}

/** 对象动作详情。 */
export function getOntologyActionDetail(params: {
  baseId: string;
  objectCode: string;
  actionCode: string;
  cacheMode?: string;
}) {
  return ontologyPost('/byaiService/ontology/action/detail', params);
}

/** 创建对象动作。 */
export function createOntologyAction(
  params: {
    baseId: string;
    objectCode: string;
    payload?: OntologyPayload;
  } & OntologyPayload
) {
  return ontologyPost('/byaiService/ontology/action/create', params);
}

/** 更新对象动作。 */
export function updateOntologyAction(
  params: {
    baseId: string;
    objectCode: string;
    actionCode: string;
    payload?: OntologyPayload;
  } & OntologyPayload
) {
  return ontologyPost('/byaiService/ontology/action/update', params);
}

/** 删除对象动作。 */
export function deleteOntologyAction(params: { baseId: string; objectCode: string; actionCode: string }) {
  return ontologyPost('/byaiService/ontology/action/delete', params);
}
