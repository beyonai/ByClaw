import React from 'react';
import { useIntl } from '@umijs/max';
import type { SkillGroup } from '@/pages/manager/service/resources';
import styles from './index.module.less';

export interface SkillGroupCardProps {
  group: SkillGroup;
  onClick?: (group: SkillGroup) => void;
}

export const getFallbackMembers = (group: SkillGroup) => (group.members || []).slice(0, 4);

const getInitials = (name?: string) => {
  const value = `${name || '?'}`.trim();
  return value.slice(0, 2).toUpperCase();
};

const FallbackCover = ({ group }: { group: SkillGroup }) => {
  const intl = useIntl();
  const members = getFallbackMembers(group);

  return (
    <div
      className={styles.fallbackCover}
      data-testid="skill-group-fallback-cover"
      aria-label={intl.formatMessage({ id: 'resource.skillGroup.fallbackCover' })}
    >
      {members.length ? (
        members.map((member, index) => (
          <div className={styles.fallbackTile} key={`${member.resourceId || member.resourceName}-${index}`}>
            {member.avatar ? <img src={member.avatar} alt="" /> : <span>{getInitials(member.resourceName)}</span>}
          </div>
        ))
      ) : (
        <div className={styles.fallbackTile}>
          <span>{getInitials(group.resourceName)}</span>
        </div>
      )}
    </div>
  );
};

const SkillGroupCard: React.FC<SkillGroupCardProps> = ({ group, onClick }) => {
  const intl = useIntl();
  const isInteractive = Boolean(onClick);
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick?.(group);
    }
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
        {group.avatar ? (
          <img className={styles.coverImage} src={group.avatar} alt="" />
        ) : (
          <FallbackCover group={group} />
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
          {group.createBy ? <span className={styles.creator}>{group.createBy}</span> : null}
          <span>{intl.formatMessage({ id: 'resource.skillGroup.memberCount' }, { count: group.memberCount })}</span>
        </div>
      </div>
    </div>
  );
};

export default SkillGroupCard;
