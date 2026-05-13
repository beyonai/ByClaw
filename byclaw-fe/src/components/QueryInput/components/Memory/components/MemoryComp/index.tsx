import React, { useEffect, useState } from 'react';
import { Button, List, Popconfirm, Skeleton, message } from 'antd';
import { size } from 'lodash';
import AntdIcon from '@/components/AntdIcon';
import { DeleteOutlined } from '@ant-design/icons';
import InfiniteScroll from 'react-infinite-scroll-component';
import { ResourceTypeMap } from '@/constants/resource';
import { useIntl } from '@umijs/max';

import { selectFixedMemoryByQo, removeFixedMemory } from '@/service/memory';

import type { IRelResource } from '@/components/ChatLayoutComp/components/MultiChoices/components/Memory';

import styles from './index.module.less';

export type IMemoryItem = {
  fixedMemorySteps: {
    question: string;
    relResources: IRelResource[];
  }[];
  messageTaskDto: any;
  resComId: number;
  tags: string[];
  title: string;
};

function Memory({ onSelect }: { onSelect?: (item: IMemoryItem) => void }) {
  const intl = useIntl();
  const [loading, setLoading] = useState(false);
  const [fixedMemoryList, setFixedMemoryList] = React.useState<IMemoryItem[]>([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);

  const mySelectFixedMemoryByQo = () => {
    if (loading) {
      return Promise.resolve();
    }

    setLoading(true);
    return selectFixedMemoryByQo({
      pageNum: page + 1,
      pageSize: 30,
    })
      .then((res) => {
        const { list, pageNum, total } = res;
        setFixedMemoryList((prevList) => {
          return [...prevList, ...(list || [])];
        });
        setTotal(total || 0);
        setPage(pageNum || 0);
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    mySelectFixedMemoryByQo();
  }, []);

  return (
    <div
      className="full-height full-width overflow-auto"
      id="memoryComp_scrollableDiv"
      style={{ maxHeight: '300px', minHeight: '150px' }}
    >
      <InfiniteScroll
        dataLength={fixedMemoryList.length}
        next={mySelectFixedMemoryByQo}
        hasMore={fixedMemoryList.length < total}
        loader={<Skeleton avatar paragraph={{ rows: 1 }} active />}
        scrollableTarget="memoryComp_scrollableDiv"
      >
        <List
          size="small"
          itemLayout="horizontal"
          dataSource={fixedMemoryList}
          className={styles.list}
          renderItem={(item) => {
            const { fixedMemorySteps } = item;

            let agentNum = 0;
            let toolNum = 0;
            let kbNum = 0;

            fixedMemorySteps.forEach((step) => {
              step.relResources.forEach((resource) => {
                if (resource.resourceBizType === ResourceTypeMap.digitalEmployee) {
                  agentNum += 1;
                }
                if (resource.resourceBizType === ResourceTypeMap.TOOL) {
                  toolNum += 1;
                }
                if (
                  resource.resourceBizType === ResourceTypeMap.knowledgeBase ||
                  resource.resourceBizType === ResourceTypeMap.knowledgeBaseQa
                ) {
                  kbNum += 1;
                }
              });
            });

            return (
              <List.Item
                actions={[
                  <Popconfirm
                    key={`delete-${item.resComId}`}
                    title={intl.formatMessage(
                      { id: 'common.deleteConfirm' },
                      { content: intl.formatMessage({ id: 'memory.task' }) }
                    )}
                    onConfirm={(e) => {
                      e?.stopPropagation();
                      removeFixedMemory({
                        resComId: item.resComId,
                      })
                        .then(() => {
                          setFixedMemoryList(fixedMemoryList.filter((listItem) => listItem.resComId !== item.resComId));
                          setTotal(total - 1);
                        })
                        .catch(() => {
                          message.error(intl.formatMessage({ id: 'common.deleteFail' }));
                        });
                    }}
                    onCancel={(e) => {
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
                  onSelect?.(item);
                }}
                style={{
                  cursor: onSelect ? 'pointer' : 'default',
                }}
              >
                <List.Item.Meta
                  avatar={<AntdIcon type="icon-renwujiyi" style={{ color: 'var(--beyond-color-primary)' }} />}
                  title={<p>{item.title}</p>}
                  description={intl.formatMessage(
                    { id: 'memory.stepsIncludeInfo' },
                    { count: size(fixedMemorySteps), agentNum, toolNum, kbNum }
                  )}
                />
              </List.Item>
            );
          }}
        />
      </InfiniteScroll>
    </div>
  );
}

export default Memory;
