import React, { useRef, useState, useEffect, useMemo, useContext, useCallback } from 'react';
import { EllipsisOutlined, MessageOutlined, PlusOutlined } from '@ant-design/icons';
import { Typography, Dropdown, Button, Popconfirm, Tooltip, message, Spin } from 'antd';
import type { MenuProps } from 'antd';
import { getLocale, useDispatch, useIntl, useSelector } from '@umijs/max';
import classnames from 'classnames';
import { debounce, noop } from 'lodash';
import AntdIcon from '@/components/AntdIcon';
import { queryResourceOperationPermissions, restoreResource } from '@/pages/manager/service/resources';
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
  canAuditUse?: boolean;
  canDelete?: boolean;
  canSetDefault?: boolean;
  canRestore?: boolean;
  approveStatus?: string;
  useApplyPending?: boolean;
  resourceStatus?: number | string;
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
}

type ResourceCardActionConfig = {
  scene?: ResourceCardActionScene;
  installedResourceIds?: ReadonlySet<string>;
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
  onDelete?: () => void;
  onRestore?: () => void;
  onAuth?: (authType: 'useAuth' | 'mgrAuth') => void;
  onEdit?: () => void;
  onApply?: () => void;
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
  if (bizType === 'VIEW' || resourceType === 'VIEW') return 'resource.installView';
  if (bizType === 'OBJECT' || resourceType === 'OBJECT') return 'resource.installObject';
  if (bizType === 'SKILL' || resourceType === 'SKILL') return 'resource.installSkill';
  return 'resource.installTool';
};

const canInstallResource = (resource: IResourceCardItem, resourceType?: string) => {
  const bizType = resource?.resourceBizType || resourceType;
  if (bizType === 'SKILL' || resourceType === 'SKILL') {
    return Boolean(resource?.resourceId && resource?.hasUsePermission);
  }
  // 本体库走"按粒度安装"选择器（库/场景/对象/视图），不提供内建的整库快装入口。
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
  const {
    onEdit = noop,
    onAuth = noop,
    onApplyUse = noop,
    onAuditUse = noop,
    onRestore = noop,
    onDelete = noop,
    onSetDefault = noop,
    onChat = noop,
  } = actionConfig || {};

  const intl = useIntl();
  const dispatch = useDispatch();
  const { agentId, agentInfo, EventEmitter } = useGlobal();
  const [digitalEmployeeMenuOpen, setDigitalEmployeeMenuOpen] = useState(false);
  const [installDialogOpen, setInstallDialogOpen] = useState(false);
  const [installing, setInstalling] = useState(false);
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
  const isWorkspaceSkillResource = isWorkspaceSkill(resource);
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
  const resourceIdentity = `${resource.resourceId ?? resource.id ?? ''}`;
  const defaultEmployeeIdentity = `${defaultDigEmployeeId || userInfo?.defaultDigEmployeeId || ''}`;
  const isDefaultDigitalEmployee =
    isDigitalEmployeeResource &&
    (isTruthyFlag(resource.isDefault) ||
      (Boolean(defaultEmployeeIdentity) && resourceIdentity === defaultEmployeeIdentity));
  const normalizedOwnerType = `${ownerType || ''}`.toLowerCase();
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
  const isCancelledResource = `${resource?.resourceStatus ?? ''}` === '3';
  const topRightTag = isCancelledResource ? intl.formatMessage({ id: 'resource.statusCancelled' }) : displayTopRightTag;
  const isInnerSkill = isInnerSkillResource(resource, resourceType);
  const isInstalledSkill =
    isSkillResource(resource, resourceType) &&
    Boolean(resource?.resourceId && actionConfig?.installedResourceIds?.has(`${resource.resourceId}`));
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

  const menuItems = useMemo<MenuProps['items']>(() => {
    const { canEdit, canManageAuth, canUseAuth, canApplyUse, canAuditUse, canDelete, canSetDefault, canRestore } =
      resource || {};
    const items: NonNullable<MenuProps['items']> = [];

    // 后端按当前用户权限和默认员工关系返回 canSetDefault。
    if (isDigitalEmployeeResource && canSetDefault === true && !isDefaultDigitalEmployee) {
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

    // 管理授权
    if (canManageAuth) {
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
    if (canUseAuth) {
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

    // 使用申请与其他权限操作并列展示，由后端返回的权限字段决定其他操作是否出现。
    if (canApplyUse) {
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

    // 使用审核
    if (canAuditUse) {
      items.push({
        key: 'auditUse',
        label: <BuildMenuLabel icon="icon-a-Listliebiao" text={intl.formatMessage({ id: 'resource.auditUse' })} />,
        onClick: () => {
          onAuditUse?.();
        },
      });
    }

    // 资源中心选择目标员工安装；从“当前员工”进入时由路由显式指定唯一目标。
    if (canInstallResource(resource, resourceType) && !isInstalledSkill) {
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

    // 注销数据
    if (canDelete && !isInnerSkill) {
      items.push({
        key: 'delete',
        label: (
          <ConfirmMenuLabel title={intl.formatMessage({ id: 'common.deactivateConfirm' })} onConfirm={() => onDelete()}>
            <BuildMenuLabel icon="icon-a-Deleteshanchu" text={intl.formatMessage({ id: 'common.deleteResource' })} />
          </ConfirmMenuLabel>
        ),
      });
    }

    // 恢复数据
    if (canRestore) {
      items.push({
        key: 'restore',
        label: (
          <ConfirmMenuLabel
            disabled={restoring}
            title={intl.formatMessage({ id: 'common.restoreConfirm' })}
            onConfirm={() => handleRestore({ resourceId: resource?.resourceId })}
          >
            <BuildMenuLabel
              icon="icon-a-Returnfanhui"
              text={intl.formatMessage({ id: 'common.restoreResource' })}
              loading={restoring}
            />
          </ConfirmMenuLabel>
        ),
      });
    }

    // 额外操作（如本体的「绑定本体」）：调用方可按当前资源权限控制展示。
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
    intl,
    isDefaultDigitalEmployee,
    isDigitalEmployeeResource,
    onApplyUse,
    onAuditUse,
    onAuth,
    onDelete,
    onEdit,
    onRestore,
    onSetDefault,
    resource?.canEdit,
    resource?.canManageAuth,
    resource?.canUseAuth,
    resource?.canApplyUse,
    resource?.canSetDefault,
    resource?.canAuditUse,
    resource?.canDelete,
    resource?.canRestore,
    resource?.hasUsePermission,
    resource?.ownerType,
    resource?.resourceBizType,
    resource?.id,
    resource?.resourceId,
    resource?.skillType,
    resourceType,
    isInnerSkill,
    isInstalledSkill,
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
    // 仅当对该数字员工有管理权限时，才允许删除工作空间技能（后端同样校验）。
    if (actionConfig?.canManageWorkspaceSkill) {
      items.push({
        key: 'delete',
        label: (
          <BuildMenuLabel icon="icon-a-Deleteshanchu" text={intl.formatMessage({ id: 'common.deleteResource' })} />
        ),
        onClick: () => workspaceActions.removeSkill(resource as WorkspaceSkillItem),
      });
    }
    return items;
  }, [isWorkspaceSkillResource, intl, workspaceActions, resource, actionConfig?.canManageWorkspaceSkill]);

  const effectiveMenuItems = isWorkspaceSkillResource ? workspaceMenuItems : menuItems;
  const effectiveTopRightTag = isWorkspaceSkillResource
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
      case 'OBJECT':
      case 'VIEW':
        return 'icon-chuangjianfangshi-shujuku';
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
              <span className={classnames(styles.skillPosterTag, { [styles.cancelledTag]: isCancelledResource })}>
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
                    [styles.digitalEmployeePersonalTag]: isPersonalDigitalEmployee,
                    [styles.digitalEmployeeTag]: isDigitalEmployeeResource && !isPersonalDigitalEmployee,
                    [styles.digitalEmployeeTopRightTag]: isDigitalEmployeeResource,
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
                {resource.approveStatus === 'S' || isTruthyFlag(resource.useApplyPending) ? (
                  <div className={styles.applyActionWrap}>
                    <Button disabled shape="circle" icon={<PlusOutlined className={styles.cardActionBtnIcon} />} />
                    <span className={styles.pendingApplyText}>待授权通过</span>
                  </div>
                ) : !isTruthyFlag(resource.hasUsePermission) && isTruthyFlag(resource.canApplyUse) ? (
                  <Tooltip title="使用申请">
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
                ) : (
                  <>
                    <Tooltip title="进入会话">
                      <Button
                        shape="circle"
                        icon={<MessageOutlined className={styles.cardActionBtnIcon} />}
                        onClick={(event) => {
                          event.stopPropagation();
                          onChat?.();
                        }}
                      />
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
  const fetchedPermissionKeyRef = useRef<string | undefined>(undefined);
  const [operationPermissions, setOperationPermissions] = useState<Partial<IResourceCardItem> | null>(null);
  const defaultDigEmployeeId = useSelector(
    ({ employees, user }: any) => employees?.defaultDigEmployeeId || user?.userInfo?.defaultDigEmployeeId
  );
  const operationResourceId = resource.resourceId ?? resource.id ?? resource.agentId;
  const permissionQueryKey = `${operationResourceId ?? ''}:${defaultDigEmployeeId ?? ''}:${
    resource.approveStatus ?? ''
  }`;

  useEffect(() => {
    // 工作空间(用户开发)技能没有真实 resourceId，跳过资源权限查询，避免无效请求。
    if (!operationResourceId || isWorkspaceSkill(resource) || fetchedPermissionKeyRef.current === permissionQueryKey) {
      return noop;
    }

    let observer: IntersectionObserver | undefined;
    let cancelled = false;

    const loadOperationPermissions = async () => {
      if (cancelled || fetchedPermissionKeyRef.current === permissionQueryKey) return;
      fetchedPermissionKeyRef.current = permissionQueryKey;
      try {
        const res: any = await queryResourceOperationPermissions({ resourceId: operationResourceId });
        const permissions = res?.data || res;
        if (!cancelled && permissions) {
          const {
            canEdit,
            canManageAuth,
            canUseAuth,
            canDelete,
            canApplyUse,
            canAuditUse,
            canSetDefault,
            canRestore,
            hasManagePermission,
            hasUsePermission,
            canViewDetail,
            useApplyPending,
          } = permissions;
          setOperationPermissions({
            hasManagePermission,
            hasUsePermission,
            canViewDetail,
            canEdit,
            canManageAuth,
            canUseAuth,
            canDelete,
            canApplyUse,
            canAuditUse,
            canSetDefault,
            canRestore,
            useApplyPending,
            ...(useApplyPending ? { approveStatus: 'S' } : {}),
          });
        }
      } catch {
        if (fetchedPermissionKeyRef.current === permissionQueryKey) {
          fetchedPermissionKeyRef.current = undefined;
        }
      }
    };

    // 数字员工操作区需要立即展示完整菜单，不再等待 IntersectionObserver 触发。
    if (props.digitalEmployeeActionMode) {
      void loadOperationPermissions();
      return () => {
        cancelled = true;
      };
    }

    if (!resourceCardRef.current) return noop;
    const callback = debounce((entries: IntersectionObserverEntry[]) => {
      for (const entry of entries) {
        if (entry.intersectionRatio > 0) {
          void loadOperationPermissions();
          observer?.disconnect();
          break;
        }
      }
    }, 100);

    observer = new IntersectionObserver(callback);
    observer.observe(resourceCardRef.current);
    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, [operationResourceId, permissionQueryKey, props.digitalEmployeeActionMode, resource]);

  const displayResource = operationPermissions ? { ...resource, ...operationPermissions } : resource;
  const isCancelledResource = `${displayResource?.resourceStatus ?? ''}` === '3';
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
