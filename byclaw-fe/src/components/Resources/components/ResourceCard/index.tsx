import { runWithResourceFeedback } from '@/utils/resourceActionFeedback';
import type { ResourceActionFeedback } from '@/utils/resourceActionFeedback';
import React, { useRef, useState, useEffect, useMemo, useContext, useCallback } from 'react';
import { EllipsisOutlined, MessageOutlined, PlusOutlined } from '@ant-design/icons';
import { Typography, Dropdown, Button, Popconfirm, Tooltip, message, Spin } from 'antd';
import type { MenuProps } from 'antd';
import { getLocale, useDispatch, useIntl, useSelector } from '@umijs/max';
import classnames from 'classnames';
import { debounce, noop } from 'lodash';
import AntdIcon from '@/components/AntdIcon';
import { publishSkillToEnterprise, restoreResource } from '@/pages/manager/service/resources';
import type { EnterpriseSkillPublishResult } from '@/pages/manager/service/resources';
import { setDefaultDigitalEmployee } from '@/service/digitalEmployees';
import { getFileUrl } from '@/utils/file';
import { useRequest } from '@/hooks/useRequest';
import useGlobal from '@/hooks/useGlobal';
import type { IState as IEmployeesState } from '@/models/useEmployees';
import { resourceBizTypeMap } from '@/constants/knowledge';
import { SiderContentContext } from '@/layout/sider/siderContentContext';
import { isWorkspaceSkill, SKILL_DISPLAY_SOURCE_USER_DEVELOPED } from '../../workspaceSkill/utils';
import { useActiveSiderAgent } from '@/layout/sider/components/ActiveSiderAgentBar';
import { useWorkspaceSkillActions } from '../../workspaceSkill/useWorkspaceSkillActions';
import WorkspaceSkillShareAuthModal from '../../workspaceSkill/WorkspaceSkillShareAuthModal';
import type { WorkspaceSkillItem } from '../../workspaceSkill/utils';
import ResourceInstallDialog from '../ResourceInstallDialog';
import type { ResourceInstallTargetContext } from '../../resourceInstallContext';
import styles from './index.module.less';

const { Paragraph } = Typography;
export type ResourceCardActionScene = 'personal' | 'enterprise';

const isTruthyFlag = (value: unknown) => value === true || value === 1 || value === '1' || value === 'true';

export interface IResourceCardItem {
  id?: string | number;
  agentId?: string | number;
  resourceId?: string;
  resourceName?: string;
  resourceCode?: string;
  name?: string;
  resourceDesc?: string;
  intro?: string;
  resourceLogoUrl?: string;
  avatar?: string;
  createdBy?: string;
  createUserName?: string;
  creatorName?: string;
  createTime?: number | string;
  resourceBizType?: string;
  resourceSourcePkId?: string;
  focusCount?: number | string;
  useCount?: number | string;
  memberName?: string;
  manUserName?: string;
  creatorId?: string;
  createBy?: string;
  resourceType?: string;
  hasManagePermission?: boolean;
  hasUsePermission?: boolean;
  canViewDetail?: boolean;
  canEdit?: boolean;
  canManageAuth?: boolean;
  canUseAuth?: boolean;
  canApplyUse?: boolean;
  canDelete?: boolean;
  canOnShelf?: boolean;
  canOffShelf?: boolean;
  canPublishToEnterprise?: boolean;
  canUnShelf?: boolean;
  canDeleteData?: boolean;
  canSetDefault?: boolean;
  canRestore?: boolean;
  approveStatus?: string;
  useApplyPending?: boolean;
  resourceStatus?: number | string;
  metaStatus?: number | string;
  ownerType?: string;
  agentType?: string;
  isDefault?: boolean | string;
  openSuperHelper?: string;
  tagName?: string;
  displaySourceType?: string;
  skillType?: string;
  sourceType?: string;
  version?: string;
  skillUrl?: string;
  skillPackageFormat?: string;
  skillOriginalFilename?: string;
  skillPackageSize?: number | string;
  skillPackageHash?: string;
  targetContent?: string;
  syncStatus?: string;
  syncError?: string;
  lastSyncTime?: string;

  /** 列表接口已一次性回填当前用户操作权限时为 true。 */
  operationPermissionsLoaded?: boolean;
}

type ResourceCardActionConfig = {
  scene?: ResourceCardActionScene;
  installedResourceIds?: ReadonlySet<string>;
  canInstallToTarget?: boolean;
  installTargetContext?: ResourceInstallTargetContext;

  /** 当前用户对该数字员工是否有管理权限，无则隐藏工作空间技能的删除入口。 */
  canManageWorkspaceSkill?: boolean;
  enableKnowledgeManage?: boolean;
  editDisabledTip?: React.ReactNode;
  manageAuthDisabledTip?: React.ReactNode;
  useAuthDisabledTip?: React.ReactNode;
  applyUseDisabledTip?: React.ReactNode;
  auditUseDisabledTip?: React.ReactNode;
  deleteDisabledTip?: React.ReactNode;
  restoreDisabledTip?: React.ReactNode;
  applyDisabledTip?: React.ReactNode;
  extraMenuItems?: ExtraResourceMenuItem[];
  hiddenMenuItemKeys?: string[];
  onApplyUse?: () => void;
  onAuditUse?: () => void;
  onDelete?: (feedback: ResourceActionFeedback) => void | Promise<void>;
  onDeleteData?: (feedback: ResourceActionFeedback) => void | Promise<void>;
  onShelf?: (feedback: ResourceActionFeedback) => void | Promise<void>;
  onUnShelf?: (feedback: ResourceActionFeedback) => void | Promise<void>;

  /** 品牌参数加载完成且非商业版时，由资源页开启此入口。 */
  enablePublishToEnterprise?: boolean;
  onEnterpriseSkillDetail?: (resource: EnterpriseSkillPublishResult['resource']) => void;

  /** 资源中心使用独立的上下架和注销流程，工作空间技能仍走原有文件操作。 */
  enableResourceLifecycle?: boolean;
  lifecycleLoading?: boolean;
  enableDigitalEmployeeLifecycle?: boolean;
  enableDigitalEmployeeDelete?: boolean;
  showDigitalEmployeeTypeTag?: boolean;

  /** 资源浏览页展示个人/企业归属，管理页保留生命周期状态。 */
  showResourceTypeTag?: boolean;
  onRestore?: () => void;
  onAuth?: (authType: 'useAuth' | 'mgrAuth') => void;
  onEdit?: () => void;
  onApply?: () => void;
  /** 仅数字员工“我可用的”页签开启，其他使用卡片的场景默认隐藏。 */
  enableSetDefault?: boolean;
  onSetDefault?: () => void;
  onChat?: () => void;
};

type ExtraResourceMenuItem = NonNullable<MenuProps['items']>[number] & {
  visible?: (resource: IResourceCardItem) => boolean;
};

export type ResourceCardProps = {
  resource: IResourceCardItem;
  resourceType?: string;
  onCardClick?: (resource?: IResourceCardItem) => void;
  cardClickDisabled?: boolean | ((resource: IResourceCardItem) => boolean);
  onCardClickDisabled?: (resource?: IResourceCardItem) => void;
  actionConfig?: ResourceCardActionConfig;
  avatarNode?: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
  headerExtra?: React.ReactNode;
  metaNode?: React.ReactNode;
  hoverExtra?: React.ReactNode;
  className?: string;
  variant?: 'default' | 'skillPoster';
  digitalEmployeeActionMode?: boolean;
};

const ResourceInfo = (props: { resource: IResourceCardItem; className?: string }) => {
  const { resource } = props;
  const intl = useIntl();
  return (
    <div className={classnames(styles.resourceMeta, 'ub ub-ac gap2 ellipsis')}>
      <span className={styles.resourceMetaLabel}>{intl.formatMessage({ id: 'resource.creator' })}：</span>
      <span
        className={classnames(styles.resourceMetaName, 'ellipsis ub-f1')}
        title={resource?.creatorName || resource?.createUserName || intl.formatMessage({ id: 'common.none' })}
      >
        {resource?.creatorName || resource?.createUserName || intl.formatMessage({ id: 'common.none' })}
      </span>
    </div>
  );
};

const BuildMenuLabel = ({
  icon,
  text,
  disabled,
  disabledTip,
  loading,
}: {
  icon: string;
  text: string;
  disabled?: boolean;
  disabledTip?: React.ReactNode;
  loading?: boolean;
}) => {
  const intl = useIntl();

  const content = (
    <div
      className={classnames(styles.menuItem, {
        [styles.menuItemDisabled]: disabled || loading,
      })}
    >
      {loading ? <AntdIcon type="icon-a-loading" className={styles.menuItemLoading} /> : <AntdIcon type={icon} />}
      <span>{loading ? intl.formatMessage({ id: 'common.processing' }) : text}</span>
    </div>
  );

  if (!disabled && !loading) {
    return content;
  }

  return <Tooltip title={disabledTip || intl.formatMessage({ id: 'common.noPermissionOperation' })}>{content}</Tooltip>;
};

const ConfirmMenuLabel = ({
  title,
  disabled,
  loading,
  children,
  onConfirm,
}: {
  title: React.ReactNode;
  disabled?: boolean;
  loading?: boolean;
  children: React.ReactNode;
  onConfirm: () => void;
}) => {
  const intl = useIntl();
  return (
    <Popconfirm
      title={title}
      okText={intl.formatMessage({ id: 'common.confirm' })}
      cancelText={intl.formatMessage({ id: 'common.cancel' })}
      disabled={disabled || loading}
      okButtonProps={{ loading }}
      cancelButtonProps={{ disabled: loading }}
      onConfirm={(event) => {
        event?.stopPropagation();
        onConfirm();
      }}
      onCancel={(event) => event?.stopPropagation()}
    >
      <div
        className={styles.confirmMenuTrigger}
        onMouseDown={(event) => {
          // 防止按下菜单项时触发卡片点击，但保留 click 事件给 antd Menu/Popconfirm 处理。
          event.stopPropagation();
        }}
      >
        {children}
      </div>
    </Popconfirm>
  );
};

/**
 * 安装进行中遮罩（样式 A）：半透明覆盖整卡 + 居中转圈与「安装中…」+ 底部无限滚动进度条。
 * 安装为一次性阻塞请求、无真实进度，故进度条为不确定(indeterminate)动画。遮罩吞掉点击防止重复操作。
 */
const InstallingOverlay = () => {
  const intl = useIntl();
  return (
    <div
      className={styles.installingOverlay}
      onClick={(event) => {
        event.stopPropagation();
        event.preventDefault();
      }}
    >
      <div className={styles.installingInner}>
        <Spin size="small" />
        <span className={styles.installingText}>{intl.formatMessage({ id: 'resource.installing' })}</span>
      </div>
      <div className={styles.installingBar}>
        <span className={styles.installingBarInner} />
      </div>
    </div>
  );
};

const getInstallLabelId = (resource: IResourceCardItem, resourceType?: string) => {
  const bizType = resource?.resourceBizType || resourceType;
  if (['KG_DOC', 'KG_QA', 'KG_TERM'].includes(bizType || '')) return 'resource.installKnowledge';
  if (bizType === 'SKILL' || resourceType === 'SKILL') return 'resource.installSkill';
  return 'resource.installTool';
};

// 按资源所属模块展示删除文案，知识和工具的子类型使用相同的模块名称。
const getDeleteLabelId = (resource: IResourceCardItem, resourceType?: string) => {
  const bizType = resource?.resourceBizType || resourceType;
  if (['KG_DOC', 'KG_QA', 'KG_TERM'].includes(bizType || '')) return 'resource.deleteKnowledge';
  if (bizType === 'SKILL' || resourceType === 'SKILL') return 'resource.deleteSkill';
  if (['TOOL', 'TOOLKIT', 'MCP', 'AGENT'].includes(bizType || '') || resourceType === 'TOOL') {
    return 'resource.deleteTool';
  }
  return 'common.deleteResource';
};

const canInstallResource = (resource: IResourceCardItem, resourceType?: string) => {
  const bizType = resource?.resourceBizType || resourceType;
  if (bizType === 'SKILL' || resourceType === 'SKILL') {
    return Boolean(resource?.resourceId && resource?.hasUsePermission);
  }
  // 阻止历史已下线资源再次安装。
  if (bizType === 'ONTOLOGY_BASE' || resourceType === 'ONTOLOGY_BASE') {
    return false;
  }
  return Boolean(resource?.resourceId && bizType && bizType !== 'DIG_EMPLOYEE');
};

const isSkillResource = (resource: IResourceCardItem, resourceType?: string) => {
  return resource?.resourceBizType === 'SKILL' || resourceType === 'SKILL';
};

const isInnerSkillResource = (resource: IResourceCardItem, resourceType?: string) => {
  return isSkillResource(resource, resourceType) && `${resource?.skillType || ''}`.toLowerCase() === 'inner';
};

const formatSkillAddedCount = (count: number, locale: string) => {
  if (locale?.startsWith('zh')) {
    if (count >= 10000) {
      const wanCount = count / 10000;
      return wanCount >= 10 ? `${Math.floor(wanCount)}万` : `${Number(wanCount.toFixed(1))}万`;
    }
    return `${count}`;
  }

  if (count >= 1000000) {
    return `${Number((count / 1000000).toFixed(1))}M`;
  }
  if (count >= 1000) {
    return `${Number((count / 1000).toFixed(1))}K`;
  }
  return `${count}`;
};

const RenderContent = (props: ResourceCardProps) => {
  const {
    resource,
    onCardClick,
    cardClickDisabled,
    onCardClickDisabled,
    actionConfig,
    avatarNode,
    description,
    headerExtra,
    hoverExtra,
    metaNode,
    resourceType,
    variant = 'default',
    digitalEmployeeActionMode = false,
  } = props;
  const { ownerType } = resource || {};
  const isWorkspaceSkillResource = isWorkspaceSkill(resource);
  const enableResourceLifecycle = actionConfig?.enableResourceLifecycle === true && !isWorkspaceSkillResource;
  const currentResourceStatus = `${resource?.resourceStatus ?? resource?.metaStatus ?? ''}`;
  const isDeletedDigitalEmployee =
    (resource?.resourceBizType === resourceBizTypeMap.DIG_EMPLOYEE ||
      resourceType === resourceBizTypeMap.DIG_EMPLOYEE) &&
    currentResourceStatus === '-1';
  const canApplyUseForStatus = enableResourceLifecycle
    ? currentResourceStatus === '2'
    : currentResourceStatus !== '3' && currentResourceStatus !== '-1';
  const {
    onEdit = noop,
    onAuth = noop,
    onApplyUse = noop,
    onRestore = noop,
    onDelete: onDeleteAction = noop,
    onDeleteData: onDeleteDataAction = noop,
    onShelf: onShelfAction = noop,
    onUnShelf: onUnShelfAction = noop,
    onEnterpriseSkillDetail,
    onSetDefault = noop,
    onChat = noop,
  } = actionConfig || {};
  const intl = useIntl();
  const lifecycleLock = useRef(false);
  const [processingLifecycle, setProcessingLifecycle] = useState(false);
  // 提示只覆盖当前操作，异步期间锁定本卡片，其他卡片和列表仍可交互。
  const runLifecycle = useCallback(
    async (action: (feedback: ResourceActionFeedback) => void | Promise<void>) => {
      if (lifecycleLock.current) return;
      lifecycleLock.current = true;
      setProcessingLifecycle(true);
      try {
        await runWithResourceFeedback(
          action,
          intl.formatMessage({ id: 'common.processing' }),
          intl.formatMessage({ id: 'common.operationFailed' })
        );
      } finally {
        lifecycleLock.current = false;
        setProcessingLifecycle(false);
      }
    },
    [intl]
  );
  const onShelf = useCallback(() => runLifecycle(onShelfAction), [runLifecycle, onShelfAction]);
  const onUnShelf = useCallback(() => runLifecycle(onUnShelfAction), [runLifecycle, onUnShelfAction]);
  const onDeleteData = useCallback(() => runLifecycle(onDeleteDataAction), [runLifecycle, onDeleteDataAction]);
  const onDelete = useCallback(() => runLifecycle(onDeleteAction), [runLifecycle, onDeleteAction]);
  const enableDigitalEmployeeLifecycle = actionConfig?.enableDigitalEmployeeLifecycle !== false;
  const enableDigitalEmployeeDelete = actionConfig?.enableDigitalEmployeeDelete === true;
  // Standalone cards keep the descriptive employee-type tag by default; list
  // views can explicitly opt into lifecycle status tags when needed.
  const showDigitalEmployeeTypeTag = actionConfig?.showDigitalEmployeeTypeTag ?? true;

  const dispatch = useDispatch();
  const { agentId, agentInfo, EventEmitter } = useGlobal();
  const [digitalEmployeeMenuOpen, setDigitalEmployeeMenuOpen] = useState(false);
  const [installDialogOpen, setInstallDialogOpen] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [publishingToEnterprise, setPublishingToEnterprise] = useState(false);
  const [enterpriseCopyCreated, setEnterpriseCopyCreated] = useState(false);
  const publishToEnterpriseLock = useRef(false);
  useEffect(() => {
    setEnterpriseCopyCreated(false);
  }, [resource]);
  const { userInfo, defaultDigEmployeeId } = useSelector(
    ({ user, employees }: { user: any; employees: IEmployeesState }) => ({
      userInfo: user.userInfo,
      defaultDigEmployeeId: employees.defaultDigEmployeeId,
    })
  );
  const activeDigitalEmployeeId =
    agentId || agentInfo?.agentId || defaultDigEmployeeId || userInfo?.defaultDigEmployeeId;

  // 工作空间(用户开发)技能：复用公共 hook 处理详情 / 分享(资源化) / 删除，与左边栏一致。
  const { setDetailPanel, clearDetailPanel } = useContext(SiderContentContext);
  // 与左边栏同源解析当前数字员工名，保证“使用它的数字员工”展示一致（agentInfo 在技能中心页常为空）。
  const activeSiderAgent = useActiveSiderAgent();
  const [workspaceShareRecord, setWorkspaceShareRecord] = useState<WorkspaceSkillItem | null>(null);
  const notifySkillListReload = () => EventEmitter?.emit('beyond-resourceList-resourceType-reload', 'SKILL');
  const workspaceActions = useWorkspaceSkillActions({
    resourceId: activeDigitalEmployeeId,
    agentName: activeSiderAgent.name,
    setDetailPanel,
    clearDetailPanel,
    onShareAuth: (item) => setWorkspaceShareRecord(item),
    onChanged: notifySkillListReload,
  });

  const { mutate: handleRestore, isLoading: restoring } = useRequest({
    mutationFn: (params: any) => {
      return restoreResource({ resourceId: params.resourceId });
    },
    onSuccess: () => {
      message.success(intl.formatMessage({ id: 'common.restoreSuccess' }));
      onRestore?.();
      // 触发自定义事件通知父组件刷新列表
      window.dispatchEvent(new CustomEvent('resourceRestored', { detail: { resourceId: resource?.resourceId } }));
    },
    onError: () => {
      // 提示重复所以注销掉了
      // message.error(intl.formatMessage({ id: 'common.operationFailed' }));
    },
  });
  const installTargetContext = actionConfig?.installTargetContext || { mode: 'select' as const };

  const displayTitle = resource.resourceName || resource.name || intl.formatMessage({ id: 'common.none' });
  const displayDescription =
    description ?? resource.resourceDesc ?? resource.intro ?? intl.formatMessage({ id: 'common.none' });
  const displayImage = resource.resourceLogoUrl || resource.avatar;
  const displayImageUrl = displayImage ? getFileUrl(displayImage) : '';
  const [displayImageLoadFailed, setDisplayImageLoadFailed] = useState(false);
  const [settingDefault, setSettingDefault] = useState(false);
  const settingDefaultLockRef = useRef(false);
  const creatorName =
    resource?.creatorName ||
    resource?.createUserName ||
    resource?.memberName ||
    intl.formatMessage({ id: 'common.none' });
  const rawUseCount = Number(resource?.useCount || resource?.focusCount || 0);
  const useCount = Number.isFinite(rawUseCount) ? rawUseCount : 0;
  const normalizedSkillSourceType = `${resource?.displaySourceType || resource?.sourceType || ''}`
    .replace(/[-\s]/g, '_')
    .toUpperCase();
  const skillSourceLabelMap: Record<string, string> = {
    ASSISTANT_BOUND: 'resource.skillSource.assistantBound',
    LOBSTER_INSTALLED: 'resource.skillSource.lobsterInstalled',
    [SKILL_DISPLAY_SOURCE_USER_DEVELOPED]: 'resource.skillSource.userDeveloped',
  };
  const skillSourceName = skillSourceLabelMap[normalizedSkillSourceType]
    ? intl.formatMessage({ id: skillSourceLabelMap[normalizedSkillSourceType] })
    : creatorName;
  const formattedSkillAddedCount = formatSkillAddedCount(useCount, getLocale());
  useEffect(() => {
    setDisplayImageLoadFailed(false);
  }, [displayImageUrl]);

  const isDigitalEmployeeResource =
    resource.resourceBizType === resourceBizTypeMap.DIG_EMPLOYEE || resourceType === resourceBizTypeMap.DIG_EMPLOYEE;
  const isPublishedDigitalEmployee =
    !isDigitalEmployeeResource || `${resource?.resourceStatus ?? resource?.metaStatus ?? ''}` === '2';
  const isPendingUseApproval =
    isPublishedDigitalEmployee &&
    canApplyUseForStatus &&
    (resource.approveStatus === 'S' || isTruthyFlag(resource.useApplyPending));
  const canApplyForUse =
    isPublishedDigitalEmployee &&
    canApplyUseForStatus &&
    !isTruthyFlag(resource.hasUsePermission) &&
    isTruthyFlag(resource.canApplyUse);
  const resourceIdentity = `${resource.resourceId ?? resource.id ?? ''}`;
  const defaultEmployeeIdentity = `${defaultDigEmployeeId || userInfo?.defaultDigEmployeeId || ''}`;
  const isDefaultDigitalEmployee =
    isDigitalEmployeeResource &&
    (isTruthyFlag(resource.isDefault) ||
      (Boolean(defaultEmployeeIdentity) && resourceIdentity === defaultEmployeeIdentity));
  const showResourceTypeTag = actionConfig?.showResourceTypeTag === true;
  const normalizedOwnerType = `${ownerType || ''}`.toLowerCase();
  // 未资源化的工作空间技能来自个人技能列表，接口没有 ownerType。
  const isPersonalResource = isWorkspaceSkillResource || ['personal', 'personal_default'].includes(normalizedOwnerType);
  const showResourceStatusTag = enableResourceLifecycle && !showResourceTypeTag;
  const isPersonalDigitalEmployee =
    isDigitalEmployeeResource && (normalizedOwnerType === 'personal' || normalizedOwnerType === 'personal_default');
  const isDigitalEmployeeGroup = isDigitalEmployeeResource && `${resource.agentType || ''}` === '017';

  const getDigitalEmployeeTypeTag = () => {
    if (!isDigitalEmployeeResource) return undefined;
    if (isPersonalDigitalEmployee) {
      return intl.formatMessage({
        id: isDigitalEmployeeGroup ? 'digitalEmployees.tag.personalGroup' : 'digitalEmployees.tag.personalEmployee',
      });
    }
    return intl.formatMessage({
      id: isDigitalEmployeeGroup ? 'digitalEmployees.tag.enterpriseGroup' : 'digitalEmployees.tag.enterpriseEmployee',
    });
  };

  const getDisplayTopRightTag = () => {
    // 类型标签只改变展示，继续保留资源的上下架及权限操作逻辑。
    if (showResourceTypeTag) {
      const type = resourceType === 'SKILL' ? 'Skill' : resourceType === 'KG_DOC' ? 'Knowledge' : 'Tool';
      return intl.formatMessage({ id: `resource.tag.${isPersonalResource ? 'personal' : 'enterprise'}${type}` });
    }
    // 数字员工状态由后端 resourceStatus 返回，统一映射为卡片右上角状态标签。
    if ((isDigitalEmployeeResource && !showDigitalEmployeeTypeTag) || showResourceStatusTag) {
      const statusLabelMap: Record<string, string> = {
        '-1': enableResourceLifecycle ? 'resource.statusCancelled' : 'resourceStatus.deleted',
        '0': 'resourceStatus.draft',
        '1': 'resourceStatus.pendingShelf',
        '2': 'resourceStatus.published',
        '3': 'resourceStatus.unpublished',
      };
      // 员工组与数字员工接口的状态字段可能不同，统一按同一组回退字段取值。
      const statusMessageId =
        statusLabelMap[
          `${resource.resourceStatus ?? resource.metaStatus ?? resource.publishStatus ?? resource.status ?? ''}`
        ];
      if (statusMessageId) return intl.formatMessage({ id: statusMessageId });
    }
    const digitalEmployeeTypeTag = getDigitalEmployeeTypeTag();
    if (digitalEmployeeTypeTag) {
      return digitalEmployeeTypeTag;
    }
    // 优先展示真实标签。
    if (resource.tagName) {
      return resource.tagName;
    }
    if (isInnerSkillResource(resource, resourceType)) {
      return intl.formatMessage({ id: 'resource.systemBuiltin' });
    }
    // 超级助手只按 resourceCode 后缀识别，不再依赖 ownerType=personal_default。
    if (
      resource.resourceBizType === 'DIG_EMPLOYEE' &&
      ownerType === 'personal' &&
      resource.resourceCode?.endsWith('_main')
    ) {
      return intl.formatMessage({ id: 'resource.superAssistant' });
    }
    // 个人助理
    if (resource.resourceBizType === 'DIG_EMPLOYEE' && (ownerType === 'personal' || ownerType === 'personal_default')) {
      return intl.formatMessage({ id: 'resource.personalAssistant' });
    }
    // 默认知识库
    if (resource.resourceBizType === 'KG_DOC' && ownerType === 'personal_default') {
      return intl.formatMessage({ id: 'resource.personalDefaultKnowledgeDoc' });
    }
    // 工具类型、知识库类型
    const tagMap: Record<string, string> = {
      MCP: 'resource.mcp',
      TOOLKIT: 'resource.toolkit',
      AGENT: 'resource.agent',
      KG_DOC: 'resource.kgDoc',
      KG_TERM: 'resource.kgTerm',
      KG_QA: 'resource.kgQa',
    };
    const bizType = resource.resourceBizType;
    if (bizType && tagMap[bizType]) {
      return intl.formatMessage({ id: tagMap[bizType] });
    }
    return undefined;
  };
  const displayTopRightTag = getDisplayTopRightTag();
  const digitalEmployeeStatus = `${
    resource?.resourceStatus ?? resource?.metaStatus ?? resource?.publishStatus ?? resource?.status ?? ''
  }`;
  // 资源中心的注销记录与数字员工删除记录都进入只读终态；其他复用卡片继续保留原有行为。
  const isCancelledResource = (enableResourceLifecycle || isDigitalEmployeeResource) && digitalEmployeeStatus === '-1';
  const statusTagTextMap: Record<string, string> = {
    已上架: '2',
    Published: '2',
    已下架: '3',
    Unpublished: '3',
    草稿: '0',
    草稿箱: '0',
    Draft: '0',
    待上架: '1',
    'Pending publication': '1',
    已删除: '-1',
    已注销: '-1',
    Deleted: '-1',
    Cancelled: '-1',
    ON_SHELF: '2',
    OFF_SHELF: '3',
    PUBLISHED: '2',
    UNPUBLISHED: '3',
    DRAFT: '0',
    PENDING_SHELF: '1',
  };
  // 部分旧接口仅返回状态标签文本，按文本补齐状态样式，避免同一状态出现不同颜色。
  const rawStatusKey = `${digitalEmployeeStatus || ''}`.trim();
  const normalizedStatus =
    statusTagTextMap[rawStatusKey] ||
    statusTagTextMap[rawStatusKey.toUpperCase()] ||
    statusTagTextMap[`${displayTopRightTag || ''}`] ||
    '';
  const statusTagClass =
    (isDigitalEmployeeResource && !showDigitalEmployeeTypeTag) || showResourceStatusTag
      ? normalizedStatus === '-1'
        ? 'digitalEmployeeStatusDeleted'
        : normalizedStatus
          ? `digitalEmployeeStatus${normalizedStatus}`
          : ''
      : '';
  const topRightTag = displayTopRightTag;
  const isInnerSkill = isInnerSkillResource(resource, resourceType);
  const isInstalledResource = Boolean(
    resource?.resourceId && actionConfig?.installedResourceIds?.has(`${resource.resourceId}`)
  );
  const isCardClickDisabled =
    typeof cardClickDisabled === 'function' ? cardClickDisabled(resource) : !!cardClickDisabled;

  const handleSetDefault = useCallback(async () => {
    if (settingDefaultLockRef.current) {
      return;
    }

    const resourceId = resource.resourceId ?? resource.id;
    if (!resourceId) {
      return;
    }

    settingDefaultLockRef.current = true;
    setSettingDefault(true);
    const messageKey = `set-default-digital-employee-${resourceId}`;
    message.loading({
      key: messageKey,
      content: intl.formatMessage({ id: 'common.processing' }),
      duration: 0,
    });

    try {
      const result: any = await setDefaultDigitalEmployee({ resourceId });
      if (result?.success === false || (result?.code !== undefined && result.code !== 0)) {
        throw new Error(result?.msg || intl.formatMessage({ id: 'common.operationFailed' }));
      }

      const defaultResourceId = `${result?.newResourceId ?? result?.data?.newResourceId ?? resourceId}`;
      dispatch({
        type: 'employees/save',
        payload: { defaultDigEmployeeId: defaultResourceId },
      });
      EventEmitter?.emit('beyond-update-employee', { defaultResourceId });
      EventEmitter?.emit('default-digital-employee-changed', { defaultResourceId });
      onSetDefault?.();
      message.success({
        key: messageKey,
        content: intl.formatMessage({ id: 'resource.setDefaultAssistantSuccess' }),
      });
    } catch (error: any) {
      message.error({
        key: messageKey,
        content: error?.message || error || intl.formatMessage({ id: 'common.operationFailed' }),
      });
    } finally {
      settingDefaultLockRef.current = false;
      setSettingDefault(false);
    }
  }, [EventEmitter, dispatch, intl, onSetDefault, resource.id, resource.resourceId]);

  const handleSetDefaultDebounced = useMemo(
    () =>
      debounce(
        () => {
          void handleSetDefault();
        },
        300,
        { leading: true, trailing: false }
      ),
    [handleSetDefault]
  );

  useEffect(() => () => handleSetDefaultDebounced.cancel(), [handleSetDefaultDebounced]);

  const handlePublishToEnterprise = useCallback(async () => {
    if (!resource.resourceId || publishToEnterpriseLock.current) return;
    publishToEnterpriseLock.current = true;
    setPublishingToEnterprise(true);
    const messageKey = `publish-enterprise-${resource.resourceId}`;
    message.loading({ key: messageKey, content: intl.formatMessage({ id: 'common.processing' }), duration: 0 });
    try {
      const result = await publishSkillToEnterprise(resource.resourceId);
      // 仅更新当前卡片，不刷新或重新挂载列表，避免 loading 结束时列表短暂空白。
      setEnterpriseCopyCreated(true);
      message.success({
        key: messageKey,
        content: (
          <span>
            {intl.formatMessage({
              id: result.alreadyExists ? 'resource.enterpriseSkillExists' : 'resource.publishToEnterpriseSuccess',
            })}
            {onEnterpriseSkillDetail && (
              <Button type="link" onClick={() => onEnterpriseSkillDetail(result.resource)}>
                {intl.formatMessage({ id: 'resource.viewEnterpriseSkill' })}
              </Button>
            )}
          </span>
        ),
        duration: 6,
      });
    } catch (error) {
      message.error({
        key: messageKey,
        content:
          typeof error === 'string'
            ? error
            : error instanceof Error
              ? error.message
              : intl.formatMessage({ id: 'resource.publishToEnterpriseFailed' }),
      });
    } finally {
      publishToEnterpriseLock.current = false;
      setPublishingToEnterprise(false);
    }
  }, [resource.resourceId, onEnterpriseSkillDetail, intl]);

  const menuItems = useMemo<MenuProps['items']>(() => {
    const {
      canEdit,
      canManageAuth,
      canUseAuth,
      canApplyUse,
      canDelete,
      canOnShelf,
      canOffShelf,
      canSetDefault,
      canRestore,
    } = resource || {};
    const items: NonNullable<MenuProps['items']> = [];
    // 注销为终态，即使列表中残留旧权限也不展示可操作入口。
    if (isCancelledResource) return items;
    // 企业数字员工的操作权限接口以 canEdit 表示管理权限；兼容部分旧返回未带 canOffShelf 的情况。
    const canManageEnterpriseDigitalEmployee =
      isDigitalEmployeeResource && `${ownerType || ''}`.toLowerCase() === 'enterprise' && canEdit === true;
    const digitalEmployeeStatus = `${resource?.resourceStatus ?? resource?.metaStatus ?? ''}`;

    // 仅我可用的页签提供设为默认，同时保留使用权限和后端设置权限校验。
    if (
      isDigitalEmployeeResource &&
      actionConfig?.enableSetDefault === true &&
      isTruthyFlag(resource.hasUsePermission) &&
      canSetDefault === true &&
      !isDefaultDigitalEmployee
    ) {
      items.push({
        key: 'setDefaultAssistant',
        label: (
          <ConfirmMenuLabel
            title={intl.formatMessage({ id: 'resource.setDefaultAssistantConfirm' })}
            loading={settingDefault}
            onConfirm={handleSetDefaultDebounced}
          >
            <BuildMenuLabel
              icon="icon-a-Useryonghu"
              text={intl.formatMessage({ id: 'resource.setDefaultAssistant' })}
              loading={settingDefault}
            />
          </ConfirmMenuLabel>
        ),
      });
    }

    // 编辑信息
    if (canEdit && !isInnerSkill) {
      items.push({
        key: 'edit',
        label: <BuildMenuLabel icon="icon-a-Editorbianji" text={intl.formatMessage({ id: 'common.editInfo' })} />,
        onClick: () => {
          onEdit?.();
        },
      });
    }

    // 独立发布权限由后端返回；可编辑/可使用不代表允许复制到企业。
    if (
      isSkillResource(resource, resourceType) &&
      isPersonalResource &&
      !isWorkspaceSkillResource &&
      currentResourceStatus !== '-1' &&
      resource.resourceId &&
      !enterpriseCopyCreated &&
      actionConfig?.enablePublishToEnterprise === true &&
      resource.canPublishToEnterprise === true
    ) {
      items.push({
        key: 'publishToEnterprise',
        label: (
          <ConfirmMenuLabel
            title={intl.formatMessage({ id: 'resource.publishToEnterpriseConfirm' })}
            loading={publishingToEnterprise}
            onConfirm={handlePublishToEnterprise}
          >
            <BuildMenuLabel
              icon="icon-a-Uploadshangchuan"
              text={intl.formatMessage({ id: 'resource.publishToEnterprise' })}
              loading={publishingToEnterprise}
            />
          </ConfirmMenuLabel>
        ),
      });
    }

    // 下架记录不提供授权入口，兼容旧接口的状态文本；上架后仍按原权限展示。
    const isOffShelf = rawStatusKey === '3' || normalizedStatus === '3';
    // 管理授权
    if (canManageAuth && !isOffShelf) {
      items.push({
        key: 'authorize',
        label: (
          <BuildMenuLabel
            icon="icon-a-Branch-onefenzhi"
            text={intl.formatMessage({ id: 'common.manageAuthorization' })}
          />
        ),
        onClick: () => {
          onAuth?.('mgrAuth');
        },
      });
    }

    // 使用授权
    if (canUseAuth && !isOffShelf) {
      items.push({
        key: 'use',
        label: (
          <BuildMenuLabel
            icon="icon-a-Peoples-tworenqun"
            text={intl.formatMessage({ id: 'common.useAuthorization' })}
          />
        ),
        onClick: () => {
          onAuth?.('useAuth');
        },
      });
    }

    // 数字员工和员工组统一使用卡片上的加号申请；其他资源保留菜单申请入口。
    if (!isDigitalEmployeeResource && canApplyUse && canApplyUseForStatus) {
      items.push({
        key: 'applyUse',
        label: (
          <ConfirmMenuLabel
            title={intl.formatMessage({ id: 'digitalEmployees.applyConfirm' })}
            onConfirm={() => onApplyUse?.()}
          >
            <BuildMenuLabel icon="icon-a-Editorbianji" text={intl.formatMessage({ id: 'resource.applyUse' })} />
          </ConfirmMenuLabel>
        ),
      });
    }

    // 使用审核统一由审核中心承载，卡片不再返回或消费审核按钮权限。

    // 资源中心选择目标员工安装；从“当前员工”进入时由路由显式指定唯一目标。
    if (
      canInstallResource(resource, resourceType) &&
      (!enableResourceLifecycle || `${resource.resourceStatus}` === '2') &&
      actionConfig?.canInstallToTarget !== false &&
      !isInstalledResource
    ) {
      items.push({
        key: 'install',
        label: (
          <BuildMenuLabel
            icon="icon-a-Addtianjia"
            text={intl.formatMessage({ id: getInstallLabelId(resource, resourceType) })}
            loading={installing}
          />
        ),
        disabled: installing,
        onClick: () => setInstallDialogOpen(true),
      });
    }

    if (enableResourceLifecycle && !isDigitalEmployeeResource) {
      // 入口必须同时满足后端权限和当前状态，杜绝把下架与注销混为同一操作。
      const enterprise = ownerType === 'enterprise';
      const lifecycleItems = [
        {
          key: 'shelfData',
          allowed: enterprise && canOnShelf && ['0', '3'].includes(digitalEmployeeStatus),
          label: 'resource.lifecycle.shelfData',
          icon: 'icon-a-Uploadshangchuan',
          onConfirm: onShelf,
        },
        {
          key: 'unShelfData',
          allowed: enterprise && canOffShelf && digitalEmployeeStatus === '2',
          label: 'resource.lifecycle.unShelfData',
          icon: 'icon-a-Downloadxiazai',
          onConfirm: onUnShelf,
        },
        {
          key: 'deleteData',
          allowed: canDelete && (ownerType === 'personal' || ['0', '3'].includes(digitalEmployeeStatus)),
          label: 'resource.lifecycle.deleteData',
          icon: 'icon-a-Deleteshanchu',
          onConfirm: onDeleteData,
        },
      ];
      lifecycleItems
        .filter((item) => item.allowed)
        .forEach((item) => {
          items.push({
            key: item.key,
            disabled: processingLifecycle || actionConfig?.lifecycleLoading,
            label: (
              <ConfirmMenuLabel
                title={intl.formatMessage({ id: `${item.label}Confirm` })}
                disabled={processingLifecycle || actionConfig?.lifecycleLoading}
                onConfirm={item.onConfirm}
              >
                <BuildMenuLabel icon={item.icon} text={intl.formatMessage({ id: item.label })} />
              </ConfirmMenuLabel>
            ),
          });
        });
    }

    const deleteLabelId = getDeleteLabelId(resource, resourceType);
    const deleteConfirmId =
      deleteLabelId === 'common.deleteResource' ? 'common.deactivateConfirm' : `${deleteLabelId}Confirm`;

    // 数字员工下架沿用操作权限判断；页面通过生命周期开关隐藏个人员工的上下架入口。
    const canUnShelfDigitalEmployee =
      isDigitalEmployeeResource &&
      (canOffShelf === true || (canManageEnterpriseDigitalEmployee && digitalEmployeeStatus === '2'));
    if (
      enableDigitalEmployeeLifecycle &&
      ((!isDigitalEmployeeResource && !enableResourceLifecycle && canDelete) || canUnShelfDigitalEmployee)
    ) {
      items.push({
        key: isDigitalEmployeeResource ? 'unShelfData' : 'delete',
        label: (
          <ConfirmMenuLabel
            title={intl.formatMessage({
              id: isDigitalEmployeeResource ? 'resource.unShelfDataConfirm' : deleteConfirmId,
            })}
            onConfirm={() => (isDigitalEmployeeResource ? onUnShelf() : onDelete())}
          >
            <BuildMenuLabel
              icon={isDigitalEmployeeResource ? 'icon-a-Downloadxiazai' : 'icon-a-Deleteshanchu'}
              text={
                isDigitalEmployeeResource
                  ? intl.formatMessage({ id: 'resource.unShelfData' })
                  : intl.formatMessage({ id: deleteLabelId })
              }
            />
          </ConfirmMenuLabel>
        ),
      });
    }

    // 已下架数字员工始终提供“上架员工”，不再依赖恢复权限字段。
    if (
      enableDigitalEmployeeLifecycle &&
      isDigitalEmployeeResource &&
      (canOnShelf === true || (canManageEnterpriseDigitalEmployee && ['0', '3'].includes(digitalEmployeeStatus)))
    ) {
      items.push({
        key: 'shelfData',
        label: (
          <ConfirmMenuLabel title={intl.formatMessage({ id: 'resource.shelfDataConfirm' })} onConfirm={() => onShelf()}>
            <BuildMenuLabel icon="icon-a-Uploadshangchuan" text={intl.formatMessage({ id: 'resource.shelfData' })} />
          </ConfirmMenuLabel>
        ),
      });
    }

    // 数字员工“注销员工”入口沿用删除权限和回调，与上下架生命周期菜单分开控制。
    if (isDigitalEmployeeResource && enableDigitalEmployeeDelete && canDelete === true) {
      items.push({
        key: 'deleteData',
        label: (
          <ConfirmMenuLabel
            title={intl.formatMessage({ id: 'resource.deleteDataConfirm' })}
            onConfirm={() => onDeleteData()}
          >
            <BuildMenuLabel icon="icon-a-Deleteshanchu" text={intl.formatMessage({ id: 'resource.deleteData' })} />
          </ConfirmMenuLabel>
        ),
      });
    }

    // 其他资源继续使用原有恢复逻辑。
    if (canRestore && !isDigitalEmployeeResource && !enableResourceLifecycle) {
      items.push({
        key: 'restore',
        label: (
          <ConfirmMenuLabel
            disabled={restoring}
            title={intl.formatMessage({
              id: isDigitalEmployeeResource ? 'resource.shelfDataConfirm' : 'common.restoreConfirm',
            })}
            onConfirm={() =>
              isDigitalEmployeeResource ? onShelf() : handleRestore({ resourceId: resource?.resourceId })
            }
          >
            <BuildMenuLabel
              icon="icon-a-Returnfanhui"
              text={
                isDigitalEmployeeResource
                  ? intl.formatMessage({ id: 'resource.shelfData' })
                  : intl.formatMessage({ id: 'common.restoreResource' })
              }
              loading={restoring}
            />
          </ConfirmMenuLabel>
        ),
      });
    }

    // 额外操作：调用方可按当前资源权限控制展示。
    if (actionConfig?.extraMenuItems?.length) {
      items.push(
        ...actionConfig.extraMenuItems.filter((item: ExtraResourceMenuItem) => {
          if (!item) return false;
          return typeof item.visible === 'function' ? item.visible(resource) : true;
        })
      );
    }

    const hiddenMenuItemKeySet = new Set(actionConfig?.hiddenMenuItemKeys || []);
    return hiddenMenuItemKeySet.size ? items.filter((item) => item && !hiddenMenuItemKeySet.has(`${item.key}`)) : items;
  }, [
    actionConfig,
    activeDigitalEmployeeId,
    dispatch,
    EventEmitter,
    handleSetDefaultDebounced,
    handlePublishToEnterprise,
    publishingToEnterprise,
    processingLifecycle,
    enterpriseCopyCreated,
    isPersonalResource,
    isWorkspaceSkillResource,
    currentResourceStatus,
    intl,
    isDefaultDigitalEmployee,
    isDigitalEmployeeResource,
    isDeletedDigitalEmployee,
    isPublishedDigitalEmployee,
    onApplyUse,
    onAuth,
    onDelete,
    onDeleteData,
    onShelf,
    onUnShelf,
    enableDigitalEmployeeLifecycle,
    enableResourceLifecycle,
    isCancelledResource,
    rawStatusKey,
    normalizedStatus,
    enableDigitalEmployeeDelete,
    showDigitalEmployeeTypeTag,
    onEdit,
    onRestore,
    onSetDefault,
    resource?.resourceStatus,
    resource?.metaStatus,
    resource?.canEdit,
    resource?.canManageAuth,
    resource?.canUseAuth,
    resource?.canApplyUse,
    canApplyUseForStatus,
    resource?.canSetDefault,
    resource?.canDelete,
    resource?.canOnShelf,
    resource?.canOffShelf,
    resource?.canPublishToEnterprise,
    resource?.canUnShelf,
    resource?.canDeleteData,
    resource?.canRestore,
    resource?.hasUsePermission,
    resource?.ownerType,
    resource?.resourceBizType,
    resource?.id,
    resource?.resourceId,
    resource?.skillType,
    resourceType,
    isInnerSkill,
    isInstalledResource,
    installing,
    restoring,
    settingDefault,
  ]);

  // 工作空间技能用独立菜单(详情/分享/删除)，不走权限驱动的 menuItems。
  const workspaceMenuItems = useMemo<MenuProps['items']>(() => {
    if (!isWorkspaceSkillResource) {
      return [];
    }
    const items: NonNullable<MenuProps['items']> = [
      {
        key: 'detail',
        label: <BuildMenuLabel icon="icon-a-Listliebiao" text={intl.formatMessage({ id: 'common.detail' })} />,
        onClick: () => workspaceActions.openDetail(resource as WorkspaceSkillItem),
      },
      {
        key: 'share',
        label: <BuildMenuLabel icon="icon-a-Branch-onefenzhi" text={intl.formatMessage({ id: 'common.share' })} />,
        onClick: () => workspaceActions.shareSkill(resource as WorkspaceSkillItem),
      },
    ];
    // 工作空间技能同样遵循浏览页隐藏规则，管理入口仍需员工管理权限（后端同样校验）。
    if (actionConfig?.canManageWorkspaceSkill && !actionConfig?.hiddenMenuItemKeys?.includes('delete')) {
      items.push({
        key: 'delete',
        label: <BuildMenuLabel icon="icon-a-Deleteshanchu" text={intl.formatMessage({ id: 'resource.deleteSkill' })} />,
        onClick: () => workspaceActions.removeSkill(resource as WorkspaceSkillItem),
      });
    }
    return items;
  }, [
    isWorkspaceSkillResource,
    intl,
    workspaceActions,
    resource,
    actionConfig?.canManageWorkspaceSkill,
    actionConfig?.hiddenMenuItemKeys,
  ]);

  const effectiveMenuItems = isWorkspaceSkillResource ? workspaceMenuItems : menuItems;
  const effectiveTopRightTag =
    isWorkspaceSkillResource && !showResourceTypeTag
      ? intl.formatMessage({ id: 'resource.skillSource.userDeveloped' })
      : topRightTag;
  const effectiveCardClick: ((resource?: IResourceCardItem) => void) | undefined = isWorkspaceSkillResource
    ? () => workspaceActions.openDetail(resource as WorkspaceSkillItem)
    : onCardClick;
  const workspaceShareModal =
    isWorkspaceSkillResource && workspaceShareRecord ? (
      <WorkspaceSkillShareAuthModal
        record={workspaceShareRecord}
        onClose={() => setWorkspaceShareRecord(null)}
        onSuccess={notifySkillListReload}
      />
    ) : null;
  const installDialog =
    resource.resourceId && installDialogOpen ? (
      <ResourceInstallDialog
        open={installDialogOpen}
        resourceId={resource.resourceId}
        resourceType={resourceType || resource.resourceBizType}
        targetContext={installTargetContext}
        onClose={() => setInstallDialogOpen(false)}
        onInstallingChange={setInstalling}
        onSuccess={() => {
          if (isSkillResource(resource, resourceType)) {
            EventEmitter?.emit('beyond-resourceList-resourceType-reload', {
              resourceType: 'SKILL',
              resetSkillFilters: false,
              skipResourceCenterRefresh: true,
            });
          }
        }}
      />
    ) : null;

  const getDefaultIcon = () => {
    switch (resourceType) {
      case 'KG_DOC':
        return 'icon-chuangjianfangshi-wendangku';
      default:
        return 'icon-chajiantubiao';
    }
  };

  if (variant === 'skillPoster' && isSkillResource(resource, resourceType)) {
    return (
      <div
        className={classnames(styles.skillPosterContent, {
          pointer: !!effectiveCardClick && !isCancelledResource && !isCardClickDisabled,
          [styles.cancelledContent]: isCancelledResource,
          [styles.disabledClickContent]: isCardClickDisabled,
        })}
        onClick={() => {
          if (installDialogOpen) return;
          if (isCancelledResource) return;
          if (isCardClickDisabled) {
            onCardClickDisabled?.(resource);
            return;
          }
          effectiveCardClick?.(resource);
        }}
      >
        <div className={styles.skillPosterImageWrap}>
          {displayImageUrl && !displayImageLoadFailed ? (
            <img
              className={styles.skillPosterImage}
              src={displayImageUrl}
              alt={`${displayTitle}`}
              onError={() => setDisplayImageLoadFailed(true)}
            />
          ) : (
            <div className={styles.skillPosterPlaceholder}>
              <div className={styles.skillPosterOrb} />
              <div className={styles.skillPosterPlaceholderSub}>{intl.formatMessage({ id: 'common.skill' })}</div>
            </div>
          )}
        </div>
        {installing && <InstallingOverlay />}
        <div className={styles.skillPosterBody}>
          <div className={styles.skillPosterHeader}>
            <Paragraph className={styles.skillPosterTitle} ellipsis={{ tooltip: `${displayTitle}` }}>
              {displayTitle}
            </Paragraph>
            {effectiveTopRightTag ? (
              <span
                className={classnames(styles.skillPosterTag, {
                  [styles.digitalEmployeePersonalTag]: showResourceTypeTag && isPersonalResource,
                  [styles.digitalEmployeeEnterpriseTag]: showResourceTypeTag && !isPersonalResource,
                  [styles[statusTagClass]]: Boolean(statusTagClass),
                  [styles.cancelledTag]: isCancelledResource,
                })}
              >
                <span className={styles.tagText}>{effectiveTopRightTag}</span>
              </span>
            ) : null}
            {headerExtra}
          </div>
          <Paragraph
            className={styles.skillPosterDesc}
            ellipsis={{
              tooltip: typeof displayDescription === 'string' ? displayDescription : undefined,
            }}
          >
            {displayDescription}
          </Paragraph>
          <div className={styles.skillPosterFooter}>
            <span className={styles.skillPosterSource} title={skillSourceName}>
              <span className={styles.skillPosterSourceIcon}>
                <AntdIcon type="icon-chajiantubiao" />
              </span>
              <span className={styles.skillPosterCreatorName}>{skillSourceName}</span>
            </span>
            <span className={styles.skillPosterDivider} />
            <span className={styles.skillPosterUseCount}>
              {intl.formatMessage(
                { id: 'resource.skillAddedCount' },
                {
                  count: formattedSkillAddedCount,
                }
              )}
            </span>
          </div>
        </div>
        {!!effectiveMenuItems?.length && (
          <div
            className={styles.skillPosterAction}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
            }}
          >
            <Dropdown menu={{ items: effectiveMenuItems }} placement="bottomRight">
              <Button
                className={styles.skillPosterActionBtn}
                icon={<AntdIcon type="icon-a-Moregengduo" className={styles.cardActionBtnIcon} />}
              />
            </Dropdown>
            {workspaceShareModal}
          </div>
        )}
        {installDialog}
      </div>
    );
  }

  return (
    <div
      className={classnames(styles.renderContent, 'full-width full-height', {
        pointer: !!effectiveCardClick && !isCancelledResource && !isCardClickDisabled,
        [styles.cancelledContent]: isCancelledResource,
        [styles.disabledClickContent]: isCardClickDisabled,
      })}
      onClick={() => {
        if (installDialogOpen) return;
        if (isCancelledResource) return;
        if (isCardClickDisabled) {
          onCardClickDisabled?.(resource);
          return;
        }
        effectiveCardClick?.(resource);
      }}
    >
      {installing && <InstallingOverlay />}
      {isDefaultDigitalEmployee && (
        <span className={styles.defaultDigitalEmployeeBadge}>
          {intl.formatMessage({ id: 'resource.defaultDigitalEmployee' })}
        </span>
      )}
      <div className={classnames('ub ub-ver full-width full-height')}>
        <div className="ub gap12 full-height">
          <div className={styles.avatarContainer}>
            {avatarNode ? (
              avatarNode
            ) : displayImageUrl && !displayImageLoadFailed ? (
              <img
                className={styles.avatar}
                src={displayImageUrl}
                alt={`${displayTitle}`}
                onError={() => setDisplayImageLoadFailed(true)}
              />
            ) : isSkillResource(resource, resourceType) ? (
              <div className={styles.skillDefaultAvatar}>
                <div className={styles.skillDefaultAvatarOrb} />
                <span>{intl.formatMessage({ id: 'common.skill' })}</span>
              </div>
            ) : (
              <div className={styles.defaultAvatar}>
                <AntdIcon type={getDefaultIcon()} className={styles.defaultAvatarIcon} />
              </div>
            )}
          </div>
          <div
            className={classnames(styles.resourceInfo, 'ub ub-ver ub-f1', {
              [styles.resourceInfoWithActions]: digitalEmployeeActionMode,
            })}
          >
            <div
              className={classnames('ub gap4 ub-ac', styles.resourceInfoHeader, {
                [styles.resourceInfoHeaderWithTag]: isDigitalEmployeeResource && effectiveTopRightTag,
              })}
            >
              <Paragraph
                className={classnames(styles.resourceName, 'ub-f1')}
                ellipsis={{ rows: 1, tooltip: `${displayTitle}` }}
              >
                {displayTitle}
              </Paragraph>
              {effectiveTopRightTag ? (
                <span
                  className={classnames(styles.tag, {
                    // 同一归属的员工和员工组共用配色，具体类型由标签文案区分。
                    [styles.digitalEmployeePersonalTag]:
                      (isDigitalEmployeeResource && showDigitalEmployeeTypeTag && isPersonalDigitalEmployee) ||
                      (showResourceTypeTag && isPersonalResource),
                    [styles.digitalEmployeeEnterpriseTag]:
                      (isDigitalEmployeeResource && showDigitalEmployeeTypeTag && !isPersonalDigitalEmployee) ||
                      (showResourceTypeTag && !isPersonalResource),
                    [styles.digitalEmployeeTag]:
                      isDigitalEmployeeResource &&
                      !isPersonalDigitalEmployee &&
                      !isDigitalEmployeeGroup &&
                      !showDigitalEmployeeTypeTag,
                    [styles.digitalEmployeeStatusTag]:
                      (isDigitalEmployeeResource && !showDigitalEmployeeTypeTag) || showResourceStatusTag,
                    [styles.digitalEmployeeTopRightTag]: isDigitalEmployeeResource,
                    [styles[statusTagClass]]: Boolean(statusTagClass),
                    [styles.cancelledTag]: isCancelledResource,
                  })}
                >
                  <span className={styles.tagText}>{effectiveTopRightTag}</span>
                </span>
              ) : null}
              {headerExtra}
              {!!effectiveMenuItems?.length && !digitalEmployeeActionMode && (
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                  }}
                >
                  <Dropdown menu={{ items: effectiveMenuItems }} placement="bottomRight">
                    <Button
                      className={styles.cardActionBtn}
                      icon={<AntdIcon type="icon-a-Moregengduo" className={styles.cardActionBtnIcon} />}
                    />
                  </Dropdown>
                  {workspaceShareModal}
                </div>
              )}
            </div>

            {digitalEmployeeActionMode && (
              <div className={styles.digitalEmployeeActions} onClick={(event) => event.stopPropagation()}>
                {isPendingUseApproval ? (
                  <div className={styles.applyActionWrap}>
                    <Button disabled shape="circle" icon={<PlusOutlined className={styles.cardActionBtnIcon} />} />
                    <span className={styles.pendingApplyText}>
                      {intl.formatMessage({ id: 'resource.pendingAuthorization' })}
                    </span>
                  </div>
                ) : canApplyForUse ? (
                  <>
                    <Tooltip title={intl.formatMessage({ id: 'resource.applyUse' })}>
                      <Popconfirm
                        title={intl.formatMessage({ id: 'digitalEmployees.applyConfirm' })}
                        okText={intl.formatMessage({ id: 'common.confirm' })}
                        cancelText={intl.formatMessage({ id: 'common.cancel' })}
                        onConfirm={(event) => {
                          event?.stopPropagation();
                          onApplyUse?.();
                        }}
                        onCancel={(event) => event?.stopPropagation()}
                      >
                        <Button
                          shape="circle"
                          icon={<PlusOutlined className={styles.cardActionBtnIcon} />}
                          onClick={(event) => {
                            event.stopPropagation();
                            event.preventDefault();
                          }}
                        />
                      </Popconfirm>
                    </Tooltip>
                    {!!effectiveMenuItems?.length ? (
                      <Dropdown
                        menu={{ items: effectiveMenuItems }}
                        placement="bottomRight"
                        trigger={['click']}
                        open={digitalEmployeeMenuOpen}
                        onOpenChange={setDigitalEmployeeMenuOpen}
                      >
                        <Button type="text" icon={<EllipsisOutlined className={styles.cardActionBtnIcon} />} />
                      </Dropdown>
                    ) : null}
                  </>
                ) : (
                  <>
                    {!isDeletedDigitalEmployee && isPublishedDigitalEmployee && (
                      <Tooltip title={intl.formatMessage({ id: 'resource.enterConversation' })}>
                        <Button
                          shape="circle"
                          icon={<MessageOutlined className={styles.cardActionBtnIcon} />}
                          onClick={(event) => {
                            event.stopPropagation();
                            onChat?.();
                          }}
                        />
                      </Tooltip>
                    )}
                    {!!effectiveMenuItems?.length ? (
                      <Dropdown
                        menu={{ items: effectiveMenuItems }}
                        placement="bottomRight"
                        trigger={['click']}
                        open={digitalEmployeeMenuOpen}
                        onOpenChange={setDigitalEmployeeMenuOpen}
                      >
                        <Button type="text" icon={<EllipsisOutlined className={styles.cardActionBtnIcon} />} />
                      </Dropdown>
                    ) : null}
                  </>
                )}
              </div>
            )}

            <Paragraph
              className={styles.resourceDescription}
              ellipsis={{
                rows: 2,
                tooltip:
                  typeof displayDescription === 'string'
                    ? displayDescription.length > 100
                      ? `${displayDescription.slice(0, 100)}...`
                      : displayDescription
                    : undefined,
              }}
            >
              {displayDescription}
            </Paragraph>

            <div className={classnames(styles.meta, 'ub ub-ac')}>
              <div
                className={classnames(styles.metaPrimary, 'ub ub-ac', {
                  [styles.metaPrimaryWithHover]: !!hoverExtra,
                })}
              >
                {/* 卡片底部这行默认是创建者。metaNode 让调用方换成对该卡更有意义的信息
                    (如角色卡的配置来源);不传则保持创建者,现有调用方行为不变。 */}
                {metaNode ?? <ResourceInfo resource={resource} />}
              </div>
              {hoverExtra ? (
                <div
                  className={styles.metaHover}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                  }}
                >
                  {hoverExtra}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      {installDialog}
    </div>
  );
};

function ResourceCard(props: ResourceCardProps) {
  const { resource, variant = 'default' } = props;
  const resourceCardRef = useRef<HTMLDivElement>(null);
  const displayResource = resource;
  const isDigitalEmployeeResource =
    displayResource?.resourceBizType === resourceBizTypeMap.DIG_EMPLOYEE ||
    props.resourceType === resourceBizTypeMap.DIG_EMPLOYEE;
  const isResourceLifecycleCard =
    props.actionConfig?.enableResourceLifecycle === true && !isWorkspaceSkill(displayResource);
  const displayStatus = `${displayResource?.resourceStatus ?? displayResource?.metaStatus ?? ''}`;
  // 资源中心和数字员工统一将 -1 视为注销终态；旧复用卡片继续按历史 3 状态处理。
  const isCancelledResource =
    isResourceLifecycleCard || isDigitalEmployeeResource ? displayStatus === '-1' : displayStatus === '3';
  const isCardClickDisabled =
    typeof props.cardClickDisabled === 'function'
      ? props.cardClickDisabled(displayResource)
      : !!props.cardClickDisabled;

  return (
    <div
      key={resource.resourceId}
      className={classnames(styles.resourceCard, props.className, {
        pointer:
          (!!props.onCardClick || isWorkspaceSkill(displayResource)) && !isCancelledResource && !isCardClickDisabled,
        [styles.skillPosterCard]: variant === 'skillPoster',
        [styles.disabledClickCard]: isCardClickDisabled,
      })}
      ref={resourceCardRef}
    >
      <RenderContent {...props} resource={displayResource} />
    </div>
  );
}

export default ResourceCard;
