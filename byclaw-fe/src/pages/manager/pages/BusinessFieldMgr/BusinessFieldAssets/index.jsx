import React, { useState } from 'react';
import { Tabs, Input } from 'antd';
import { useIntl } from '@umijs/max';
import AntdIcon from '@/pages/manager/components/AntdIcon';
import styles from './index.module.less';
import BusinessFieldAssetsList from './BusinessFieldAssetsList';

const BusinessFieldAssets = ({ selectedField }) => {
  const intl = useIntl();
  const [activeTab, setActiveTab] = useState('employee');
  const [searchKeyword, setSearchKeyword] = useState('');

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

    return list;
  }, []);

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
