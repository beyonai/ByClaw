// @ts-nocheck
/* eslint-disable */
import React, { useState, useMemo, Children } from 'react';

import classnames from 'classnames';
import { useIntl } from '@umijs/max';
import { message, Tooltip, Empty, Button, Radio, Space, Row, Input, DatePicker, Checkbox } from 'antd';
import { FilterOutlined } from '@ant-design/icons';
import { isEmpty } from 'lodash';

import InputNumberRange from '@/pages/manager/components/InputNumberRange';
import styles from './utils.module.less';

import { feedbackTypeOpts } from '@/pages/manager/constants/conversation';

const { RangePicker } = DatePicker;

const FilterDropdownMultiSelect: React.FC<{
  optionData: any[];
  empty?: React.ReactNode;
  setSelectedKeys: (keys: any[]) => void;
  selectedKeys: any[];
  confirm: () => void;
  clearFilters: () => void;
}> = ({ optionData, empty, setSelectedKeys, selectedKeys, confirm, clearFilters }) => {
  const intl = useIntl();
  const [searchKey, setSearchKey] = useState('');

  const dataList = useMemo(
    () => optionData?.filter((item) => item?.label?.includes(searchKey)),
    [optionData, searchKey]
  );

  return (
    <div className={styles.raidScroll}>
      <Input
        placeholder={intl.formatMessage({ id: 'employeeDetail.searchKeyword' })}
        value={searchKey}
        onChange={(e) => {
          setSearchKey(e.target.value);
        }}
      />
      {!dataList?.length ? (
        empty || <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <Checkbox.Group
          className={styles.checkboxGroup}
          onChange={(e) => {
            setSelectedKeys(e);
          }}
          value={selectedKeys}
        >
          <Space direction="vertical">
            {dataList.map((item) => (
              <Checkbox key={item.value} value={item.value}>
                {item.label}
              </Checkbox>
            ))}
          </Space>
        </Checkbox.Group>
      )}

      <Row align="middle" justify="space-between" className={styles.raidScrollBtns}>
        <Button
          type="link"
          onClick={() => {
            clearFilters?.();
          }}
          size="small"
          disabled={isEmpty(selectedKeys)}
        >
          {intl.formatMessage({ id: 'common.reset' })}
        </Button>
        <Button
          type="primary"
          onClick={() => {
            confirm?.();
          }}
          size="small"
        >
          {intl.formatMessage({ id: 'common.confirm' })}
        </Button>
      </Row>
    </div>
  );
};

// 多选下拉单选
export const getColumnOptionsSelectSettingMulti = (optionData = [], empty) => {
  return {
    filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters }: any) => (
      <FilterDropdownMultiSelect
        optionData={optionData}
        empty={empty}
        setSelectedKeys={setSelectedKeys}
        selectedKeys={selectedKeys}
        confirm={confirm}
        clearFilters={clearFilters}
      />
    ),
    filterIcon: (filtered: boolean) => (
      <FilterOutlined style={{ color: filtered ? '#1890ff' : undefined, fontSize: '12px' }} />
    ),
  };
};

const FilterDropdownTimeSelect: React.FC<{
  showTime: boolean;
  setSelectedKeys: (keys: any[]) => void;
  selectedKeys: any[];
  confirm: () => void;
  clearFilters: () => void;
}> = ({ showTime, setSelectedKeys, selectedKeys, confirm, clearFilters }) => {
  const intl = useIntl();

  return (
    <div className={classnames(styles.raidScroll, styles.raidScrollWide)}>
      <RangePicker
        showTime={showTime}
        placeholder={[
          intl.formatMessage({ id: 'employeeDetail.startTime' }),
          intl.formatMessage({ id: 'employeeDetail.endTime' }),
        ]}
        value={selectedKeys}
        onChange={(v) => {
          setSelectedKeys(v);
        }}
        className={styles.rangePickerWrapper}
      />

      <Row align="middle" justify="space-between" className={styles.raidScrollBtns}>
        <Button
          type="link"
          onClick={() => {
            setSelectedKeys([]);
            clearFilters?.();
            confirm?.();
          }}
          size="small"
          disabled={isEmpty(selectedKeys)}
        >
          {intl.formatMessage({ id: 'common.reset' })}
        </Button>
        <Button
          type="primary"
          onClick={() => {
            confirm?.();
          }}
          size="small"
        >
          {intl.formatMessage({ id: 'common.confirm' })}
        </Button>
      </Row>
    </div>
  );
};

// 时间选择
export const getColumnOptionsTimeSetting = (showTime = false) => {
  return {
    filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters }: any) => (
      <FilterDropdownTimeSelect
        showTime={showTime}
        setSelectedKeys={setSelectedKeys}
        selectedKeys={selectedKeys}
        confirm={confirm}
        clearFilters={clearFilters}
      />
    ),
    filterIcon: (filtered: boolean) => (
      <FilterOutlined style={{ color: filtered ? '#1890ff' : undefined, fontSize: '12px' }} />
    ),
  };
};

const FilterDropdownValueRangePicker: React.FC<{
  setSelectedKeys: (keys: any[]) => void;
  selectedKeys: any[];
  confirm: () => void;
  clearFilters: () => void;
}> = ({ setSelectedKeys, selectedKeys, confirm, clearFilters }) => {
  const intl = useIntl();

  return (
    <div className={classnames(styles.raidScroll, styles.raidScrollWide)}>
      <InputNumberRange
        value={selectedKeys}
        onChange={(v) => {
          setSelectedKeys(v);
        }}
        className={styles.numberRangeWrapper}
      />

      <Row align="middle" justify="space-between" className={styles.raidScrollBtns}>
        <Button
          type="link"
          onClick={() => {
            setSelectedKeys([]);
            clearFilters?.();
            confirm?.();
          }}
          size="small"
          disabled={isEmpty(selectedKeys)}
        >
          {intl.formatMessage({ id: 'common.reset' })}
        </Button>
        <Button
          type="primary"
          onClick={() => {
            confirm?.();
          }}
          size="small"
        >
          {intl.formatMessage({ id: 'common.confirm' })}
        </Button>
      </Row>
    </div>
  );
};

export const getColumnValueRangePickerSetting = () => {
  return {
    filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters }: any) => (
      <FilterDropdownValueRangePicker
        setSelectedKeys={setSelectedKeys}
        selectedKeys={selectedKeys}
        confirm={confirm}
        clearFilters={clearFilters}
      />
    ),
    filterIcon: (filtered: boolean) => (
      <FilterOutlined style={{ color: filtered ? '#1890ff' : undefined, fontSize: '12px' }} />
    ),
  };
};

const FilterDropdownFeedbackType: React.FC<{
  setSelectedKeys: (key: any) => void;
  selectedKeys: any;
  confirm: () => void;
  clearFilters: () => void;
}> = ({ setSelectedKeys, selectedKeys, confirm, clearFilters }) => {
  const intl = useIntl();

  return (
    <div className={classnames(styles.raidScroll, styles.raidScrollAuto)}>
      <Radio.Group
        className={styles.radioGroup}
        onChange={(e) => {
          setSelectedKeys(e.target.value);
        }}
        value={selectedKeys}
      >
        <Space direction="vertical" className={styles.radioSpace}>
          {feedbackTypeOpts.map((item) => (
            <Radio key={item.value} value={item.key} className={styles.radioItem}>
              {item.label}
            </Radio>
          ))}
        </Space>
      </Radio.Group>

      <Row align="middle" justify="space-between" className={styles.raidScrollBtns}>
        <Button
          type="link"
          onClick={() => {
            setSelectedKeys('');
            clearFilters?.();
            confirm?.();
          }}
          size="small"
          disabled={isEmpty(selectedKeys)}
        >
          {intl.formatMessage({ id: 'common.reset' })}
        </Button>
        <Button
          type="primary"
          onClick={() => {
            confirm?.();
          }}
          size="small"
        >
          {intl.formatMessage({ id: 'common.confirm' })}
        </Button>
      </Row>
    </div>
  );
};

export const getColumnFeedbackTypeSetting = () => {
  return {
    filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters }: any) => (
      <FilterDropdownFeedbackType
        setSelectedKeys={setSelectedKeys}
        selectedKeys={selectedKeys}
        confirm={confirm}
        clearFilters={clearFilters}
      />
    ),
    filterIcon: (filtered: boolean) => (
      <FilterOutlined style={{ color: filtered ? '#1890ff' : undefined, fontSize: '12px' }} />
    ),
  };
};
