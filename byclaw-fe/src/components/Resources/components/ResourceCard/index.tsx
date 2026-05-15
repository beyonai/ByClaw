import React, { useRef, useState, useEffect, useMemo } from 'react';
import { Typography, Dropdown, Button, Popconfirm, Tooltip, message } from 'antd';
import type { MenuProps } from 'antd';
import { useIntl } from '@umijs/max';
import classnames from 'classnames';
import { debounce, noop } from 'lodash';
import AntdIcon from '@/components/AntdIcon';
import { queryResourceOperationPermissions, restoreResource } from '@/pages/manager/service/resources';
import { useRequest } from '@/hooks/useRequest';
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
  canEdit?: boolean;
  canManageAuth?: boolean;
  canUseAuth?: boolean;
  canApplyUse?: boolean;
  canAuditUse?: boolean;
  canDelete?: boolean;
  canSetDefault?: boolean;
  canRestore?: boolean;
  ownerType?: string;
  openSuperHelper?: string;
  tagName?: string;
}

type ResourceCardActionConfig = {
  scene?: ResourceCardActionScene;
  enableKnowledgeManage?: boolean;
  editDisabledTip?: React.ReactNode;
  manageAuthDisabledTip?: React.ReactNode;
  useAuthDisabledTip?: React.ReactNode;
  applyUseDisabledTip?: React.ReactNode;
  auditUseDisabledTip?: React.ReactNode;
  deleteDisabledTip?: React.ReactNode;
  restoreDisabledTip?: React.ReactNode;
  applyDisabledTip?: React.ReactNode;
  deleteConfirmTitle?: React.ReactNode;
  deleteConfirmDescription?: React.ReactNode;
  restoreConfirmTitle?: React.ReactNode;
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

const RenderContent = (props: ResourceCardProps) => {
  const { resource, onCardClick, actionConfig, avatarNode, description, headerExtra, hoverExtra, resourceType } = props;
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
  const [settingDefault] = useState(false);
  const defaultDisabledTip = intl.formatMessage({ id: 'common.noPermissionOperation' });

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
      message.error(intl.formatMessage({ id: 'common.operationFailed' }));
    },
  });

  const displayTitle = resource.resourceName || resource.name || intl.formatMessage({ id: 'common.none' });
  const displayDescription =
    description ?? resource.resourceDesc ?? resource.intro ?? intl.formatMessage({ id: 'common.none' });
  const getDisplayTopRightTag = () => {
    // 优先展示真实标签。
    if (resource.tagName) {
      return resource.tagName;
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

  const menuItems = useMemo<MenuProps['items']>(() => {
    const { canEdit, canManageAuth, canUseAuth, canApplyUse, canAuditUse, canDelete, canRestore } = resource || {};
    const items: NonNullable<MenuProps['items']> = [];
    const buildMenuLabel = ({
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

      return <Tooltip title={disabledTip || defaultDisabledTip}>{content}</Tooltip>;
    };

    // 设为默认
    // if (canSetDefault) {
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
    //         {buildMenuLabel({
    //           icon: 'icon-a-Useryonghu',
    //           text: intl.formatMessage({ id: 'resource.setDefaultAssistant' }),
    //           loading: settingDefault,
    //         })}
    //       </Popconfirm>
    //     ),
    //   });
    // }

    // 编辑信息
    if (canEdit) {
      items.push({
        key: 'edit',
        label: buildMenuLabel({
          icon: 'icon-a-Editorbianji',
          text: intl.formatMessage({ id: 'common.editInfo' }),
        }),
        onClick: () => {
          onEdit?.();
        },
      });
    }

    // 管理授权
    if (canManageAuth) {
      items.push({
        key: 'authorize',
        label: buildMenuLabel({
          icon: 'icon-a-Branch-onefenzhi',
          text: intl.formatMessage({ id: 'common.manageAuthorization' }),
        }),
        onClick: () => {
          onAuth?.('mgrAuth');
        },
      });
    }

    // 使用授权
    if (canUseAuth) {
      items.push({
        key: 'use',
        label: buildMenuLabel({
          icon: 'icon-a-Peoples-tworenqun',
          text: intl.formatMessage({ id: 'common.useAuthorization' }),
        }),
        onClick: () => {
          onAuth?.('useAuth');
        },
      });
    }

    // 使用申请
    if (canApplyUse) {
      const applyUseContent = buildMenuLabel({
        icon: 'icon-a-Editorbianji',
        text: intl.formatMessage({ id: 'resource.applyUse' }),
      });
      items.push({
        key: 'applyUse',
        label: (
          <Popconfirm
            title={intl.formatMessage({ id: 'digitalEmployees.applyConfirm' })}
            onConfirm={(e) => {
              e?.stopPropagation();
              onApplyUse?.();
            }}
            okText={intl.formatMessage({ id: 'common.confirm' })}
            cancelText={intl.formatMessage({ id: 'common.cancel' })}
          >
            {applyUseContent}
          </Popconfirm>
        ),
      });
    }

    // 使用审核
    if (canAuditUse) {
      items.push({
        key: 'auditUse',
        label: buildMenuLabel({
          icon: 'icon-a-Listliebiao',
          text: intl.formatMessage({ id: 'resource.auditUse' }),
        }),
        onClick: () => {
          onAuditUse?.();
        },
      });
    }

    // 注销数据
    if (canDelete) {
      const deleteContent = buildMenuLabel({
        icon: 'icon-a-Deleteshanchu',
        text: intl.formatMessage({ id: 'common.deleteResource' }),
      });
      items.push({
        key: 'delete',
        label: (
          <Popconfirm
            title={intl.formatMessage({ id: 'common.deactivateConfirm' })}
            onConfirm={(e) => {
              e?.stopPropagation();
              onDelete();
            }}
            okText={intl.formatMessage({ id: 'common.confirm' })}
            cancelText={intl.formatMessage({ id: 'common.cancel' })}
          >
            {deleteContent}
          </Popconfirm>
        ),
      });
    }

    // 恢复数据
    if (canRestore) {
      const restoreContent = buildMenuLabel({
        icon: 'icon-a-Returnfanhui',
        text: intl.formatMessage({ id: 'common.restoreResource' }),
        loading: restoring,
      });
      items.push({
        key: 'restore',
        label: (
          <Popconfirm
            title={intl.formatMessage({ id: 'common.restoreConfirm' })}
            onConfirm={(e) => {
              e?.stopPropagation();
              handleRestore({ resourceId: resource?.resourceId });
            }}
            okText={intl.formatMessage({ id: 'common.confirm' })}
            cancelText={intl.formatMessage({ id: 'common.cancel' })}
            disabled={restoring}
          >
            {restoreContent}
          </Popconfirm>
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
    intl,
    resource?.canSetDefault,
    resource?.canEdit,
    resource?.canManageAuth,
    resource?.canUseAuth,
    resource?.canApplyUse,
    resource?.canAuditUse,
    resource?.canDelete,
    resource?.canRestore,
    resource?.ownerType,
    resource?.resourceBizType,
    restoring,
    settingDefault,
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

  return (
    <div
      className={classnames(styles.renderContent, 'full-width full-height', {
        pointer: !!onCardClick,
      })}
      onClick={() => onCardClick?.()}
    >
      <div className={classnames('ub ub-ver full-width full-height')}>
        <div className="ub gap12 full-height">
          <div className={styles.avatarContainer}>
            {avatarNode ? (
              avatarNode
            ) : resource.resourceLogoUrl ? (
              <img className={styles.avatar} src={`/byaiService${resource.resourceLogoUrl}`} alt={`${displayTitle}`} />
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
              {displayTopRightTag ? (
                <span className={styles.tag}>
                  <span className={styles.tagText}>{displayTopRightTag}</span>
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
  const { resource } = props;
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
                } = permissions;
                setResourceWithPermissions({
                  ...resource,
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

  return (
    <div
      key={resource.resourceId}
      className={classnames(styles.resourceCard, props.className, {
        pointer: !!props.onCardClick,
      })}
      ref={resourceCardRef}
    >
      <RenderContent {...props} resource={displayResource} />
    </div>
  );
}

export default ResourceCard;
