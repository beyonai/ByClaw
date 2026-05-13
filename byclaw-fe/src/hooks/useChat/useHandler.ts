import { useCallback, useEffect, useRef } from 'react';

// @ts-ignore
import { useDispatch } from '@umijs/max';
import { assign, get, isPlainObject, isString, last, set, isNil, pick } from 'lodash';

import { IMessageState, SSEEventStatus, SSEMessageType } from '@/constants/message';
import type { IOnionsProps } from '@/hooks/useChat';
import useGlobal from '@/hooks/useGlobal';
import { IMessageListItem } from '@/typescript/message';
import type { ISession } from '@/typescript/session';
import { initAnswerMessage, initQueryMessage } from '@/utils/messgae';
import { substanceHandler } from '@/hooks/useChat/util';
import { isTextContentType } from '@/utils/messgae';

type IProps = {
  addSession: (newSession: ISession) => void;
  setSessionId: (sessionId: string) => void;
};

function useHandler(props: IProps) {
  const { addSession, setSessionId } = props;

  const dispatch = useDispatch();

  const globalContext = useGlobal();
  const { agentInfo, sessionId: curSessionId } = globalContext;

  const curAgentCodeRef = useRef<string | undefined>('');
  const curSessioneRef = useRef<string | undefined>('');

  useEffect(() => {
    curAgentCodeRef.current = agentInfo?.resourceCode;
  }, [agentInfo]);

  useEffect(() => {
    curSessioneRef.current = curSessionId;
  }, [curSessionId]);

  const sessionInfoHandler = useCallback(
    (onionsProps: IOnionsProps) => {
      const { sseRes, sseMsg, newQueryMsg, newAnswerMsg } = onionsProps;

      if (!sseRes.sessionId) return onionsProps;

      const newSessionId = `${sseRes.sessionId}`;

      if (sseMsg.event === 'createSession' && Array.isArray(sseRes.sessionExts) && sseRes.sessionExts.length > 0) {
        dispatch({
          type: 'session/saveExtParamsBySessionId',
          payload: {
            sessionId: newSessionId,
            extParams: sseRes.sessionExts.reduce((acc: Record<string, any>, item) => {
              acc[item.extParamCode] = item.extParamValue;
              return acc;
            }, {}),
          },
        });
      }

      addSession({
        ...(sseRes as ISession),
        sessionId: newSessionId,
      });

      if (!curSessioneRef.current) {
        // 设置当前会话ID
        setSessionId(newSessionId);

        // 避免mySessionListMap还没插入newSessionId信息
        setTimeout(() => {
          // 更新会话ID
          globalContext.setSessionId?.(newSessionId);
        }, 100);
      }

      newQueryMsg.sessionId = newSessionId;
      newAnswerMsg.sessionId = newSessionId;

      return onionsProps;
    },
    [addSession, setSessionId, dispatch]
  );

  const messageIdHandler = useCallback((onionsProps: IOnionsProps) => {
    const { sseRes, newAnswerMsg, sseMsg, newQueryMsg } = onionsProps;

    // 任意带 messageId 的包都可能带完整 metadata（不仅 initialization）；需在后续逻辑前写入
    if (!isNil(sseRes.metadata) && sseRes.metadata !== '') {
      newAnswerMsg.metadata = sseRes.metadata;
    }

    if (!sseRes.messageId) return onionsProps;

    const { event } = sseMsg;

    if (event === 'initMessage') {
      // 暂只支持当前的问答信息
      if (`${newAnswerMsg.messageId}` === `${sseRes.messageId}`) {
        assign(newAnswerMsg, initAnswerMessage(newAnswerMsg));
        return onionsProps;
      }
      if (`${newQueryMsg.messageId}` === `${sseRes.messageId}`) {
        assign(newQueryMsg, initQueryMessage(newQueryMsg));
        return onionsProps;
      }
    }

    newAnswerMsg.messageId = `${sseRes.messageId}`;

    return onionsProps;
  }, []);

  const queryMessageIdHandler = useCallback((onionsProps: IOnionsProps) => {
    const { sseRes, newQueryMsg } = onionsProps;

    if (!sseRes.queryMessageId) return onionsProps;

    newQueryMsg.messageId = `${sseRes.queryMessageId}`;

    return onionsProps;
  }, []);

  const resComIdsHandler = useCallback((onionsProps: IOnionsProps) => {
    const { sseRes, newAnswerMsg } = onionsProps;

    if (!sseRes.resComIds) return onionsProps;

    newAnswerMsg.resComIds = sseRes.resComIds;

    return onionsProps;
  }, []);

  const textHandler = useCallback((onionsProps: IOnionsProps) => {
    const { sseRes, sseMsg, newAnswerMsg } = onionsProps;
    const { message } = sseRes;
    const { event } = sseMsg;

    if (!message) return onionsProps;

    const isThinkMsg = ['reasoningLogStart', 'reasoningLogDelta', 'reasoningLogEnd'].includes(event);

    let listName = 'messageList';
    if (isThinkMsg) {
      listName = 'thinkList';
    }

    const list: Partial<IMessageListItem>[] = get(newAnswerMsg, listName, []);
    const targetMessageItem = last<Partial<IMessageListItem>>(list);

    if (!isTextContentType(message.contentType)) return onionsProps;

    const newMessageItem = substanceHandler(message, targetMessageItem, newAnswerMsg?.metadata);

    if (newMessageItem) {
      list.push(newMessageItem);    
    }

    // 思考过程结束
    if (isThinkMsg && message.status === SSEEventStatus.done) {
      set(newAnswerMsg, 'thinkDone', true);
    }

    // 更新消息列表
    set(newAnswerMsg, listName, list);

    return onionsProps;
  }, []);

  const messageHandler = useCallback(
    (onionsProps: IOnionsProps) => {
      const { sseRes, sseMsg, newAnswerMsg } = onionsProps;

      if (!sseRes.message) return onionsProps;

      const { message } = sseRes;
      const { event } = sseMsg;

      // 设置回答消息状态为"正在回答"
      newAnswerMsg.messageState = IMessageState.Answer;

      const isThinkMsg = ['reasoningLogStart', 'reasoningLogDelta', 'reasoningLogEnd'].includes(event);

      const { contentType, status, content } = message;
      const { substance, orderId } = content || {};

      // 根据消息类型分别处理内容
      switch (`${contentType}`) {
        case `${SSEMessageType.appStreamResponse}`: {
          const { relatedResources, relatedQuestions } = substance as any || {
            relatedResources: [],
            relatedQuestions: [],
          };
          // 处理资源类型消息，设置资源来源
          newAnswerMsg.resourceFrom = relatedResources;
          newAnswerMsg.relatedQuestions = relatedQuestions;
          break;
        }
        case `${SSEMessageType.error}`: {
          // 处理错误类型消息，设置查询消息为错误状态
          set(newAnswerMsg, 'messageState', IMessageState.Error);
          set(newAnswerMsg, 'messageTip', get(substance, 'msg', ''));
          set(newAnswerMsg, 'traceback', get(substance, 'traceback', ''));

          break;
        }
        default: {
          // 配合 textHandler 使用
          if (isTextContentType(contentType))  return onionsProps;

          let listName = 'messageList';
          if (isThinkMsg) {
            listName = 'thinkList';
          }

          const list: IMessageListItem[] = get(newAnswerMsg, listName, []);

          let targetMessageItem = last<IMessageListItem>(list);
          if (orderId) {
            targetMessageItem = list.find((item) => item?.content?.orderId === orderId);
          }

          // 与上一条消息拼接
          if (targetMessageItem) {
            if (targetMessageItem?.status !== SSEEventStatus.done) {
              if (`${targetMessageItem?.contentType}` === `${contentType}`) {
                const targetMessageItemContent = get(targetMessageItem, 'content') || {};
                const targetMessageItemSubstance = get(targetMessageItemContent, 'substance');

                // 特殊代码
                if ([`${SSEMessageType.thinkTitle}`].includes(`${contentType}`)) {
                  if (targetMessageItemSubstance === substance) {
                    return onionsProps;
                  }
                }

                let newSubstance;

                if (isString(targetMessageItemSubstance)) {
                  newSubstance = `${targetMessageItemSubstance}${substance}`;
                }
                if (Array.isArray(targetMessageItemSubstance)) {
                  newSubstance = targetMessageItemSubstance.concat(substance);
                }
                if (
                  isPlainObject(targetMessageItemSubstance) &&
                  !isNil(targetMessageItemSubstance) &&
                  isPlainObject(substance) &&
                  !isNil(substance)
                ) {
                  newSubstance = {
                    ...targetMessageItemSubstance,
                    ...substance,
                  };
                }

                set(targetMessageItem, 'content', {
                  ...targetMessageItemContent,
                  ...pick(content, ['stepId', 'metadata', 'stepTaskId', 'orderId', 'parentOrderId']),
                  substance: newSubstance,
                });

                // 状态已完成消息
                set(targetMessageItem, 'status', status);
              } else {
                set(targetMessageItem, 'status', SSEEventStatus.done);
                list.push(message); // 注意：此处可能需要类型转换
              }
            } else {
              list.push(message); // 注意：此处可能需要类型转换
            }
          } else {
            list.push(message); // 注意：此处可能需要类型转换
          }

          // 思考过程结束
          if (isThinkMsg && status === SSEEventStatus.done) {
            set(newAnswerMsg, 'thinkDone', true);
          }

          // 更新消息列表
          set(newAnswerMsg, listName, list);
        }
      }

      return onionsProps;
    },
    [globalContext.sessionId, dispatch]
  );

  const rewriteQuestionHandler = useCallback((onionsProps: IOnionsProps) => {
    const { sseRes, newAnswerMsg } = onionsProps;

    if (!sseRes) return onionsProps;

    const contentType = get(sseRes, 'message.contentType');
    if (`${contentType}` !== `${SSEMessageType.rewriteQuestion}`) {
      return onionsProps;
    }

    const resultObjectStr = (get(sseRes, 'message.content.substance') || '') as string;
    let resultObject: any;
    try {
      resultObject = JSON.parse(resultObjectStr);
    } catch (e) {
      console.error(e);
    }
    if (!resultObject) return onionsProps;

    newAnswerMsg.isHide = true; // sse最后的appStreamResponse才能拿到messageId去删除消息，所以只能先隐藏
    newAnswerMsg.shouldDelete = true;
    // newAnswerMsg.cancelSSE?.();
    return onionsProps;
  }, []);

  return {
    sessionInfoHandler,
    messageIdHandler,
    queryMessageIdHandler,
    messageHandler,
    resComIdsHandler,
    textHandler,
    rewriteQuestionHandler
  };
}

export default useHandler;
