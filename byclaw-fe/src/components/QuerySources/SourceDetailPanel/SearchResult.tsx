/**
 * SourceDetailPanel 组件
 * 详情Panel，用于查看搜索结果详情或预览知识来源
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Checkbox, Divider, Typography } from 'antd';
import type { WebSearchResult, SearchMode } from '../types';
import styles from './index.less';
import PanelWrapper from './PanelWrapper';
import { GlobalOutlined, BookOutlined, BankOutlined } from '@ant-design/icons';

interface SourceDetailPanelProps {
  isOpen: boolean;
  searchResults: WebSearchResult[];
  onClose: () => void;
  onConfirmImport?: (results: WebSearchResult[]) => void;
  isImporting: boolean;
  afterClose?: () => void;
  searchMode?: SearchMode;
}

const SourceDetailPanel: React.FC<SourceDetailPanelProps> = (props) => {
  const { isOpen, searchResults, onClose, onConfirmImport, isImporting, afterClose, searchMode = 'webSearch' } = props;

  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    if (isOpen) {
      setSelectedIds(searchResults.filter((item) => item.checked).map((item) => item.uuid));
    } else {
      setSelectedIds([]);
    }
  }, [isOpen, searchResults]);

  const onChange = useCallback(
    (id: string, checked: boolean) => {
      const newSelectedIds = checked ? [...selectedIds, id] : selectedIds.filter((item) => item !== id);
      setSelectedIds(newSelectedIds);
    },
    [selectedIds]
  );

  const handleSelectAll = useCallback(
    (checked: boolean) => {
      const allIds = searchResults.map((item) => item.uuid);
      setSelectedIds(checked ? allIds : []);
    },
    [searchResults]
  );

  const handleImport = useCallback(() => {
    onConfirmImport?.(searchResults.filter((item) => selectedIds.includes(item.uuid)));
    onClose();
  }, [selectedIds, onConfirmImport, searchResults, onClose]);

  // 获取搜索模式的标题
  const getPanelTitle = () => {
    switch (searchMode) {
      case 'knowledgeBase':
        return '个人知识库搜索结果';
      case 'enterpriseKnowledgeBase':
        return '企业知识库搜索结果';
      default:
        return '搜索结果';
    }
  };

  // 获取结果项的图标
  const getResultIcon = (item: WebSearchResult) => {
    if (searchMode === 'webSearch') {
      return item.data?.favicon ? <img src={item.data.favicon} alt={item.title} /> : <GlobalOutlined />;
    }
    if (searchMode === 'knowledgeBase') {
      return <BookOutlined />;
    }
    if (searchMode === 'enterpriseKnowledgeBase') {
      return <BankOutlined />;
    }
    return <GlobalOutlined />;
  };

  // 处理结果项点击
  const handleResultClick = (item: WebSearchResult) => {
    if (searchMode === 'webSearch' && item.data?.url) {
      window.open(item.data.url, '_blank');
    }
    // 知识库搜索不跳转，只做展示
  };

  const renderContent = () => {
    return (
      <div className={styles.searchResultsContent}>
        <div className={styles.selectAllBar}>
          <Checkbox
            checked={searchResults.length > 0 && searchResults.every((item) => selectedIds.includes(item.uuid))}
            indeterminate={
              selectedIds.length > 0 && searchResults.length > 0 && selectedIds.length < searchResults.length
            }
            onChange={(e) => handleSelectAll(e.target.checked)}
          >
            <span className={styles.selectAllText}>全选</span>
          </Checkbox>
          <span className={styles.selectedCount}>已选择 {selectedIds.length} 个来源</span>
        </div>

        <Divider className={styles.divider} />

        <div className={styles.resultsList}>
          {searchResults.map((item) => (
            <div key={item.uuid} className={styles.resultDetailItem}>
              <Checkbox
                checked={selectedIds.includes(item.uuid)}
                onChange={(e) => onChange(item.uuid, e.target.checked)}
                className={styles.resultCheckbox}
              />
              <div className={styles.resultDetailContent}>
                <div className={styles.resultDetailHeader}>
                  <div className={styles.resultFavicon}>{getResultIcon(item)}</div>
                  <div
                    className={styles.resultDetailTitle}
                    onClick={() => handleResultClick(item)}
                    style={{ cursor: searchMode === 'webSearch' ? 'pointer' : 'default' }}
                  >
                    {item.title}
                  </div>
                </div>
                <Typography.Paragraph ellipsis={{ rows: 2, tooltip: true }}>{item.data.content}</Typography.Paragraph>
              </div>
            </div>
          ))}
        </div>

        <div className={styles.panelFooter}>
          <Button
            type="primary"
            className={styles.confirmButton}
            onClick={handleImport}
            disabled={selectedIds.length === 0}
            loading={isImporting}
          >
            确认导入
          </Button>
        </div>
      </div>
    );
  };

  return (
    <PanelWrapper isOpen={isOpen} onClose={onClose} title={getPanelTitle()} afterClose={afterClose}>
      {renderContent()}
    </PanelWrapper>
  );
};

export default SourceDetailPanel;
