import { POST } from '@/service/common/request';

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

const normalizeOwnerType = (ownerType?: string) => ownerType || 'personal';

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

/** 本体库注册入参（不填 sourceUrl=LOCAL，填了=REMOTE）。 */
export interface OntologyBaseRegister {
  displayName: string;
  description: string;
  baseId?: string;
  ownerType?: string;
  catalogId?: number | string;
  sourceUrl?: string;
  authType?: 'none' | 'api_key' | 'bearer' | 'oauth2' | string;
  authConfig?: Record<string, any>;
  timeoutSec?: number;
}

/** 列出本体库（个人/企业 tab 与 sider 用；后端读 ss_resource ONTOLOGY_BASE）。 */
export function listOntologyBases(params: { ownerType?: string } = {}) {
  return POST<any>('/byaiService/ontology/base/list', { ownerType: params.ownerType }, ontologyRequestConfig);
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
export function getOntologyObjectDetail(params: { ownerType?: string; baseId: string; objectCode: string }) {
  return POST<any>(
    '/byaiService/ontology/object/detail',
    {
      ownerType: normalizeOwnerType(params.ownerType),
      baseId: params.baseId,
      objectCode: params.objectCode,
    },
    ontologyRequestConfig
  );
}

/** 本体库 ss_resource 子树（库/场景/对象/视图），供按粒度安装选择器使用。 */
export function getOntologyBaseTree(params: { baseId: string }) {
  return POST<any>('/byaiService/ontology/base/tree', { baseId: params.baseId }, ontologyRequestConfig);
}

/** 注册/创建本体库（LOCAL 自建 / REMOTE 注册）。 */
export function registerOntologyBase(body: OntologyBaseRegister) {
  return POST<any>('/byaiService/ontology/base/register', body, ontologyRequestConfig);
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
