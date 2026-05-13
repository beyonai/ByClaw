import { useIntl } from '@umijs/max';
import React from 'react';
import styles from './index.module.less';

const MemberPage = () => {
  const intl = useIntl();
  const [mockMembers] = React.useState<
    {
      id: number;
      avatar: string;
      name: string;
      tag: string;
    }[]
  >([]);
  return (
    <div className={styles.memberPage}>
      <div className={styles.memberList}>
        {mockMembers.map((member) => (
          <div className={styles.memberItem} key={member.id}>
            <img className={styles.memberAvatar} src={member.avatar} alt={member.name} />
            <span className={styles.memberName}>{member.name}</span>
            <div className={styles.memberTag}>
              {member.tag === intl.formatMessage({ id: 'common.superHelper' }) ? (
                <div className={styles.tagSuperHelper}>{member.tag}</div>
              ) : (
                <div className={styles.tagDigitalEmployee}>{member.tag}</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default MemberPage;
