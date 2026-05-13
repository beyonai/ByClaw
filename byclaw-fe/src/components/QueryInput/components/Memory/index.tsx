import React, { useEffect, useLayoutEffect } from 'react';
import { Popover, Button, Tabs } from 'antd';
import { clamp, debounce } from 'lodash';
import { useIntl } from '@umijs/max';

import AntdIcon from '@/components/AntdIcon';
import MemoryComp, { IMemoryItem } from './components/MemoryComp';

import styles from './index.module.less';
import useGlobal from '@/hooks/useGlobal';

function PopoverContent({ onClose }: { onClose: () => void }) {
  const [activeTab, setActiveTab] = React.useState('memory');
  const intl = useIntl();
  const { EventEmitter } = useGlobal();

  const onSetInputValue = React.useCallback(
    (item: IMemoryItem) => {
      onClose();
      EventEmitter.emit('beyond-chat-on-send-msg', {
        sendProps: {
          queryQuestion: item.title,
          payload: {
            extParams: {
              resComId: `${item.resComId}`,
              taskType: 'FIXMEMORY',
            },
          },
          msgOpt: {},
        },
      });
    },
    [onClose]
  );

  return (
    <div className={styles.popoverContent}>
      <Tabs activeKey={activeTab} onChange={setActiveTab}>
        <Tabs.TabPane key="memory" tab={intl.formatMessage({ id: 'memory.enhanceMemoryTask' })}>
          <MemoryComp onSelect={onSetInputValue} />
        </Tabs.TabPane>
      </Tabs>
    </div>
  );
}

function Memory() {
  const [popoverOpen, setPopoverOpen] = React.useState(false);
  const [contentWidth, setContentWidth] = React.useState(0);
  const [offsetLeft, setOffsetLeft] = React.useState(0);

  const onClose = React.useCallback(() => {
    setPopoverOpen(false);
  }, []);

  const getLayout = React.useCallback(
    debounce(
      () => {
        const queryInputWrapper = document.getElementById('queryInputWrapper');
        const chatWrapper = document.getElementById('chat_wrapper');

        if (queryInputWrapper && chatWrapper) {
          setContentWidth(queryInputWrapper.clientWidth || 0);
          // 计算 queryInputWrapper 相对于 chat_wrapper 的 offset
          const offsetL = queryInputWrapper.getBoundingClientRect().left - chatWrapper?.getBoundingClientRect().left;

          setOffsetLeft(offsetL);
        }
      },
      100,
      {
        maxWait: 500,
      }
    ),
    []
  );

  useEffect(() => {
    window.addEventListener('resize', getLayout);
    getLayout();
    return () => {
      window.removeEventListener('resize', getLayout);
    };
  }, []);

  useLayoutEffect(() => {
    if (popoverOpen) {
      getLayout();
    }
  }, [popoverOpen]);

  return (
    <Popover
      open={popoverOpen}
      content={
        <div style={{ width: clamp(contentWidth - 20, 0, 810) }}>
          <PopoverContent onClose={onClose} />
        </div>
      }
      getPopupContainer={() => document.getElementById('chat_wrapper') || window.document.body}
      trigger="click"
      placement="bottom"
      arrow={false}
      rootClassName={styles.popoverRoot}
      styles={{
        root: {
          left: offsetLeft,
        },
      }}
      align={{
        offset: [0, 15],
      }}
      onOpenChange={(open) => {
        setPopoverOpen(open);
      }}
    >
      <Button aria-label="memory-task" icon={<AntdIcon type="icon-changyongwenti" />} />
    </Popover>
  );
}

export default React.memo(Memory);
