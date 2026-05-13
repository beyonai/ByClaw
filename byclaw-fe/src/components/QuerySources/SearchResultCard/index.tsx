/**
 * SearchResultCard 组件
 * Web搜索结果卡片，展示搜索结果列表和操作按钮
 */

import React, { useCallback, useMemo } from 'react';
import { Button, Popconfirm } from 'antd';
import { ExperimentOutlined, GlobalOutlined, LinkOutlined, BookOutlined, BankOutlined } from '@ant-design/icons';
import type { SearchResultCardProps, SearchMode } from '../types';
import styles from './index.less';

interface ExtendedSearchResultCardProps extends SearchResultCardProps {
  searchMode?: SearchMode;
}

const SearchResultCard: React.FC<ExtendedSearchResultCardProps> = (props) => {
  const {
    isImporting,
    results,
    onDelete,
    onImport,
    onViewDetail,
    maxDisplayCount = 3,
    searchMode = 'webSearch',
  } = props;

  const displayResults = useMemo(() => {
    return results.slice(0, maxDisplayCount);
  }, [results, maxDisplayCount]);

  const remainingCount = useMemo(() => {
    return Math.max(0, results.length - maxDisplayCount);
  }, [results, maxDisplayCount]);

  const handleImportAll = useCallback(() => {
    onImport(results);
  }, [results, onImport]);

  // 获取搜索模式的图标
  const getModeIcon = () => {
    switch (searchMode) {
      case 'knowledgeBase':
        return <BookOutlined className={styles.headerIcon} />;
      case 'enterpriseKnowledgeBase':
        return <BankOutlined className={styles.headerIcon} />;
      default:
        return <ExperimentOutlined className={styles.headerIcon} />;
    }
  };

  // 获取搜索模式的标题
  const getModeTitle = () => {
    switch (searchMode) {
      case 'knowledgeBase':
        return '个人知识库搜索已完成';
      case 'enterpriseKnowledgeBase':
        return '企业知识库搜索已完成';
      default:
        return '搜索已完成';
    }
  };

  // 处理结果项点击
  const handleResultClick = (item: (typeof results)[0]) => {
    if (searchMode === 'webSearch' && item.data?.url) {
      window.open(item.data.url, '_blank');
    }
    // 知识库搜索不跳转，只做展示
  };

  // 获取结果项的图标
  const getResultIcon = (item: (typeof results)[0]) => {
    if (searchMode === 'webSearch') {
      return item.data?.favicon ? (
        <img src={item.data.favicon} alt={item.title} className={styles.favicon} />
      ) : (
        <GlobalOutlined />
      );
    }
    if (searchMode === 'knowledgeBase') {
      return <BookOutlined />;
    }
    if (searchMode === 'enterpriseKnowledgeBase') {
      return <BankOutlined />;
    }
    return <GlobalOutlined />;
  };

  return (
    <div className={styles.resultCard}>
      {/* 卡片头部 */}
      <div className={styles.cardHeader}>
        <div className={styles.headerLeft}>
          {getModeIcon()}
          <span className={styles.headerTitle}>{getModeTitle()}</span>
        </div>
        <Button type="link" className={styles.viewButton} onClick={onViewDetail}>
          查看
        </Button>
      </div>

      {/* 搜索结果列表 */}
      <div className={styles.resultList}>
        {displayResults.map((item) => (
          <div
            key={item.uuid}
            className={styles.resultItem}
            onClick={() => handleResultClick(item)}
            style={{ cursor: searchMode === 'webSearch' ? 'pointer' : 'default' }}
          >
            <div className={styles.resultIcon}>{getResultIcon(item)}</div>
            <div className={styles.resultContent}>
              <div title={item.title} className={styles.resultTitle}>
                {item.title}
              </div>
            </div>
          </div>
        ))}

        {/* 更多来源提示 */}
        {remainingCount > 0 && (
          <div className={styles.moreSources} onClick={onViewDetail}>
            <LinkOutlined className={styles.moreIcon} />
            <span className={styles.moreText}>另外 {remainingCount} 个来源</span>
          </div>
        )}
      </div>

      {/* 底部操作按钮 */}
      <div className={styles.cardFooter}>
        <Popconfirm title="确定删除吗？" onConfirm={onDelete}>
          <Button type="link" className={styles.deleteButton} disabled={isImporting}>
            删除
          </Button>
        </Popconfirm>
        <Button type="primary" className={styles.importButton} onClick={handleImportAll} loading={isImporting}>
          导入
        </Button>
      </div>
    </div>
  );
};

export default SearchResultCard;
