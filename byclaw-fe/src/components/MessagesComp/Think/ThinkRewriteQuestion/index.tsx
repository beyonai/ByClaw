import { IMessageState, SSEMessageType } from '@/constants/message';
import { IMessage } from '@/typescript/message';
import useGlobal from '@/hooks/useGlobal';
import { getLocale, useIntl } from '@umijs/max';
import { Button, Col, Row, Divider } from 'antd';
import { cloneDeep, get, pick, set } from 'lodash';
import React, { useCallback, useEffect, useState } from 'react';
import ConditionItem from './ConditionItem';
import FieldItem from './FieldItem';
import useCountDown from '@/hooks/useCountDown';
import ChatLayoutCompContext from '@/components/ChatLayoutComp/hooks/useContext';

import styles from './index.module.less';
import { ComparisonMap, IConditionItem, IFieldItem, IParadigmItem, IParadigmResultItem } from './interface';
import { LayoutMode } from '@/constants/system';

type IProps = {
  messageListItemContent: { substance: any; metadata?: string; sourceAgentType?: string };
  message: IMessage;
  updateMessageListItemContent: (val: any) => void;
  messageIdx: number;
  thinkListItem?: any[];
};

export default function ThinkRewriteQuestion(props: IProps) {
  const { messageListItemContent, message, updateMessageListItemContent, messageIdx } = props;
  const intl = useIntl();
  const { EventEmitter, layoutMode } = useGlobal();

  const metadata = get(messageListItemContent, 'metadata', '');
  const sourceAgentType = get(messageListItemContent, 'sourceAgentType', '');
  const { paradigmList: defParadigmList, query } = get(messageListItemContent, 'substance', '');

  const isPreviewMode = layoutMode === LayoutMode.preview;
  const isThinkingProcess = !!props.thinkListItem;

  const { isHistoryMsg } = message;

  const [paradigmList, setParadigmList] = useState<IParadigmItem[]>(defParadigmList);
  // 是否显示按钮
  const [showSubmitBtn, switchShowSubmitBtn] = useState<boolean>(!isHistoryMsg);
  // 是否已提交
  const [hasSubmit, setHasSubmit] = useState<boolean>(false);

  const { getMessageList, totalMesageListSize } = React.useContext(ChatLayoutCompContext);

  // 最后一个问题才显示按钮
  useEffect(() => {
    if (isHistoryMsg) {
      switchShowSubmitBtn(false);
      return;
    }

    let list = message?.messageList || [];
    if (isThinkingProcess) {
      list = message.thinkList || [];
    }

    let lastIndex = list?.findLastIndex((item) => {
      return `${get(item, 'contentType')}` === `${SSEMessageType.thinkRewriteQuestion}`;
    });
    switchShowSubmitBtn(lastIndex === messageIdx);
  }, [message.messageList, message.thinkList, isThinkingProcess, messageIdx, isHistoryMsg]);

  // 同步消息中的paradigmList，用于确定时提交入参
  const updateParadigmListToMessage = useCallback(
    (paradigmList: IParadigmItem[]) => {
      const newMessageListItemContent = cloneDeep(messageListItemContent);
      set(newMessageListItemContent, 'substance.paradigmList', paradigmList);
      updateMessageListItemContent(newMessageListItemContent);
    },
    [messageListItemContent, updateMessageListItemContent]
  );

  // 切换字段/值
  const handleChange = useCallback(
    (path: string, value: string) => {
      setParadigmList((prev) => {
        const newList = cloneDeep(prev);
        set(newList, `${path}`, value);
        updateParadigmListToMessage(newList);
        return newList;
      });
    },
    [updateParadigmListToMessage]
  );

  // 删除
  const handleDelete = useCallback(
    (path: string) => {
      setParadigmList((prev) => {
        const newList = cloneDeep(prev);
        set(newList, `${path}`, null);
        updateParadigmListToMessage(newList);
        return newList;
      });
    },
    [updateParadigmListToMessage]
  );

  const sendRewriteQuestion = useCallback(
    (
      newParadigmList: {
        paradigmList: IParadigmItem[];
        query: string;
      }[]
    ) => {
      let metadataObj = {};

      try {
        metadataObj = JSON.parse(metadata);
      } catch (e) {
        console.error(e);
      }

      const payload = {
        sendProps: {
          queryQuestion: query,
          // 用于合并消息记录
          inheritQryMsgId: message.queryMsgId,
          payload: {
            actionType: 'RESUME',
            sourceAgentType,
            extParams: {
              humanInput: {
                paradigmList: newParadigmList,
                metadata: metadataObj,
              },
              query,
              language: getLocale(),
            },
          },
          msgOpt: {
            answerMsg: {
              ...message,
              messageState: IMessageState.Query,
            },
          },
        },
        sendConf: {
          onlyQuery: true,
        },
      };
      EventEmitter.emit('beyond-chat-on-send-msg', payload);
    },
    [query, message, metadata, sourceAgentType]
  );

  // 确定，中断，屏蔽按钮，重新发送继续该消息下的思考过程
  const handleSubmit = useCallback(() => {
    setHasSubmit(true);
    const newParadigmList =
      message?.messageList
        ?.filter((item) => `${item?.contentType}` === `${SSEMessageType.thinkRewriteQuestion}`)
        .map((item) => {
          const substance = get(item, 'content.substance', {});
          return {
            query: get(substance, 'query', ''),
            paradigmList: get(substance, 'paradigmList', []).map((ele: IParadigmItem) => ({
              ...ele,
              paradigmResult: ele.paradigmResult
                ?.filter((item) => !!item)
                .map((item) => {
                  const newField = item as IFieldItem;
                  if (newField.keyword) {
                    return {
                      ...pick(newField, ['keyword', 'recall']),
                      choiceKeyword: newField.choiceKeyword || newField.recall?.[0] || newField.keyword,
                    } as IFieldItem;
                  }
                  const newCondition = item as IConditionItem;
                  // 将comparison转化为ComparisonMap的key
                  const choiceComparison: any = Object.keys(ComparisonMap).find(
                    (key) => ComparisonMap[key as keyof typeof ComparisonMap] === newCondition.choiceComparison
                  ) as keyof typeof ComparisonMap;
                  return {
                    ...pick(newCondition, ['field', 'value', 'fieldRecall', 'valueRecall', 'comparison']),
                    choiceComparison: choiceComparison || newCondition.comparison,
                    choiceField: newCondition.choiceField || newCondition.fieldRecall?.[0] || newCondition.field,
                    choiceValue: newCondition.choiceValue || newCondition.valueRecall?.[0] || newCondition.value,
                  } as IConditionItem;
                }),
            })),
          };
        }) || [];
    console.log('newParadigmList', newParadigmList);
    sendRewriteQuestion(newParadigmList);
  }, [sendRewriteQuestion, message?.messageList]);

  const { remainingTime, isRunning, start, reset } = useCountDown(15000, handleSubmit);

  React.useEffect(() => {
    reset();

    const messageList = getMessageList();
    const idx = messageList.findIndex((item) => message.msgId === item.msgId);

    if (!defParadigmList || !showSubmitBtn || idx !== totalMesageListSize - 1) return;

    start();
  }, [defParadigmList, showSubmitBtn, message, totalMesageListSize]);

  if (!paradigmList) return null;

  return (
    <div className={styles.wrapper} style={{ pointerEvents: isPreviewMode ? 'none' : 'auto' }}>
      <div style={{ marginBottom: '12px' }}>
        <Row className={styles.paradigmItem}>
          <Col>原查询</Col>
          <Col>
            <div style={{ color: 'var(--beyond-color-text-tertiary)' }}>{query}</div>
          </Col>
        </Row>
      </div>
      <Divider size="small" />
      {paradigmList.map((ele, index) => {
        if (!ele.paradigmResult || !ele.paradigmResult.length || ele.paradigmResult.every((item) => !item)) return null;
        return (
          <Row key={ele.paradigmId} className={styles.paradigmItem} onClick={() => reset()}>
            <Col>{ele.paradigmName}</Col>
            <Col>
              {ele.paradigmResult.map((ele: IParadigmResultItem, innerIndex: number) => {
                if (!ele) return null;
                const path = `${index}.paradigmResult.${innerIndex}`;
                // 下拉选择 IDimensionItem
                if ((ele as IFieldItem).keyword) {
                  return (
                    <FieldItem
                      key={path}
                      path={path}
                      field={ele as IFieldItem}
                      handleChange={handleChange}
                      handleDelete={handleDelete}
                    />
                  );
                }
                return (
                  <ConditionItem
                    key={path}
                    path={path}
                    condition={ele as IConditionItem}
                    handleChange={handleChange}
                    handleDelete={handleDelete}
                  />
                );
              })}
            </Col>
          </Row>
        );
      })}
      {/* 最后一个问题 且 未提交，显示按钮 */}
      {!isPreviewMode && showSubmitBtn && !hasSubmit && (
        <div className="ub ub-pe">
          <Button
            size="small"
            type="primary"
            onClick={() => {
              reset();
              handleSubmit();
            }}
          >
            {isRunning &&
              intl.formatMessage(
                { id: 'common.countdownConfirm' },
                {
                  content: Math.ceil(remainingTime / 1000),
                }
              )}
            {!isRunning && intl.formatMessage({ id: 'common.confirm' })}
          </Button>
        </div>
      )}
    </div>
  );
}
