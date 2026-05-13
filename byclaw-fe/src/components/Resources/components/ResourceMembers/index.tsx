import React from 'react';
import { useIntl } from '@umijs/max';
import styles from './index.module.less';

interface ResourceMembersProps {
  data: any[];
}

const ResourceMembers: React.FC<ResourceMembersProps> = ({ data }) => {
  const intl = useIntl();
  if (!data || data.length === 0) {
    return null;
  }

  // 过滤不同类型的成员
  const orgMembers = data.filter((item: any) => item.grantToObjType === 'ORG');
  const userMembers = data.filter((item: any) => item.grantToObjType === 'USER');
  const otherMembers = data.filter((item: any) => item.grantToObjType !== 'ORG' && item.grantToObjType !== 'USER');

  return (
    <div>
      {/* 组织成员 */}
      {orgMembers.length > 0 && (
        <div className={styles.memberSection}>
          <strong>{intl.formatMessage({ id: 'resource.organization' })}：</strong>
          {orgMembers.map((member: any) => member.grantToObjName).join('、')}
        </div>
      )}
      {/* 个人成员 */}
      {userMembers.length > 0 && (
        <div className={styles.memberSection}>
          <strong>{intl.formatMessage({ id: 'resource.personal' })}：</strong>
          {userMembers.map((member: any) => member.grantToObjName).join('、')}
        </div>
      )}
      {/* 其他成员 */}
      {otherMembers.length > 0 && (
        <div className={styles.memberSection}>
          <strong>{intl.formatMessage({ id: 'resource.other' })}：</strong>
          {otherMembers.map((member: any) => member.grantToObjName).join('、')}
        </div>
      )}
    </div>
  );
};

export default ResourceMembers;