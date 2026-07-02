import { ThunderboltOutlined } from '@ant-design/icons';
import { Button, Input, Space, Tooltip } from 'antd';
import classNames from 'classnames';
import React from 'react';
import AntdIcon from '@/pages/manager/components/AntdIcon';
import commonStyles from '@/pages/manager/less/commonTabList.less';
import styles from '../index.module.less';

type IntlShape = {
  formatMessage: (descriptor: { id: string }, values?: Record<string, any>) => string;
};

type Props = {
  intl: IntlShape;
  keyword: string;
  setKeyword: (value: string) => void;
  onSearch: () => void;
  onReset: () => void;
  onAdd: () => void;
  onCompleteConfig: () => void;
  completeLoading?: boolean;
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
  onCompleteConfig,
  completeLoading,
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

        <div className={styles.heroActions}>
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
          <Tooltip title={intl.formatMessage({ id: 'modelMgr.completeAllTooltip' })}>
            <Button
              className={styles.completeConfigButton}
              icon={<ThunderboltOutlined />}
              loading={completeLoading}
              onClick={onCompleteConfig}
            >
              {intl.formatMessage({ id: 'modelMgr.completeAllButton' })}
            </Button>
          </Tooltip>
        </div>
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
