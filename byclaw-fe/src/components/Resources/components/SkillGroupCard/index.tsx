import React, { useEffect, useState } from 'react';
import { useIntl } from '@umijs/max';
import { Dropdown, type MenuProps } from 'antd';
import { EllipsisOutlined } from '@ant-design/icons';
import type { SkillGroup } from '@/pages/manager/service/resources';
import { getFileUrl } from '@/utils/file';
import { getSkillGroupDefaultCover } from '../skillGroupCover';
import styles from './index.module.less';

export interface SkillGroupCardProps {
  group: SkillGroup;
  onClick?: (group: SkillGroup) => void;
  canDelete?: boolean;
  onDelete?: (group: SkillGroup) => void;
  onEdit?: (group: SkillGroup) => void;
  onShelf?: (group: SkillGroup) => void;
  onUnShelf?: (group: SkillGroup) => void;
}

export const isReadableCreator = (creator?: string) => Boolean(creator && !/^\d+$/.test(creator.trim()));

const SkillGroupCard: React.FC<SkillGroupCardProps> = ({
  group,
  onClick,
  canDelete = false,
  onDelete,
  onEdit,
  onShelf,
  onUnShelf,
}) => {
  const intl = useIntl();
  const status = `${group.resourceStatus}`;
  const isDeregistered = status === '-1';
  const isInteractive = Boolean(onClick) && !isDeregistered;
  const [coverError, setCoverError] = useState(false);
  const creator = `${group.createBy || ''}`.trim();
  const memberCount = group.memberCount ?? group.members?.length ?? 0;

  useEffect(() => {
    setCoverError(false);
  }, [group.avatar]);
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick?.(group);
    }
  };
  const deleteMenuItems: MenuProps['items'] = [];
  const deleteHandler = onDelete;
  if (canDelete && !isDeregistered && onEdit) {
    deleteMenuItems.push({
      key: 'edit',
      label: intl.formatMessage({ id: 'resource.skillGroup.edit' }),
      onClick: ({ domEvent }) => {
        domEvent.stopPropagation();
        onEdit(group);
      },
    });
  }
  if (
    canDelete &&
    !isDeregistered &&
    (group.ownerType?.toLowerCase() === 'personal' || ['0', '3'].includes(status)) &&
    deleteHandler
  ) {
    deleteMenuItems.push({
      key: 'delete',
      danger: true,
      label: intl.formatMessage({ id: 'resource.lifecycle.deleteData' }),
      onClick: ({ domEvent }) => {
        domEvent.stopPropagation();
        deleteHandler(group);
      },
    });
  }

  // 技能组上下架只影响组入口，保持成员技能和既有安装快照独立。
  if (canDelete && group.ownerType === 'enterprise' && ['0', '3'].includes(status) && onShelf) {
    deleteMenuItems.push({
      key: 'shelf',
      label: intl.formatMessage({ id: 'resource.lifecycle.shelfData' }),
      onClick: ({ domEvent }) => {
        domEvent.stopPropagation();
        onShelf(group);
      },
    });
  }
  if (canDelete && group.ownerType === 'enterprise' && status === '2' && onUnShelf) {
    deleteMenuItems.push({
      key: 'unShelf',
      label: intl.formatMessage({ id: 'resource.lifecycle.unShelfData' }),
      onClick: ({ domEvent }) => {
        domEvent.stopPropagation();
        onUnShelf(group);
      },
    });
  }
  const statusLabels: Record<string, string> = {
    '0': 'resourceStatus.draft',
    '1': 'resourceStatus.pendingShelf',
    '2': 'resourceStatus.published',
    '3': 'resourceStatus.unpublished',
    '-1': 'resource.statusCancelled',
  };

  return (
    <div
      className={styles.card}
      role={isInteractive ? 'button' : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      aria-label={group.resourceName}
      onClick={isInteractive ? () => onClick?.(group) : undefined}
      onKeyDown={isInteractive ? handleKeyDown : undefined}
    >
      <div className={styles.cover}>
        {deleteMenuItems.length ? (
          <Dropdown menu={{ items: deleteMenuItems }} trigger={['click']} placement="bottomRight">
            <button
              type="button"
              className={styles.actionButton}
              aria-label={intl.formatMessage({ id: 'resource.skillGroup.delete' })}
              onClick={(event) => event.stopPropagation()}
            >
              <EllipsisOutlined />
            </button>
          </Dropdown>
        ) : null}
        {group.avatar && !coverError ? (
          <img
            className={styles.coverImage}
            src={getFileUrl(group.avatar)}
            alt=""
            onError={() => setCoverError(true)}
          />
        ) : (
          <img
            className={styles.defaultCoverImage}
            data-testid="skill-group-default-cover"
            src={getSkillGroupDefaultCover()}
            alt=""
          />
        )}
      </div>
      <div className={styles.content}>
        <div className={styles.title} title={group.resourceName}>
          {group.resourceName}
        </div>
        <div className={styles.description} title={group.resourceDesc || ''}>
          {group.resourceDesc || intl.formatMessage({ id: 'common.none' })}
        </div>
        <div className={styles.meta}>
          {statusLabels[status] && <span>{intl.formatMessage({ id: statusLabels[status] })}</span>}
          {isReadableCreator(creator) ? <span className={styles.creator}>{creator}</span> : null}
          <span>{intl.formatMessage({ id: 'resource.skillGroup.memberCount' }, { count: memberCount })}</span>
        </div>
      </div>
    </div>
  );
};

export default SkillGroupCard;
