import PublicationAuditList from '@/components/EmployeePublication/AuditList';
import ResourceAuditCenter from '@/components/Resources/components/ResourceAuditCenter';
import useApprovalPendingCounts from '@/hooks/useApprovalPendingCounts';
import useEmployeePublicationCapabilities from '@/hooks/useEmployeePublicationCapabilities';
import { APPROVAL_TABS, type ApprovalTab } from '@/utils/approvalCenter';
import { useIntl, useSearchParams } from '@umijs/max';
import { Badge, Segmented, Tabs } from 'antd';
import { useState } from 'react';
import styles from './index.module.less';

export default function ApprovalCenter() {
  const intl = useIntl();
  const [searchParams, setSearchParams] = useSearchParams();
  const capabilities = useEmployeePublicationCapabilities();
  const { counts, refresh } = useApprovalPendingCounts();
  const [employeeAuditKind, setEmployeeAuditKind] = useState('use');
  const activeTab = APPROVAL_TABS.find((tab) => tab.key === searchParams.get('tab')) || APPROVAL_TABS[0];
  const publicationSelected =
    activeTab.key === 'employee' && employeeAuditKind === 'publication' && capabilities?.enabled;
  // 审核类型切换固定在页签栏右侧，使用授权和员工发布视图共享同一入口。
  const employeeKindSelector = activeTab.key === 'employee' && capabilities?.enabled && (
    <Segmented
      className={styles.employeeKinds}
      value={employeeAuditKind}
      options={[
        { value: 'use', label: intl.formatMessage({ id: 'approvalCenter.employeeUse' }) },
        { value: 'publication', label: intl.formatMessage({ id: 'approvalCenter.employeePublication' }) },
      ]}
      onChange={(value) => setEmployeeAuditKind(String(value))}
    />
  );

  return (
    <div className={styles.container}>
      <Tabs
        className={styles.tabs}
        activeKey={activeTab.key}
        tabBarExtraContent={{ right: employeeKindSelector }}
        items={APPROVAL_TABS.map((tab) => ({
          key: tab.key,
          label: (
            <Badge count={counts[tab.key]} size="small" offset={[3, -2]}>
              <span className={styles.tabLabel}>{intl.formatMessage({ id: tab.label })}</span>
            </Badge>
          ),
        }))}
        onChange={(key) => {
          const next = new URLSearchParams(searchParams);
          next.set('tab', key as ApprovalTab);
          setSearchParams(next);
        }}
      />
      <div className={styles.content}>
        {publicationSelected ? (
          <PublicationAuditList initialReview onAuditComplete={refresh} />
        ) : (
          // 按类型重建表格，避免切换页签时沿用上一类资源的历史和待审缓存。
          <ResourceAuditCenter
            key={activeTab.key}
            resourceBizTypeList={activeTab.resourceBizTypeList}
            onAuditComplete={refresh}
          />
        )}
      </div>
    </div>
  );
}
