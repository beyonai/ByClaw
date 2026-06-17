import React, { useCallback, useEffect } from 'react';
// @ts-ignore
import { DownOutlined, UpOutlined } from '@ant-design/icons';
// @ts-ignore
import ThinkNewRootTitle from '@/components/MessagesComp/Think/ThinkRootTitle/components/ThinkNewRootTitle';
import { IMessageState } from '@/constants/message';
import { transformList } from './util';
import { useIntl } from '@umijs/max';
import classnames from 'classnames';
import { isEmpty, isNil, set, size } from 'lodash';
import useGlobal from '@/hooks/useGlobal';

import type { IMessage } from '@/typescript/message';
import type { TreeNode } from './typescript';

import styles from './index.module.less';

type IProps = {
  msg: IMessage;
  updateMessage: any;
};

function ThinkingProcessRender(props: IProps) {
  const { msg, updateMessage } = props;
  const { thinkList, thinkCollapse, resourceFrom = [], msgId, messageState, messageId, isHistoryMsg } = msg;

  const intl = useIntl();
  const { EventEmitter } = useGlobal();

  const [myThinkCollapse, setMyThinkCollapse] = React.useState(thinkCollapse);
  const [transformedList, setTransformedList] = React.useState<TreeNode[]>([]);

  const transformedListRef = React.useRef<string>('');

  const isThinkDone = ![IMessageState.Answer, IMessageState.Query].includes(messageState) || isHistoryMsg;

  const updateMessageList = useCallback(
    (path: string, val: any) => {
      const newMsg = { ...msg };
      set(newMsg, `thinkList.${path}`, val);
      updateMessage(newMsg);
    },
    [updateMessage]
  );

  const updateMessageListItemContent = React.useCallback(
    (path: string, val: any) => {
      updateMessageList(`${path}`, val);
    },
    [updateMessageList]
  );

  useEffect(() => {
    if (!thinkList || isEmpty(thinkList)) {
      return; // 返回空数组或其他默认值
    }

    const l = transformList(thinkList, !!isThinkDone, messageId);

    let lStr = '';
    try {
      lStr = JSON.stringify(l);
    } catch (e) {
      console.error(e);
    }

    if (lStr !== transformedListRef.current) {
      transformedListRef.current = lStr;
      setTransformedList(l);
    }
  }, [JSON.stringify(thinkList), isThinkDone, messageId]);

  useEffect(() => {
    setMyThinkCollapse(isThinkDone);
  }, [isThinkDone]);

  if ((isNil(thinkList) || isEmpty(thinkList)) && isEmpty(resourceFrom)) return null;

  return (
    <>
      <p style={{ color: '##707680' }}>
        {isThinkDone && (
          <span
            className="ub ub-ac pointer"
            onClick={() => {
              setMyThinkCollapse((prevState) => {
                updateMessage({
                  ...msg,
                  thinkCollapse: !prevState,
                });

                return !prevState;
              });
            }}
          >
            <span style={{ color: 'var(--beyond-color-text-tertiary)' }}>
              {intl.formatMessage({ id: 'thinkingProcess.done' })}
            </span>
            {!myThinkCollapse && (
              <UpOutlined
                style={{ fontSize: '12px', marginLeft: '12px', color: 'var(--beyond-color-text-tertiary)' }}
              />
            )}
            {myThinkCollapse && (
              <DownOutlined
                style={{ fontSize: '12px', marginLeft: '12px', color: 'var(--beyond-color-text-tertiary)' }}
              />
            )}
          </span>
        )}
        {!isThinkDone && (
          <span className={classnames(styles.highlightText, styles.autoHighlight)}>
            {intl.formatMessage({ id: 'thinkingProcess.thinking' })}
          </span>
        )}
      </p>
      {!myThinkCollapse && (
        <div className={styles.thinkingProcessWrapper} id={`thinkingProcessWrapper_${msgId}`}>
          {!isEmpty(resourceFrom) && (
            <span
              className={classnames(styles.thinkingProcessResourceList, 'pointer')}
              onClick={() => {
                EventEmitter.emit('beyond-show-sourceFrom', msgId);
              }}
            >
              {intl.formatMessage({ id: 'thinkingProcess.foundReferences' }, { count: size(resourceFrom) })}
            </span>
          )}
          {transformedList.map((item, index) => {
            const treeNode = item as TreeNode; // 明确类型断言
            return (
              <ThinkNewRootTitle
                key={`${msgId}_message_${index}`}
                treeNode={treeNode}
                message={msg}
                updateMessageListItemContent={updateMessageListItemContent}
              />
            );
          })}
        </div>
      )}
    </>
  );
}

export default ThinkingProcessRender;
