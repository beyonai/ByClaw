import React, { useState } from 'react';
import { Button, List, Popconfirm, Skeleton, Divider } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import InfiniteScroll from 'react-infinite-scroll-component';

import styles from './index.module.less';

type IMemoryItem = any;

function Collect({ onSelect }: { onSelect?: (text: string) => void }) {
  const [fixedMemoryList] = React.useState<IMemoryItem[]>([]);
  const [total] = useState(0);

  return (
    <div className="full-height full-width" id="memoryComp_scrollableDiv">
      <InfiniteScroll
        dataLength={fixedMemoryList.length}
        next={() => {}}
        hasMore={fixedMemoryList.length < total}
        loader={<Skeleton avatar paragraph={{ rows: 1 }} active />}
        endMessage={
          <Divider plain>
            <span>It is all, nothing more</span>
          </Divider>
        }
        scrollableTarget="memoryComp_scrollableDiv"
      >
        <List
          size="small"
          itemLayout="horizontal"
          dataSource={fixedMemoryList}
          className={styles.list}
          renderItem={(item) => {
            return (
              <List.Item
                actions={[
                  <Popconfirm
                    key={`delete-${item.title}`}
                    title="确定要删除吗？"
                    onConfirm={(e) => {
                      e?.stopPropagation();
                    }}
                  >
                    <Button
                      danger
                      icon={<DeleteOutlined />}
                      size="small"
                      onClick={(e) => {
                        e?.stopPropagation();
                      }}
                    />
                  </Popconfirm>,
                ]}
                className={styles.listItem}
                onClick={() => {
                  onSelect?.(item.title);
                }}
                style={{
                  cursor: onSelect ? 'pointer' : 'default',
                }}
              >
                <List.Item.Meta
                  // avatar={<AntdIcon type="icon-renwujiyi" style={{ color: 'var(--beyond-color-primary)' }} />}
                  title={<p>{item.title}</p>}
                />
              </List.Item>
            );
          }}
        />
      </InfiniteScroll>
    </div>
  );
}

export default Collect;
