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
}

export const isReadableCreator = (creator?: string) => Boolean(creator && !/^\d+$/.test(creator.trim()));

const SkillGroupCard: React.FC<SkillGroupCardProps> = ({ group, onClick, canDelete = false, onDelete, onEdit }) => {
  const intl = useIntl();
  const isInteractive = Boolean(onClick);
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
  if (canDelete && onEdit) {
    deleteMenuItems.push({
      key: 'edit',
      label: intl.formatMessage({ id: 'resource.skillGroup.edit' }),
      onClick: ({ domEvent }) => {
        domEvent.stopPropagation();
        onEdit(group);
      },
    });
  }
  if (canDelete && deleteHandler) {
    deleteMenuItems.push({
      key: 'delete',
      danger: true,
      label: intl.formatMessage({ id: 'resource.skillGroup.delete' }),
      onClick: ({ domEvent }) => {
        domEvent.stopPropagation();
        deleteHandler(group);
      },
    });
  }

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
          {isReadableCreator(creator) ? <span className={styles.creator}>{creator}</span> : null}
          <span>{intl.formatMessage({ id: 'resource.skillGroup.memberCount' }, { count: memberCount })}</span>
        </div>
      </div>
    </div>
  );
};

export default SkillGroupCard;
