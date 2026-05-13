import React, { useState } from 'react';
import { Tabs, Input } from 'antd';
import { useIntl } from '@umijs/max';
import AntdIcon from '@/pages/manager/components/AntdIcon';
import styles from './index.module.less';
import BusinessFieldAssetsList from './BusinessFieldAssetsList';

const BusinessFieldAssets = ({ selectedField }) => {
  const intl = useIntl();
  const [activeTab, setActiveTab] = useState('digitalEmployee');
  const [searchKeyword, setSearchKeyword] = useState('');

  const tabItems = React.useMemo(() => {
    const list = [
      {
        key: 'digitalEmployee',
        label: intl.formatMessage({ id: 'businessField.assets.digitalEmployee' }),
      },
      {
        key: 'knowledge',
        label: intl.formatMessage({ id: 'businessField.assets.knowledge' }),
      },
      {
        key: 'skill',
        label: intl.formatMessage({ id: 'businessField.assets.skill' }),
      },
    ];

    return list;
  }, []);

  return (
    <div className={styles.container}>
      {/* <div className={styles.header}>
        <div className={styles.title}>
          <AntdIcon type="icon-a-View-grid-listliebiaochakanmoshi" style={{ marginRight: 8 }} />
          业务领域管理
        </div>
        
      </div> */}
      <div className={styles.tabsContainer}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} className={styles.tabs} />
          <div className={styles.searchBox}>
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
    </div>
  );
};

export default BusinessFieldAssets;
