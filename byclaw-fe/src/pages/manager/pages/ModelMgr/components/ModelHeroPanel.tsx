import { Button, Input, Space } from 'antd';
import classNames from 'classnames';
import React from 'react';
import type { IntlShape } from 'react-intl';
import AntdIcon from '@/pages/manager/components/AntdIcon';
import commonStyles from '@/pages/manager/less/commonTabList.less';
import styles from '../index.module.less';

type Props = {
  intl: IntlShape;
  keyword: string;
  setKeyword: (value: string) => void;
  onSearch: () => void;
  onReset: () => void;
  onAdd: () => void;
  activeFilterCount: number;
  total: number;
  enabledCount: number;
  testingCount: number;
  disabledCount: number;
};

const ModelHeroPanel: React.FC<Props> = ({
  intl,
  keyword,
  setKeyword,
  onSearch,
  onReset,
  onAdd,
  activeFilterCount,
  total,
  enabledCount,
  testingCount,
  disabledCount,
}) => {
  return (
    <div className={styles.heroPanel}>
      <div className={styles.heroHeader}>
        <div>
          <div className={styles.heroTitle}>{intl.formatMessage({ id: 'modelMgr.title' })}</div>
          <div className={styles.heroDesc}>{intl.formatMessage({ id: 'modelMgr.heroDesc' })}</div>
        </div>

        <Space size={12}>
          <Input
            suffix={<AntdIcon type="icon-a-Searchsousuo" onClick={onSearch} />}
            placeholder={intl.formatMessage({ id: 'modelMgr.searchPlaceholder' })}
            className={classNames(commonStyles.searchInput, styles.searchInput)}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onPressEnter={onSearch}
          />
          <Button onClick={onReset} disabled={!activeFilterCount}>
            {intl.formatMessage({ id: 'common.reset' })}
          </Button>
          <Button type="primary" icon={<AntdIcon type="icon-a-People-plustianjiarenqun" />} onClick={onAdd}>
            {intl.formatMessage({ id: 'modelMgr.addNew' })}
          </Button>
        </Space>
      </div>

      <div className={styles.statsRow}>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>{intl.formatMessage({ id: 'modelMgr.statsTotal' })}</div>
          <div className={styles.statValue}>{total || 0}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>{intl.formatMessage({ id: 'modelMgr.statusEnabled' })}</div>
          <div className={styles.statValue}>{enabledCount}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>{intl.formatMessage({ id: 'modelMgr.statusTesting' })}</div>
          <div className={styles.statValue}>{testingCount}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>{intl.formatMessage({ id: 'modelMgr.statusDisabled' })}</div>
          <div className={styles.statValue}>{disabledCount}</div>
        </div>
      </div>
    </div>
  );
};

export default ModelHeroPanel;
