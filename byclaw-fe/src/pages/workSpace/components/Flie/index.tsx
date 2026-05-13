import { DownloadOutlined, EyeOutlined, FilterOutlined, MoreOutlined, ShareAltOutlined } from '@ant-design/icons';
import { ConfigProvider, GetProps, Input, Tree, TreeDataNode } from 'antd';
import { useIntl } from '@umijs/max';
import React, { useState } from 'react';
import styles from './index.module.less';

const { Search } = Input;
const { DirectoryTree } = Tree;

type DirectoryTreeProps = GetProps<typeof Tree.DirectoryTree>;

const FilePage = () => {
  const intl = useIntl();
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const [treeData] = React.useState<TreeDataNode[]>([]);

  const onExpand: DirectoryTreeProps['onExpand'] = (keys, info) => {
    console.log('Trigger Expand', keys, info);
  };

  const renderTitle = (node: any) => {
    const isActive = hoveredKey === node.key || selectedKey === node.key;
    return (
      <div
        className={styles.treeNodeWrap}
        onMouseEnter={() => setHoveredKey(node.key)}
        onMouseLeave={() => setHoveredKey(null)}
        onClick={() => setSelectedKey(node.key)}
      >
        <span className={styles.treeNodeIcon}>{node.icon}</span>
        <span className={styles.treeNodeTitle}>{node.title}</span>
        {isActive && node.isLeaf && (
          <span className={styles.treeNodeActions}>
            <EyeOutlined className={styles.actionIcon} title={intl.formatMessage({ id: 'common.preview' })} />
            <DownloadOutlined className={styles.actionIcon} title={intl.formatMessage({ id: 'common.download' })} />
            <ShareAltOutlined className={styles.actionIcon} title={intl.formatMessage({ id: 'common.share' })} />
            <MoreOutlined className={styles.actionIcon} title={intl.formatMessage({ id: 'common.more' })} rotate={90} />
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

export default FilePage;
