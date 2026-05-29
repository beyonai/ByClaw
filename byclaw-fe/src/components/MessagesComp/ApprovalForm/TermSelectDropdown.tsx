import React, { useMemo, useState } from 'react';
import { DownOutlined } from '@ant-design/icons';
import { Dropdown, Empty, Input, Spin, Tooltip } from 'antd';

import { getTermsOptions } from '@/service/message';

import styles from './index.module.less';
import { mergeTermOptions, normalizeTermOptions } from './utils';

import type { IForm } from './index';

type IProps = {
  item: IForm;
  value?: TermValue | TermValue[];
  disabled?: boolean;
  isMultiple?: boolean;
  onChange?: (value?: TermValue | TermValue[]) => void;
};

type TermValue = string | number;

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 10;

function TermSelectDropdown(props: IProps) {
  const { item, value, disabled, isMultiple = false, onChange } = props;

  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState(item.keyword || '');
  const [, forceUpdate] = useState(0);

  const options = item.options || [];
  const selectedValues = useMemo<TermValue[]>(() => {
    if (isMultiple) {
      if (Array.isArray(value)) {
        return value;
      }

      return value === undefined || value === null || value === '' ? [] : [value];
    }

    if (Array.isArray(value)) {
      return [];
    }

    return value === undefined || value === null || value === '' ? [] : [value];
  }, [isMultiple, value]);
  const selectedOptions = useMemo(() => {
    return options.filter((option) => selectedValues.includes(option.value));
  }, [options, selectedValues]);
  const displayValue = useMemo<string>(() => {
    if (isMultiple) {
      return selectedOptions.map((option) => `${option.label}(${option.value})`).join('、');
    }

    if (selectedOptions[0]) {
      return `${selectedOptions[0].label}(${selectedOptions[0].value})`;
    }

    return Array.isArray(value) ? '' : `${value || ''}`;
  }, [isMultiple, selectedOptions, value]);
  const hasMore = !!item.hasMore;

  const refresh = () => {
    forceUpdate((count) => count + 1);
  };

  const loadOptions = async (nextPage = DEFAULT_PAGE, nextKeyword = keyword, append = false) => {
    if (item.termOptionsLoading || !item.term) {
      return;
    }

    item.termOptionsLoading = true;
    refresh();

    try {
      const data = await getTermsOptions({
        ...item.term,
        page: nextPage,
        pageSize: item.pageSize || DEFAULT_PAGE_SIZE,
        keyword: nextKeyword,
      });
      const nextOptions = normalizeTermOptions(data);

      item.options = append ? mergeTermOptions(item.options, nextOptions) : nextOptions;

      const pageSize = data?.pageSize ?? item.pageSize ?? DEFAULT_PAGE_SIZE;
      item.page = data?.page ?? nextPage;
      item.pageSize = pageSize;
      item.total = data?.total;
      item.hasMore = nextOptions.length >= pageSize;
      item.keyword = nextKeyword;
    } catch (e) {
      console.error(e);
    } finally {
      item.termOptionsLoading = false;
      refresh();
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);

    if (nextOpen && !Array.isArray(item.options)) {
      loadOptions(DEFAULT_PAGE, item.keyword || '');
    }
  };

  const handleSearch = (nextKeyword: string) => {
    setKeyword(nextKeyword);
    loadOptions(DEFAULT_PAGE, nextKeyword);
  };

  const handlePopupScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const isNearBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 24;

    if (isNearBottom && hasMore && !item.termOptionsLoading) {
      loadOptions((item.page || DEFAULT_PAGE) + 1, item.keyword || keyword, true);
    }
  };

  const popup = (
    <div className={styles.termSelectDropdown}>
      <Input.Search
        allowClear
        value={keyword}
        onChange={(e) => {
          setKeyword(e.target.value);
        }}
        onSearch={handleSearch}
      />
      <div className={styles.termSelectList} onScroll={handlePopupScroll}>
        {options.map((option) => (
          <div
            className={selectedValues.includes(option.value) ? styles.termSelectOptionActive : styles.termSelectOption}
            key={option.value}
            onClick={() => {
              if (isMultiple) {
                const nextValue = selectedValues.includes(option.value)
                  ? selectedValues.filter((selectedValue) => selectedValue !== option.value)
                  : [...selectedValues, option.value];

                item.fieldValue = nextValue;
                onChange?.(nextValue);
                return;
              }

              item.fieldValue = option.value;
              onChange?.(option.value);
              setOpen(false);
            }}
          >
            <Tooltip title={`${option.label}(${option.value})`} placement="right">
              <span className={styles.termSelectOptionText}>
                {option.label}({option.value})
              </span>
            </Tooltip>
          </div>
        ))}
        {!item.termOptionsLoading && options.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
        {item.termOptionsLoading && (
          <div className={styles.termSelectLoading}>
            <Spin size="small" />
          </div>
        )}
      </div>
    </div>
  );

  return (
    <Dropdown
      open={open}
      trigger={['click']}
      disabled={disabled}
      popupRender={() => popup}
      onOpenChange={handleOpenChange}
    >
      <Input readOnly disabled={disabled} suffix={<DownOutlined />} value={displayValue} />
    </Dropdown>
  );
}

export default TermSelectDropdown;
