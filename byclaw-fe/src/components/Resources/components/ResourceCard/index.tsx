import React, { useRef, useState, useEffect, useMemo } from 'react';
import { Typography, Dropdown, Button, Popconfirm, Tooltip, message, Avatar } from 'antd';
import type { MenuProps } from 'antd';
import { useIntl, useSelector } from '@umijs/max';
import classnames from 'classnames';
import { debounce, noop } from 'lodash';
import AntdIcon from '@/components/AntdIcon';
import { queryResourceOperationPermissions, restoreResource } from '@/pages/manager/service/resources';
import { installDigitalEmployeeRelResources } from '@/pages/manager/service/DigitalEmployeeMgr';
import { getFileUrl } from '@/utils/file';
import { useRequest } from '@/hooks/useRequest';
import useGlobal from '@/hooks/useGlobal';
import type { IState as IEmployeesState } from '@/models/useEmployees';
import styles from './index.module.less';

const { Paragraph } = Typography;
export type ResourceCardActionScene = 'personal' | 'enterprise';

export interface IResourceCardItem {
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
  resourceStatus?: number | string;
  ownerType?: string;
  openSuperHelper?: string;
  tagName?: string;
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
  enableKnowledgeManage?: boolean;
  editDisabledTip?: React.ReactNode;
  manageAuthDisabledTip?: React.ReactNode;
  useAuthDisabledTip?: React.ReactNode;
  applyUseDisabledTip?: React.ReactNode;
  auditUseDisabledTip?: React.ReactNode;
  deleteDisabledTip?: React.ReactNode;
  restoreDisabledTip?: React.ReactNode;
  applyDisabledTip?: React.ReactNode;
  extraMenuItems?: MenuProps['items'];
  onApplyUse?: () => void;
  onAuditUse?: () => void;
  onDelete?: () => void;
  onRestore?: () => void;
  onAuth?: (authType: 'useAuth' | 'mgrAuth') => void;
  onEdit?: () => void;
  onApply?: () => void;
  onSetDefault?: () => void;
};

export type ResourceCardProps = {
  resource: IResourceCardItem;
  resourceType?: string;
  onCardClick?: () => void;
  actionConfig?: ResourceCardActionConfig;
  avatarNode?: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
  headerExtra?: React.ReactNode;
  metaNode?: React.ReactNode;
  hoverExtra?: React.ReactNode;
  className?: string;
  variant?: 'default' | 'skillPoster';
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
  children,
  onConfirm,
}: {
  title: React.ReactNode;
  disabled?: boolean;
  children: React.ReactNode;
  onConfirm: () => void;
}) => {
  const intl = useIntl();
  return (
    <Popconfirm
      title={title}
      okText={intl.formatMessage({ id: 'common.confirm' })}
      cancelText={intl.formatMessage({ id: 'common.cancel' })}
      disabled={disabled}
      onConfirm={(event) => {
        event?.stopPropagation();
        onConfirm();
      }}
      onCancel={(event) => event?.stopPropagation()}
    >
      <div
        className={styles.confirmMenuTrigger}
        onClick={(event) => {
          event.stopPropagation();
          event.preventDefault();
        }}
      >
        {children}
      </div>
    </Popconfirm>
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
  return Boolean(resource?.resourceId && bizType && bizType !== 'DIG_EMPLOYEE');
};

const isSkillResource = (resource: IResourceCardItem, resourceType?: string) => {
  return resource?.resourceBizType === 'SKILL' || resourceType === 'SKILL';
};

const isInnerSkillResource = (resource: IResourceCardItem, resourceType?: string) => {
  return isSkillResource(resource, resourceType) && `${resource?.skillType || ''}`.toLowerCase() === 'inner';
};

const RenderContent = (props: ResourceCardProps) => {
  const {
    resource,
    onCardClick,
    actionConfig,
    avatarNode,
    description,
    headerExtra,
    hoverExtra,
    resourceType,
    variant = 'default',
  } = props;
  const { ownerType } = resource || {};
  const {
    scene,
    onEdit = noop,
    onAuth = noop,
    onApplyUse = noop,
    onAuditUse = noop,
    onRestore = noop,
    onDelete = noop,
  } = actionConfig || {};

  const intl = useIntl();
  const { agentInfo } = useGlobal();
  const { userInfo, defaultDigEmployeeId } = useSelector(
    ({ user, employees }: { user: any; employees: IEmployeesState }) => ({
      userInfo: user.userInfo,
      defaultDigEmployeeId: employees.defaultDigEmployeeId,
    })
  );
  const activeDigitalEmployeeId = agentInfo?.agentId || defaultDigEmployeeId || userInfo?.defaultDigEmployeeId;

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
  const { mutate: handleInstall, isLoading: installing } = useRequest({
    mutationFn: () => {
      return installDigitalEmployeeRelResources({
        digitalEmployeeId: `${activeDigitalEmployeeId}`,
        relIds: [`${resource.resourceId}`],
      });
    },
    onSuccess: () => {
      message.success(intl.formatMessage({ id: 'resource.installSuccess' }));
      window.dispatchEvent(
        new CustomEvent('digitalEmployeeResourceInstalled', { detail: { resourceId: resource?.resourceId } })
      );
    },
  });

  const displayTitle = resource.resourceName || resource.name || intl.formatMessage({ id: 'common.none' });
  const displayDescription =
    description ?? resource.resourceDesc ?? resource.intro ?? intl.formatMessage({ id: 'common.none' });
  const displayImage = resource.resourceLogoUrl || resource.avatar;
  const [skillPosterAspect, setSkillPosterAspect] = useState<string>();
  const creatorName =
    resource?.creatorName ||
    resource?.createUserName ||
    resource?.memberName ||
    intl.formatMessage({ id: 'common.none' });
  const useCount = Number(resource?.useCount || resource?.focusCount || 0);
  useEffect(() => {
    setSkillPosterAspect(undefined);
  }, [displayImage]);
  const getDisplayTopRightTag = () => {
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

  const menuItems = useMemo<MenuProps['items']>(() => {
    const { canEdit, canManageAuth, canUseAuth, canApplyUse, canAuditUse, canDelete, canRestore } = resource || {};
    const items: NonNullable<MenuProps['items']> = [];

    // 设为默认
    // if (!canSetDefault) {
    //   items.push({
    //     key: 'setDefaultAssistant',
    //     label: (
    //       <Popconfirm
    //         title={intl.formatMessage({ id: 'resource.setDefaultAssistantConfirm' })}
    //         onConfirm={async (e) => {
    //           e?.stopPropagation();
    //           setSettingDefault(true);
    //           try {
    //             await onSetDefault?.();
    //           } finally {
    //             setSettingDefault(false);
    //           }
    //         }}
    //         okText={intl.formatMessage({ id: 'common.confirm' })}
    //         cancelText={intl.formatMessage({ id: 'common.cancel' })}
    //       >
    //         <BuildMenuLabel
    //           icon="icon-a-Useryonghu"
    //           text={intl.formatMessage({ id: 'resource.setDefaultAssistant' })}
    //           loading={settingDefault}
    //         />
    //       </Popconfirm>
    //     ),
    //   });
    // }

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

    // 使用申请
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

    // 安装到当前默认数字员工
    if (canInstallResource(resource, resourceType) && !isInstalledSkill) {
      const disabled = !activeDigitalEmployeeId;
      items.push({
        key: 'install',
        label: (
          <ConfirmMenuLabel
            disabled={disabled || installing}
            title={intl.formatMessage({ id: 'resource.installConfirm' })}
            onConfirm={() => handleInstall(undefined)}
          >
            <BuildMenuLabel
              icon="icon-a-Addtianjia"
              text={intl.formatMessage({ id: getInstallLabelId(resource, resourceType) })}
              disabled={disabled}
              disabledTip={intl.formatMessage({ id: 'resource.noDefaultDigitalEmployee' })}
              loading={installing}
            />
          </ConfirmMenuLabel>
        ),
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

    // 额外操作
    if (!scene && actionConfig?.extraMenuItems?.length) {
      items.push(...actionConfig.extraMenuItems);
    }

    return items;
  }, [
    actionConfig,
    activeDigitalEmployeeId,
    handleInstall,
    intl,
    resource?.canSetDefault,
    resource?.canEdit,
    resource?.canManageAuth,
    resource?.canUseAuth,
    resource?.canApplyUse,
    resource?.canAuditUse,
    resource?.canDelete,
    resource?.canRestore,
    resource?.hasUsePermission,
    resource?.ownerType,
    resource?.resourceBizType,
    resource?.resourceId,
    resource?.skillType,
    resourceType,
    isInnerSkill,
    isInstalledSkill,
    installing,
    restoring,
  ]);

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
          pointer: !!onCardClick && !isCancelledResource,
          [styles.cancelledContent]: isCancelledResource,
        })}
        onClick={() => {
          if (isCancelledResource) return;
          onCardClick?.();
        }}
      >
        <div
          className={styles.skillPosterImageWrap}
          style={
            skillPosterAspect ? ({ '--skill-poster-aspect': skillPosterAspect } as React.CSSProperties) : undefined
          }
        >
          {displayImage ? (
            <img
              className={styles.skillPosterImage}
              src={getFileUrl(displayImage)}
              alt={`${displayTitle}`}
              onLoad={(event) => {
                const { naturalWidth, naturalHeight } = event.currentTarget;
                if (!naturalWidth || !naturalHeight) {
                  return;
                }
                setSkillPosterAspect(`${naturalWidth} / ${naturalHeight}`);
              }}
            />
          ) : (
            <div className={styles.skillPosterPlaceholder}>
              <div className={styles.skillPosterOrb} />
              <div className={styles.skillPosterPlaceholderSub}>{intl.formatMessage({ id: 'common.skill' })}</div>
            </div>
          )}
          {topRightTag ? (
            <span className={classnames(styles.skillPosterTag, { [styles.cancelledTag]: isCancelledResource })}>
              <span className={styles.tagText}>{topRightTag}</span>
            </span>
          ) : null}
          {headerExtra}
          {!!menuItems?.length && (
            <div
              className={styles.skillPosterAction}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
              }}
            >
              <Dropdown menu={{ items: menuItems }} placement="bottomRight">
                <Button
                  className={styles.skillPosterActionBtn}
                  icon={<AntdIcon type="icon-a-Moregengduo" className={styles.cardActionBtnIcon} />}
                />
              </Dropdown>
            </div>
          )}
        </div>
        <Paragraph className={styles.skillPosterTitle} ellipsis={{ rows: 2, tooltip: `${displayTitle}` }}>
          {displayTitle}
        </Paragraph>
        <Paragraph
          className={styles.skillPosterDesc}
          ellipsis={{
            rows: 2,
            tooltip: typeof displayDescription === 'string' ? displayDescription : undefined,
          }}
        >
          {displayDescription}
        </Paragraph>
        <div className={styles.skillPosterFooter}>
          <div className={styles.skillPosterCreator}>
            <Avatar size={22} className={styles.skillPosterCreatorAvatar}>
              {creatorName.slice(0, 1)}
            </Avatar>
            <span className={styles.skillPosterCreatorName} title={creatorName}>
              {creatorName}
            </span>
          </div>
          <span className={styles.skillPosterUseCount}>
            {intl.formatMessage({ id: 'resource.skillUseCount' }, { count: useCount })}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={classnames(styles.renderContent, 'full-width full-height', {
        pointer: !!onCardClick && !isCancelledResource,
        [styles.cancelledContent]: isCancelledResource,
      })}
      onClick={() => {
        if (isCancelledResource) return;
        onCardClick?.();
      }}
    >
      <div className={classnames('ub ub-ver full-width full-height')}>
        <div className="ub gap12 full-height">
          <div className={styles.avatarContainer}>
            {avatarNode ? (
              avatarNode
            ) : displayImage ? (
              <img className={styles.avatar} src={getFileUrl(displayImage)} alt={`${displayTitle}`} />
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
          <div className={classnames(styles.resourceInfo, 'ub ub-ver ub-f1')}>
            <div className={classnames('ub gap4 ub-ac', styles.resourceInfoHeader)}>
              <Paragraph
                className={classnames(styles.resourceName, 'ub-f1')}
                ellipsis={{ rows: 1, tooltip: `${displayTitle}` }}
              >
                {displayTitle}
              </Paragraph>
              {topRightTag ? (
                <span className={classnames(styles.tag, { [styles.cancelledTag]: isCancelledResource })}>
                  <span className={styles.tagText}>{topRightTag}</span>
                </span>
              ) : null}
              {headerExtra}
              {!!menuItems?.length && (
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                  }}
                >
                  <Dropdown menu={{ items: menuItems }} placement="bottomRight">
                    <Button
                      className={styles.cardActionBtn}
                      icon={<AntdIcon type="icon-a-Moregengduo" className={styles.cardActionBtnIcon} />}
                    />
                  </Dropdown>
                </div>
              )}
            </div>

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
                <ResourceInfo resource={resource} />
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
    </div>
  );
};

function ResourceCard(props: ResourceCardProps) {
  const { resource, variant = 'default' } = props;
  const resourceCardRef = useRef<HTMLDivElement>(null);
  const fetchedPermissionsRef = useRef(false);
  const [resourceWithPermissions, setResourceWithPermissions] = useState<IResourceCardItem | null>(null);

  useEffect(() => {
    if (!resourceCardRef.current || fetchedPermissionsRef.current) return noop;

    let observer: IntersectionObserver | undefined;
    let cancelled = false;

    const callback = debounce(async (entries: IntersectionObserverEntry[]) => {
      for (const entry of entries) {
        if (entry.intersectionRatio > 0 && !cancelled && !fetchedPermissionsRef.current) {
          fetchedPermissionsRef.current = true;
          const resourceId = resource.resourceId;
          if (resourceId) {
            try {
              const res: any = await queryResourceOperationPermissions({ resourceId });
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
                } = permissions;
                setResourceWithPermissions({
                  ...resource,
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
                });
              }
            } catch {
              fetchedPermissionsRef.current = false;
            }
          }
          observer?.disconnect();
        }
      }
    }, 100);

    observer = new IntersectionObserver(callback);
    observer.observe(resourceCardRef.current);
    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, [resource]);

  const displayResource = resourceWithPermissions || resource;
  const isCancelledResource = `${displayResource?.resourceStatus ?? ''}` === '3';

  return (
    <div
      key={resource.resourceId}
      className={classnames(styles.resourceCard, props.className, {
        pointer: !!props.onCardClick && !isCancelledResource,
        [styles.skillPosterCard]: variant === 'skillPoster',
      })}
      ref={resourceCardRef}
    >
      <RenderContent {...props} resource={displayResource} />
    </div>
  );
}

export default ResourceCard;
