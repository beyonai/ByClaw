import React, { useState, useEffect, useRef } from 'react';
import { Breadcrumb, Spin, Tree, ConfigProvider } from 'antd';
import { LeftOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import useVirtualHeight from '@/hooks/useVirtualHeight';
import { IDatabaseItem, BIFieldItem, ITreeItem, NodeType } from './types';
import commonStyles from '../common.module.less';
import { queryKnowledge, queryKnowledgeBaseView, queryKnowledgeBaseViewMeta } from '@/service/chatBI';
import { get } from 'lodash';
import AntdIcon from '@/components/AntdIcon';
import { DragType, onTreeNodeDragStart } from '@/components/QueryInput/withDrag';
import { DataNode } from 'antd/es/tree';
import { TreeProps } from 'antd/lib';

interface DatabaseDetailProps {
  knowledge: IDatabaseItem;
  onGoBack: () => void;
  editable?: boolean;
  onSelect?: (node: ITreeItem) => void;
}

const qryDimensions = async (params: { knowledgeBaseId: string; viewId: string }) => {
  return queryKnowledgeBaseViewMeta({
    ...params,
    metaDataType: 'dim',
    pageIndex: 1,
    pageSize: 9999,
  });
};

const qryMeasures = async (params: {
  knowledgeBaseId: string;
  viewId: string;
  vertexTypeIds: [number];
  filterCatalog?: boolean;
}) => {
  return queryKnowledge({
    ...params,
    pageIndex: 1,
    pageSize: 9999,
    sortOrder: 'desc',
  });
};

function nodeDraggable(node: DataNode) {
  return !!node.isLeaf;
}

function onDragStart(info: Parameters<Required<TreeProps>['onDragStart']>[0]) {
  onTreeNodeDragStart(info.event, info.node.title, DragType.text);
}

function getNodeIcon(p: any) {
  const { iconType, type } = p.data as ITreeItem;
  if (iconType) {
    return <AntdIcon type={iconType} style={{ fontSize: 20 }} />;
  }
  if (type === NodeType.dimension) {
    return <AntdIcon type="icon-weidu" style={{ color: '#156DF9' }} />;
  }
  if (type === NodeType.measure) {
    return <AntdIcon type="icon-a-Data-fileshujuwenjian1" />;
  }
  if (type === NodeType.calculation) {
    return <AntdIcon type="icon-Frame1" style={{ color: '#25CCBB' }} />;
  }

  return null;
}

const DatabaseDetail = (props: DatabaseDetailProps) => {
  const { editable, knowledge, onGoBack, onSelect } = props;
  const [loading, setLoading] = useState(false);
  const [treeData, setTreeData] = useState<ITreeItem[]>([
    {
      key: 'dimensions',
      title: '维度',
      iconType: 'icon-folder-fill',
      type: NodeType.dimension,
      children: [],
    },
    {
      key: 'measures',
      title: '指标',
      type: NodeType.measure,
      iconType: 'icon-folder-fill-1',
      children: [],
    },
    {
      key: 'calc',
      title: '计算公式',
      type: NodeType.calculation,
      iconType: 'icon-a-Calculatorjisuanqi',
      children: [],
    },
  ] as unknown as ITreeItem[]);
  const treeWrap = useRef<HTMLDivElement>(null);
  const virtualHeight = useVirtualHeight(treeWrap);

  const intl = useIntl();
  const qryTreeData = async () => {
    setLoading(true);
    const response = await queryKnowledgeBaseView({
      knowledgeBaseId: knowledge.knowledgeBaseId,
      pageSize: 1,
      pageIndex: 1,
    });
    if (!response) {
      setLoading(false);
      return;
    }
    const viewId = get(response, 'rows.0.viewId');
    const results = await Promise.all([
      qryDimensions({
        viewId,
        knowledgeBaseId: knowledge.knowledgeBaseId,
      }),
      qryMeasures({
        viewId,
        knowledgeBaseId: knowledge.knowledgeBaseId,
        vertexTypeIds: [1],
        filterCatalog: true,
      }),
      qryMeasures({
        viewId,
        knowledgeBaseId: knowledge.knowledgeBaseId,
        vertexTypeIds: [8],
      }),
    ]);
    const [resp1, resp2, resp3] = results;
    const mapper = (item: BIFieldItem, type: NodeType) => ({
      ...item,
      type,
      isLeaf: true,
      key: item.knowledgeId,
      title: item.knowledgeName,
    });
    setTreeData((prev) => [
      { ...prev[0], children: get(resp1, 'rows', []).map((item: BIFieldItem) => mapper(item, NodeType.dimension)) },
      { ...prev[1], children: get(resp2, 'rows', []).map((item: BIFieldItem) => mapper(item, NodeType.measure)) },
      { ...prev[2], children: get(resp3, 'rows', []).map((item: BIFieldItem) => mapper(item, NodeType.calculation)) },
    ]);
    setLoading(false);
  };

  useEffect(() => {
    qryTreeData();
  }, []);

  return (
    <ConfigProvider>
      <div className={commonStyles.container}>
        <div className={commonStyles.searchArea}>
          <Breadcrumb
            className={commonStyles.breadcrumb}
            style={{ marginTop: 0 }}
            items={[
              {
                key: '-1',
                title: (
                  <span>
                    <LeftOutlined />
                    {intl.formatMessage({ id: 'dialogueRecord.all' })}
                  </span>
                ),
                onClick: onGoBack,
              },
              { key: knowledge.knowledgeBaseId, title: knowledge.knowledgeBaseName },
            ]}
          />
        </div>
        <Spin spinning={loading} wrapperClassName={commonStyles.listSpinner}>
          <div ref={treeWrap} style={{ height: '100%' }}>
            <Tree.DirectoryTree
              showIcon
              defaultExpandAll
              allowDrop={() => false}
              onDragStart={onDragStart}
              selectable={false}
              height={virtualHeight}
              treeData={treeData}
              icon={getNodeIcon}
              className={commonStyles.tree}
              onClick={(e, node) => onSelect?.(node)}
              draggable={editable ? { icon: <span />, nodeDraggable } : false}
            />
          </div>
        </Spin>
      </div>
    </ConfigProvider>
  );
};

export default DatabaseDetail;
