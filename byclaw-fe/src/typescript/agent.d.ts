import { agentTypeMap } from '@/constants/agent';

export type IAgentType = (typeof agentTypeMap)[keyof typeof agentTypeMap];

export type IAgent = {
  // 基础信息
  id: number | string;
  name: string; // 菜单显示的名称
  intro: string;
  resourceName?: string;
  resourceDesc: string;
  ownerType?: 'enterprise' | 'personal' | 'personal_default' | string;
  resourceCode?: string;

  // 头像相关
  avatar: string;

  // 对话相关
  prologue: string;
  // chatHumanNum?: number;

  // 类型和状态
  codeType: string;
  code_type: string;
  agentType?: IAgentType;
  status: string;
  // metaStatus?: string; // 0=草稿箱，1,4=待上架，2=已上架，3=已下架

  // 标签相关
  tagId?: number;
  tagName?: string;

  // 创建者信息
  creater: string;
  creatorName?: string;
  creatorId?: string;
  createTime: string;

  // 管理相关
  manUserName?: string;
  manUserId?: string;
  manPrivNames?: string; // 管理员名称s
  manPrivIds?: string; // 管理员ids
  managePermissions?: boolean;
  authorizeMe?: boolean;

  // 组织信息
  // orgId?: number;
  // orgName?: string;

  // 目录和分类
  catalogId: string | null;
  catalogName?: string;

  // 关注相关
  focus: boolean | null;
  focusCount: string; // 使用次数
  useCount: string; // 订阅次数
  myCreate?: boolean;
  mySubscribe?: boolean;

  // 其他属性
  // faq: string;
  // headers?: unknown;
  url?: string;
  agentHomeUrl?: string;
  // agentSseUrl?: string;
  // agentWebUrl?: string;

  // 数据集和插件
  rel_dataset: string;
  rel_plugin: string;
  // relDataset?: string;
  // relPlugin?: string;

  // 资源ID
  resourceId: string;
  objld: string;

  // 发布相关
  // publishPortal?: string;
  approveStatus?: string; /* A已申请、S申请中、null未申请或申请没通过 */
  // unOrShelf?: boolean;
  // usesPermissions?: boolean;
  terminal?: 'ALL' | 'PC' | 'APP';

  // 置顶
  isTop: string;

  // 其他可选属性
  // homeType?: string;

  // 使用权限类型
  grantType?: 'AVAILABLE_USE' | 'FORCE_USE' | 'ALLOW_MANAGE'; // AVAILABLE_USE:使用授权, FORCE_USE：强制使用（我创建的，强制申请的）, ALLOW_MANAGE:管理授权
  integrationType: string; // 集成方式
  createType: string; // FROM_MANUALLY: 手动创建, FROM_THIRD: 第三方创建
  agentDevType: string;
};

export type IAgentCache = IAgent & {
  agentId: string;
  chatAvatar: string;
  path?: string;
  category?: string;
  knowledgeCount?: number;
  skillsCount?: number;
  resourceName?: string;
  resourceDesc?: string;
  ownerType?: 'enterprise' | 'personal' | 'personal_default' | string;
  createUserName?: string;
  usesPermissions?: boolean;
  canApply?: boolean;

  // 操作权限标志（后端统一计算返回）
  canEdit?: boolean;
  canManageAuth?: boolean;
  canUseAuth?: boolean;
  canDelete?: boolean;
  canApplyUse?: boolean;
  canAuditUse?: boolean;
  canSetDefault?: boolean;
};
