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
}) => {
  return (
    <div className={styles.heroPanel}>
      <div className={styles.heroHeader}>
        <div className={styles.heroTitle}>{intl.formatMessage({ id: 'modelMgr.title' })}</div>

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
            {/* 完善参数与添加模型共用横向操作栏，保持在添加按钮右侧。 */}
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
          </Space>
        </div>
      </div>

    </div>
  );
};

export default ModelHeroPanel;
