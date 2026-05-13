import React, { useContext, useEffect, useState } from 'react';
import { ConfigProvider, Empty, Spin, Tree } from 'antd';
import type { TreeDataNode, TreeProps } from 'antd';
import cn from 'classnames';
import { useIntl } from '@umijs/max';
import AntdIcon from '@/components/AntdIcon';
import { getTimeAgo } from '@/utils/date';
import { getSearchList } from '@/service/workSpace';
import { AchievementContext } from './AchievementContext';
import { InputFilter } from './InputFilter';
import styles from './search.view.module.less';

type SearchItem = {
  url?: string;
  type: 'url' | 'file';
  title?: string;
  content?: string;
};

type SearchInfo = TreeDataNode & { date?: string; children?: (TreeDataNode & SearchItem)[] };

export default function SearchView() {
  const intl = useIntl();
  const context = useContext(AchievementContext);
  const [sessionId] = context.useValue('sessionId');
  const [task] = context.useValue('task');
  const [treeData, setTreeData] = useState<SearchInfo[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [inputValue, setInputValue] = useState<string>('');

  const onRefresh = async (param: any) => {
    if (!param.sessionId || !param.taskId) return;
    setLoading(true);
    const res = await getSearchList(param);
    setLoading(false);
    if (!res || typeof res !== 'object') {
      console.warn('查询结果数据格式错误 >', res);
      return;
    }

    const list = Object.entries(res).map<SearchInfo>(([key, { resources, uploadDate }]: [string, any], i: number) => ({
      key: i,
      title: key,
      date: uploadDate,
      children: (resources ?? []).map((it: any, ii: number) => ({
        ...it,
        key: [i, ii].join('-'),
        url: it.url,
        type: it.type,
        title: it.title,
      })),
    }));
    setTreeData(list);
  };

  useEffect(() => {
    onRefresh({ sessionId, taskId: task?.taskId });
  }, [sessionId, task]);

  const iconRender: TreeProps['icon'] = (node: any) => {
    if (node.data.children?.length) {
      return <AntdIcon type="icon-a-Searchsousuo21" />;
    }
    if (node.data.type === 'ON_LINE') {
      return <AntdIcon type="icon-a-Link-onelianjie" style={{ color: '#165dff' }} />;
    }
    return <AntdIcon type="icon-jishiben" />;
  };

  const onItemClick: TreeProps['onClick'] = (e, node: any) => {
    e.stopPropagation();
    if (node.type === 'ON_LINE' && node.url) {
      window.open(node.url, '_blank');
    }
    if (node.type === 'DATASET' && node.documentId) {
      const type = node.title.split('.').pop();
      context.effects.toPreviewFile?.({
        type,
        name: node.title,
        fileId: node.documentId,
      });
    }
  };

  const titleRender: TreeProps['titleRender'] = (node) => {
    const isParent = node.children && node.children.length > 0;
    let { date } = node as SearchInfo;
    if (date) date = getTimeAgo(date);
    return (
      <div className={cn(styles.treeNode, { [styles.treeNodeParent]: isParent })}>
        <span className={styles.treeNodeTitle}>{typeof node.title === 'function' ? node.title(node) : node.title}</span>
        {isParent && (
          <>
            <span className={styles.count}>
              {intl.formatMessage({ id: 'workSpace.searchView.resultCount' }, { count: node.children?.length || 0 })}
            </span>
            <span className={styles.date}>{date}</span>
          </>
        )}
      </div>
    );
  };

  return (
    <section className={styles.searchView}>
      <ConfigProvider
        theme={{
          components: {
            Tree: {
              paddingXS: 8,
              indentSize: 0,
              borderRadius: 6,
              nodeHoverBg: 'rgba(0,0,0,0.04)',
              nodeSelectedBg: 'rgba(0,0,0,0.04)',
            },
          },
        }}
      >
        <div className={styles.searchViewHeader}>
          <InputFilter
            value={inputValue}
            onChange={setInputValue}
            onSearch={(v) => onRefresh({ sessionId, taskId: task?.taskId, title: v })}
          />
        </div>
        <Spin spinning={loading}>
          <Tree
            blockNode
            defaultExpandAll
            showLine={false}
            treeData={treeData}
            className={styles.tree}
            titleRender={titleRender}
            icon={iconRender}
            onClick={onItemClick}
            showIcon
            switcherIcon={<AntdIcon type="icon-a-Downxia1" style={{ fontSize: 16 }} />}
          />
          {!treeData.length && <Empty />}
        </Spin>
      </ConfigProvider>
    </section>
  );
}
