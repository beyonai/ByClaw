import React, { useEffect, useState } from 'react';
import { Tabs, Input } from 'antd';
import { useIntl } from '@umijs/max';
import AntdIcon from '@/pages/manager/components/AntdIcon';
import styles from './index.module.less';
import BusinessFieldAssetsList from './BusinessFieldAssetsList';
import { getDcSystemConfigListByStandType } from '@/service/auth';
import { getVisibleMenuKeysFromConfig } from '@/constants/system';

const BusinessFieldAssets = ({ selectedField }) => {
  const intl = useIntl();
  const [activeTab, setActiveTab] = useState('employee');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [visibleKeys, setVisibleKeys] = useState([]);

  const tabItems = React.useMemo(() => {
    const list = [
      {
        key: 'employee',
        label: intl.formatMessage({ id: 'businessField.assets.digitalEmployee' }),
      },
      {
        key: 'knowledge',
        label: intl.formatMessage({ id: 'businessField.assets.knowledge' }),
      },
      {
        key: 'tool',
        label: intl.formatMessage({ id: 'businessField.assets.tool' }),
      },
      {
        key: 'view',
        label: intl.formatMessage({ id: 'businessField.assets.view' }),
      },
      {
        key: 'object',
        label: intl.formatMessage({ id: 'businessField.assets.object' }),
      },
    ];

    return list.filter((item) => !['view', 'object'].includes(item.key) || visibleKeys.includes(item.key));
  }, [intl, visibleKeys]);

  useEffect(() => {
    getDcSystemConfigListByStandType({
      standType: 'MENU_ICON_SHOW_TAB',
    })
      .then((res) => {
        const configData = res?.data || res;
        if (Array.isArray(configData) && configData.length > 0) {
          setVisibleKeys(getVisibleMenuKeysFromConfig(configData));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (tabItems.length && !tabItems.some((item) => item.key === activeTab)) {
      setActiveTab(tabItems[0].key);
    }
  }, [activeTab, tabItems]);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.title}>
          <Tabs
            activeKey={activeTab}
            onChange={(key) => {
              setActiveTab(key);
              setSearchKeyword('');
            }}
            items={tabItems}
            className={styles.tabs}
          />
        </div>
        <div className={styles.btn}>
          <Input
            placeholder={intl.formatMessage({ id: 'businessField.assets.searchPlaceholder' })}
            prefix={<AntdIcon type="icon-a-Searchsousuo" />}
            suffix={
              <AntdIcon
                type="icon-Q"
                style={{ cursor: 'pointer' }}
                onClick={() => {
                  // 触发搜索
                }}
              />
            }
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            className={styles.searchInput}
          />
        </div>
      </div>
      <div className={styles.content}>
        <BusinessFieldAssetsList selectedField={selectedField} assetType={activeTab} searchKeyword={searchKeyword} />
      </div>
    </div>
  );
};

export default BusinessFieldAssets;
