import { FilterOutlined } from '@ant-design/icons';
import { ConfigProvider, GetProps, Input, Tree, TreeDataNode } from 'antd';
import { useIntl } from '@umijs/max';
import React, { useState } from 'react';
import styles from './index.module.less';

const { Search } = Input;
const { DirectoryTree } = Tree;

type DirectoryTreeProps = GetProps<typeof Tree.DirectoryTree>;

const SearchPage = () => {
  const intl = useIntl();
  const [treeData] = useState<TreeDataNode[]>([]);
  const [, setHoveredKey] = useState<string | null>(null);
  const [, setSelectedKey] = useState<string | null>(null);

  const onExpand: DirectoryTreeProps['onExpand'] = (keys, info) => {
    console.log('Trigger Expand', keys, info);
  };

  const renderTitle = (node: any) => {
    return (
      <div
        className={styles.treeNodeWrap}
        onMouseEnter={() => setHoveredKey(node.key)}
        onMouseLeave={() => setHoveredKey(null)}
        onClick={() => setSelectedKey(node.key)}
      >
        <span className={styles.treeNodeIcon}>{node.icon}</span>
        <span className={node.children ? styles.treeNodeTitle : styles.treeNodeTitleSub}>{node.title}</span>
        {node.children && (
          <span className={styles.treeNodeRight}>
            <span className={styles.treeNodeNum}>
              {intl.formatMessage({ id: 'common.totalResults' }, { count: 4 })}
            </span>
            <span className={styles.treeNodeTime}>{intl.formatMessage({ id: 'common.daysAgo' }, { days: 8 })}</span>
          </span>
        )}
      </div>
    );
  };

  return (
    <div className={styles.filePage}>
      {/* 搜索栏和筛选 */}
      <div className={styles.fileHeader}>
        <Search
          className={styles.searchInput}
          placeholder={intl.formatMessage({ id: 'common.inputKeyword' })}
          allowClear
        />
        <FilterOutlined className={styles.filter} />
      </div>
      {/* 文件列表 */}
      <div className={styles.fileContent}>
        <ConfigProvider
          theme={{
            components: {
              Tree: {
                directoryNodeSelectedBg: '#e6ebf0a6',
                directoryNodeSelectedColor: '#14161A',
                nodeHoverBg: '#e6ebf0a6',
                nodeHoverColor: '#14161A',
                nodeSelectedBg: '#e6ebf0a6',
                nodeSelectedColor: '#14161A',
              },
            },
          }}
        >
          <DirectoryTree
            showIcon={false}
            defaultExpandAll
            onSelect={(keys) => {
              setSelectedKey(keys[0] as string);
            }}
            onExpand={onExpand}
            treeData={treeData.map((node) => ({
              ...node,
              title: renderTitle(node),
              children: node.children?.map((child) => ({
                ...child,
                title: renderTitle(child),
              })),
            }))}
          />
        </ConfigProvider>
      </div>
    </div>
  );
};

export default SearchPage;
