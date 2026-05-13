/**
 * WebSearch 组件
 * Web搜索区域，包含搜索输入框和搜索结果卡片
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Button, Spin, Tooltip, Input, Dropdown, Space } from 'antd';
import { LoadingOutlined, ArrowRightOutlined, GlobalOutlined, DownOutlined } from '@ant-design/icons';
import type { SearchMode, WebSearchProps } from '../types';
import SearchResultCard from '../SearchResultCard';
import styles from './index.less';

const WebSearch: React.FC<WebSearchProps> = (props) => {
  const {
    isImporting,
    status,
    results,
    onSearch,
    onDeleteResult,
    onImportResults,
    onViewDetail,
    inModal = false,
    onCloseModal,
    disabled = false,
  } = props;

  const [searchMode, setSearchMode] = useState<SearchMode>('webSearch');
  const [inputValue, setInputValue] = useState('');

  const searchModeMenus = useMemo<
    {
      key: SearchMode;
      label: string;
      icon: React.ReactNode;
    }[]
  >(() => {
    return [
      { label: 'Web', key: 'webSearch', icon: <GlobalOutlined /> },
    ];
  }, []);

  const searchModeLabel = useMemo(() => {
    return searchModeMenus.find((menu) => menu.key === searchMode)?.label;
  }, [searchMode]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
  }, []);

  const handleSearch = useCallback(() => {
    if (!inputValue.trim() || disabled) return;

    onSearch(inputValue.trim(), searchMode);

    // 如果在弹窗中，开始搜索后关闭弹窗
    if (inModal && onCloseModal) {
      onCloseModal();
    }
  }, [inputValue, disabled, onSearch, inModal, onCloseModal, searchMode]);

  const renderSearchInput = () => {
    const inputContent = (
      <div className={styles.searchContainer}>
        <div className={styles.searchInputWrapper}>
          <Input.Search
            placeholder={`在${searchModeLabel}中搜索来源`}
            value={inputValue}
            onChange={handleInputChange}
            onSearch={handleSearch}
            disabled={disabled}
          />
        </div>
        <div className={styles.searchActionsBottom}>
          <Dropdown
            menu={{
              items: searchModeMenus,
              onClick: (item) => {
                setSearchMode(item.key as SearchMode);
              },
            }}
          >
            <Button icon={searchModeMenus.find((menu) => menu.key === searchMode)?.icon}>
              <Space>
                {searchModeLabel}
                <DownOutlined />
              </Space>
            </Button>
          </Dropdown>
          <Button
            shape="circle"
            type="primary"
            icon={<ArrowRightOutlined />}
            onClick={handleSearch}
            disabled={disabled || !inputValue.trim()}
          />
        </div>
      </div>
    );

    if (disabled) {
      return (
        <Tooltip title="请先导入或删除结果，然后再开始其他搜索" placement="bottom">
          {inputContent}
        </Tooltip>
      );
    }

    return inputContent;
  };

  const renderLoading = () => {
    if (status !== 'searching') return null;

    return (
      <div className={styles.loadingWrapper}>
        <Spin indicator={<LoadingOutlined spin />} size="small" />
        <span className={styles.loadingText}>正在努力搜索...</span>
      </div>
    );
  };

  const renderResults = () => {
    if (status !== 'completed' || results.length === 0) return null;

    return (
      <SearchResultCard
        isImporting={isImporting}
        results={results}
        onDelete={onDeleteResult}
        onImport={onImportResults}
        onViewDetail={onViewDetail}
        maxDisplayCount={3}
        searchMode={searchMode}
      />
    );
  };

  return (
    <div className={styles.webSearchWrapper}>
      {renderSearchInput()}
      {renderLoading()}
      {renderResults()}
    </div>
  );
};

export default WebSearch;
