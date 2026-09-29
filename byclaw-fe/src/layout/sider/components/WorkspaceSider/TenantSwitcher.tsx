import React, { useEffect, useMemo, useState } from 'react';
import { DownOutlined, TeamOutlined } from '@ant-design/icons';
import { Dropdown, message } from 'antd';
import type { MenuProps } from 'antd';
// @ts-ignore
import { useIntl } from '@umijs/max';
import { getAvailableTenants, validateTenantSwitch, type TenantAvailableItem } from '@/service/tenantContext';
import { getSelectedEnterpriseId } from '@/utils/tenantContext';
import webSocketManager from '@/utils/websocket';
import styles from './index.module.less';

const TenantSwitcher: React.FC = () => {
  const intl = useIntl();
  const [tenants, setTenants] = useState<TenantAvailableItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(() => getSelectedEnterpriseId());
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    let mounted = true;
    getAvailableTenants()
      .then((available) => {
        if (mounted) setTenants(Array.isArray(available) ? available : []);
      })
      .catch(() => {
        if (mounted) setTenants([]);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const selectedTenant = tenants.find((tenant) => tenant.enterpriseId === selectedId);
  const title = selectedTenant?.enterpriseName || intl.formatMessage({ id: 'tenantSwitcher.personal' });
  const items: MenuProps['items'] = useMemo(
    () => [
      {
        key: 'personal',
        label: intl.formatMessage({ id: 'tenantSwitcher.personal' }),
      },
      ...(tenants.length > 0 ? [{ type: 'divider' as const }] : []),
      ...tenants.map((tenant) => ({
        key: tenant.enterpriseId,
        label:
          tenant.provisionState === 'READY'
            ? tenant.enterpriseName
            : `${tenant.enterpriseName} · ${intl.formatMessage({ id: 'tenantSwitcher.unavailable' })}`,
        disabled: tenant.provisionState !== 'READY',
      })),
    ],
    [intl, tenants]
  );

  const handleMenuClick: MenuProps['onClick'] = async ({ key }) => {
    if (switching || (key !== 'personal' && key === selectedId)) return;
    const tenant = tenants.find((item) => item.enterpriseId === key);
    if (key !== 'personal' && (!tenant || tenant.provisionState !== 'READY')) return;

    setSwitching(true);
    try {
      if (key === 'personal') {
        await webSocketManager.switchTenant(null);
        setSelectedId(null);
      } else {
        await validateTenantSwitch(key);
        await webSocketManager.switchTenant(key);
        setSelectedId(key);
      }
    } catch {
      message.error(intl.formatMessage({ id: 'tenantSwitcher.switchFailed' }));
    } finally {
      setSwitching(false);
    }
  };

  return (
    <Dropdown
      trigger={['click']}
      placement="topLeft"
      menu={{ items, selectedKeys: [selectedId || 'personal'], onClick: handleMenuClick }}
    >
      <button
        type="button"
        className={styles.tenantSwitcher}
        aria-label={intl.formatMessage({ id: 'tenantSwitcher.open' })}
        title={title}
        disabled={loading || switching}
      >
        <TeamOutlined className={styles.tenantSwitcherIcon} />
        <span className={styles.tenantSwitcherName}>{loading ? '…' : title}</span>
        <DownOutlined className={styles.tenantSwitcherArrow} />
      </button>
    </Dropdown>
  );
};

export default TenantSwitcher;
