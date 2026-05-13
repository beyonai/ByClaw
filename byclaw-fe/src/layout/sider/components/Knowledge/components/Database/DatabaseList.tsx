import React from 'react';
import { List, Typography } from 'antd';
import useKnowledge from '@/hooks/useKnowledge';
import withDrag, { DragType } from '@/components/QueryInput/withDrag';
import commonStyles from '../common.module.less';
import { IDatabaseItem } from './types';
import AntdIcon from '@/components/AntdIcon';
import EmptyTips from '@/components/EmptyTips';

const { Paragraph } = Typography;

const Draggable = withDrag(DragType.database);

interface Props {
  onDrilldown: (item: IDatabaseItem) => void;
  onSelect?: (node: IDatabaseItem) => void;
}

const DatabaseList = ({ onSelect, onDrilldown }: Props) => {
  const container = React.useRef<HTMLDivElement>(null);
  const { loading, knowledgeBaseList } = useKnowledge({ setDefaultSelected: false });

  return (
    <div ref={container} className={commonStyles.container}>
      <List
        split={false}
        loading={loading}
        rowKey="knowledgeBaseId"
        className={commonStyles.list}
        dataSource={knowledgeBaseList || []}
        style={{ overflow: 'auto', height: '100%' }}
        locale={{
          emptyText: (
            <EmptyTips
              icon="📂"
              title="当前还没有创建数据库呢～"
              description="你可新建或导入数据库，让数据查询、统计和复用更高效便捷吧！"
            />
          ),
        }}
        renderItem={(item) => {
          return (
            <Draggable key={item.knowledgeBaseId} data={item}>
              <List.Item
                key={item.knowledgeBaseId}
                actions={(() => {
                  return [
                    <AntdIcon
                      key="icon-a-Folder-openwenjianjia-kai"
                      type="icon-a-Folder-openwenjianjia-kai"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDrilldown(item);
                      }}
                    />,
                  ];
                })()}
                onClick={() => {
                  onSelect?.(item);
                }}
              >
                <List.Item.Meta
                  avatar={<AntdIcon type="icon-shujukutubiao" />}
                  title={
                    <div className="textEllipsis" title={item.knowledgeBaseName}>
                      {item.knowledgeBaseName}
                    </div>
                  }
                  description={
                    <Paragraph ellipsis={{ rows: 3 }} style={{ marginBottom: 0 }}>
                      {item.knowledgeBaseComment}
                    </Paragraph>
                  }
                />
              </List.Item>
            </Draggable>
          );
        }}
      />
    </div>
  );
};

export default DatabaseList;
