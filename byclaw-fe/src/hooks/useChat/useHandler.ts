import { useCallback, useEffect, useRef } from 'react';

// @ts-ignore
import { useDispatch } from '@umijs/max';
import { assign, get, isPlainObject, isString, last, set, isNil, pick } from 'lodash';

import useAppStore from '@/models/common/useAppStore';
import { IMessageState, SSEEventStatus, SSEMessageType, IObjectType } from '@/constants/message';

import { initAnswerMessage, initQueryMessage } from '@/utils/messgae';
import { getVNCUrl, resolveSandboxesInfo } from '@/utils/chat';
import { isTextContentType } from '@/utils/messgae';

import { substanceHandler } from '@/hooks/useChat/util';
import { updateExistingMessage } from '@/utils/messageItemUpdate';
import { hydrateV2RuntimeState } from '@/utils/messageV2Runtime';
import useGlobal from '@/hooks/useGlobal';

import { IMessageListItem } from '@/typescript/message';
import type { ISession } from '@/typescript/session';
import type { IOnionsProps } from '@/hooks/useChat';
import { chatSessionRuntimeManager } from '@/utils/chatSessionRuntimeManager';
import { resolveDigitalEmployeePlaceholders } from '@/utils/session';

type IProps = {
  addSession: (newSession: ISession) => void;
  setSessionId: (sessionId: string) => void;
  onSessionCreated?: (params: { sessionId: string; clientRequestId?: string; session: ISession }) => void;
};

function useHandler(props: IProps) {
  const { addSession, setSessionId, onSessionCreated } = props;

  const dispatch = useDispatch();

  const { sandboxesInfo, setSiderCollapsed } = useAppStore();
  const globalContext = useGlobal();
  const { agentInfo, sessionId: curSessionId, EventEmitter } = globalContext;

  const curAgentCodeRef = useRef<string | undefined>('');
  const curSessioneRef = useRef<string | undefined>('');

  const isV2 = (message: any) => {
    try {
      const metadata = typeof message?.metadata === 'string' ? JSON.parse(message.metadata) : message?.metadata;
      return metadata?.messageRenderVersion === 'v2';
    } catch (error) {
      return false;
    }
  };

  const appendV2Message = (newAnswerMsg: any, message: IMessageListItem, event: string) => {
    const channel = event.startsWith('reasoningLog') ? 'thinkList' : 'messageList';
    if (!get(newAnswerMsg, '_v2LastSegment')) {
      hydrateV2RuntimeState(newAnswerMsg);
    }
    const current = ((get(newAnswerMsg, channel, []) as IMessageListItem[]) || []).map((item) => ({
      ...item,
      content: { ...item.content },
    }));
    if (updateExistingMessage(current, message)) {
      set(newAnswerMsg, channel, current);
      return;
    }
    const previous = get(newAnswerMsg, '_v2LastSegment') as IMessageListItem | undefined;
    const previousChannel = get(newAnswerMsg, '_v2LastChannel');
    const incomingSeq = Number(message.seq);
    const existingSeqIndex = Number.isFinite(incomingSeq)
      ? current.findIndex((item) => Number(item.seq) === incomingSeq)
      : -1;
    const sameSegment =
      previous &&
      previousChannel === channel &&
      previous.eventType === event &&
      `${previous.contentType}` === `${message.contentType}` &&
      `${get(previous, 'content.orderId') || ''}` === `${get(message, 'content.orderId') || ''}`;
    if (existingSeqIndex >= 0 || sameSegment) {
      const targetIndex = existingSeqIndex >= 0 ? existingSeqIndex : current.length - 1;
      const target = current[targetIndex];
      if (target) {
        const oldSubstance = get(target, 'content.substance');
        const nextSubstance =
          isString(oldSubstance) && isString(get(message, 'content.substance'))
            ? `${oldSubstance}${get(message, 'content.substance')}`
            : get(message, 'content.substance');
        set(target, 'content.substance', nextSubstance);
        set(target, 'status', message.status);
        set(target, 'eventType', event);
        set(newAnswerMsg, channel, current);
        if (targetIndex === current.length - 1) {
          set(newAnswerMsg, '_v2LastSegment', target);
          set(newAnswerMsg, '_v2LastChannel', channel);
        }
        return;
      }
    }
    const nextSeq = Number(get(newAnswerMsg, '_v2NextSeq', 1));
    const nextItem = { ...message, seq: Number.isFinite(message.seq) ? message.seq : nextSeq, eventType: event };
    current.push(nextItem);
    set(newAnswerMsg, channel, current);
    set(newAnswerMsg, '_v2NextSeq', Math.max(nextSeq, Number(nextItem.seq) + 1));
    set(newAnswerMsg, '_v2LastSegment', nextItem);
    set(newAnswerMsg, '_v2LastChannel', channel);
  };

  const latchV2Metadata = (sseRes: any, newAnswerMsg: any) => {
    if (sseRes?.messageRenderVersion !== 'v2' && !`${sseRes?.metadata || ''}`.includes('messageRenderVersion')) return;
    let metadata: Record<string, unknown> = {};
    try {
      metadata =
        typeof newAnswerMsg.metadata === 'string'
          ? JSON.parse(newAnswerMsg.metadata || '{}')
          : newAnswerMsg.metadata || {};
      const incoming =
        typeof sseRes.metadata === 'string' ? JSON.parse(sseRes.metadata || '{}') : sseRes.metadata || {};
      metadata = { ...metadata, ...incoming };
    } catch (error) {
      metadata = {};
    }
    if (sseRes.messageRenderVersion === 'v2' || metadata.messageRenderVersion === 'v2') {
      newAnswerMsg.metadata = JSON.stringify({ ...metadata, messageRenderVersion: 'v2' });
    }
  };

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

      chatSessionRuntimeManager.bindSession(sseMsg.clientRequestId, newSessionId);

      if (sseMsg.event === 'sessionTitleUpdated') {
        dispatch({
          type: 'session/updateSession',
          payload: {
            ...pick(sseRes, ['sessionName', 'updateTime']),
            sessionName: resolveDigitalEmployeePlaceholders(
              sseRes.sessionName || newQueryMsg.displayText || newQueryMsg.text,
              [
                ...((newQueryMsg.resourceList || []) as any),
                { resourceId: newAnswerMsg.agentId, resourceName: newAnswerMsg.agentName },
              ]
            ),
            sessionId: newSessionId,
          },
        });
      } else {
        const resolvedSessionName = resolveDigitalEmployeePlaceholders(
          sseRes.sessionName || newQueryMsg.displayText || newQueryMsg.text,
          [
            ...((newQueryMsg.resourceList || []) as any),
            { resourceId: newAnswerMsg.agentId, resourceName: newAnswerMsg.agentName },
          ]
        );
        const createdSession = {
          ...(sseRes as ISession),
          sessionId: newSessionId,
          // createSession 事件有时仍返回输入框内部的数字员工占位符，使用本轮消息携带的资源名称兜底转换。
          ...(resolvedSessionName ? { sessionName: resolvedSessionName } : {}),
        };
        addSession(createdSession);

        if (sseMsg.event === 'createSession') {
          // 将创建事件中的会话数据一并传出，项目侧栏可直接写入缓存而无需重新请求列表。
          onSessionCreated?.({
            sessionId: newSessionId,
            clientRequestId: sseMsg.clientRequestId,
            session: createdSession,
          });
        }
      }

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
    [addSession, setSessionId, dispatch, onSessionCreated]
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
    if (sseRes.messageRenderVersion === 'v2') {
      let metadata: Record<string, unknown> = {};
      try {
        metadata =
          typeof newAnswerMsg.metadata === 'string'
            ? JSON.parse(newAnswerMsg.metadata || '{}')
            : newAnswerMsg.metadata || {};
      } catch (error) {
        metadata = {};
      }
      newAnswerMsg.metadata = JSON.stringify({ ...metadata, messageRenderVersion: 'v2' });
    }

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

    latchV2Metadata(sseRes, newAnswerMsg);

    if (isV2(newAnswerMsg) && event.startsWith('reasoningLog')) {
      set(newAnswerMsg, 'thinkDone', event === 'reasoningLogEnd');
    }

    if (!message) return onionsProps;

    if (
      isV2(newAnswerMsg) &&
      ['reasoningLogStart', 'reasoningLogDelta', 'reasoningLogEnd', 'answerStart', 'answerDelta', 'answerEnd'].includes(
        event
      )
    ) {
      if (event === 'reasoningLogStart' || event === 'reasoningLogEnd') return onionsProps;
      if (!isTextContentType(message.contentType)) return onionsProps;
      newAnswerMsg.messageState = IMessageState.Answer;
      appendV2Message(newAnswerMsg, message, event);
      return onionsProps;
    }

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

      latchV2Metadata(sseRes, newAnswerMsg);

      if (isV2(newAnswerMsg) && sseMsg.event.startsWith('reasoningLog')) {
        set(newAnswerMsg, 'thinkDone', sseMsg.event === 'reasoningLogEnd');
      }

      if (sseRes.traceId) {
        newAnswerMsg.traceId = sseRes.traceId;
        if (sseMsg.clientRequestId) {
          chatSessionRuntimeManager.updateTrace(sseMsg.clientRequestId, sseRes.traceId);
        }
      }

      if (!sseRes.message) return onionsProps;

      const { message } = sseRes;
      const { event } = sseMsg;

      if (
        isV2(newAnswerMsg) &&
        [
          'reasoningLogStart',
          'reasoningLogDelta',
          'reasoningLogEnd',
          'answerStart',
          'answerDelta',
          'answerEnd',
        ].includes(event)
      ) {
        if (event === 'reasoningLogStart' || event === 'reasoningLogEnd') return onionsProps;
        newAnswerMsg.messageState = IMessageState.Answer;
        if (isTextContentType(sseRes.message.contentType)) return onionsProps;
        if (sseRes.message) appendV2Message(newAnswerMsg, sseRes.message, event);
        return onionsProps;
      }

      // 设置回答消息状态为"正在回答"
      newAnswerMsg.messageState = IMessageState.Answer;

      const isThinkMsg = ['reasoningLogStart', 'reasoningLogDelta', 'reasoningLogEnd'].includes(event);

      const { contentType, status, content } = message;
      const { substance, orderId } = content || {};

      // 根据消息类型分别处理内容
      switch (`${contentType}`) {
        case `${SSEMessageType.appStreamResponse}`: {
          const { relatedResources, relatedQuestions } = (substance as any) || {
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
          if (isTextContentType(contentType)) return onionsProps;

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

  const answerCompletedHandler = useCallback(
    (onionsProps: IOnionsProps) => {
      const { sseMsg, newAnswerMsg } = onionsProps;
      // appStreamResponse 是一次问答的最终事件，借此通知文件/知识库等模块仅刷新一次
      if (sseMsg?.event === 'appStreamResponse') {
        EventEmitter.emit('chat-answer-completed', {
          sessionId: newAnswerMsg?.sessionId,
          messageId: newAnswerMsg?.messageId,
        });
        EventEmitter.emit('beyond-resourceList-resourceType-reload', {
          resourceType: 'SKILL',
          resetSkillFilters: false,
          skipResourceCenterRefresh: true,
        });
      }
      return onionsProps;
    },
    [EventEmitter]
  );

  const browserHandler = useCallback(
    (onionsProps: IOnionsProps) => {
      const { sseRes, newAnswerMsg } = onionsProps;
      if (newAnswerMsg?.sessionId !== curSessioneRef.current) return onionsProps;
      if (!sseRes) return onionsProps;

      const isByCliCommand = (inputBody: unknown) => {
        let body: Record<string, unknown>;
        if (typeof inputBody === 'string') {
          try {
            body = JSON.parse(inputBody);
          } catch (error) {
            return false;
          }
        } else {
          body = inputBody as Record<string, unknown>;
        }
        if ('command' in body && typeof body?.command === 'string') {
          return body?.command?.startsWith('bycli');
        }
        if ('read' in body && typeof body?.path === 'string') {
          return body?.path?.toLocaleLowerCase()?.includes('/bycli/skill.md');
        }
        return false;
      };
      const isBrowserToolName = (toolName: string) => {
        return toolName.includes('jarvis_run_flow') || toolName.includes('browser');
      };

      if (`${SSEMessageType.toolCall}` === `${sseRes?.message?.contentType}`) {
        const substance = get(sseRes, 'message.content.substance');
        try {
          let input: unknown;
          let title: string;
          let body: { title: string; input: unknown };
          if (typeof substance === 'string') {
            body = JSON.parse(substance);
          } else {
            body = substance as { title: string; input: unknown };
          }
          ({ title, input } = body);
          if (!isBrowserToolName(title) && !isByCliCommand(input)) {
            return onionsProps;
          }
        } catch (error) {
          return onionsProps;
        }
      } else if ([`${SSEMessageType.jsonBlock}`].includes(`${sseRes?.message?.contentType}`)) {
        const jsonStr = get(sseRes, 'message.content.substance.json', '');
        try {
          const jsonObj = JSON.parse(jsonStr);
          if (!isByCliCommand(jsonObj)) return onionsProps;
        } catch (error) {
          return onionsProps;
        }
      } else if ([`${SSEMessageType.thinkStatusTitle}`].includes(`${sseRes?.message?.contentType}`)) {
        const toolTitle = get(sseRes, 'message.content.substance.title') || '';
        if (sseRes?.message?.objectType !== IObjectType.toolCall || !isBrowserToolName(toolTitle)) {
          return onionsProps;
        }
      } else {
        return onionsProps;
      }

      void resolveSandboxesInfo(useAppStore.getState().sandboxesInfo).then((resolvedSandboxesInfo) => {
        if (!resolvedSandboxesInfo?.sandboxId) return;
        const url = getVNCUrl(resolvedSandboxesInfo);

        setSiderCollapsed(true);
        EventEmitter.emit('beyond-main-driver-open-type', {
          drawerType: 'vnc',
          canClose: true,
          width: '50vw',
        });
        EventEmitter.emit('beyond-main-driver-message', {
          url,
        });
      });

      return onionsProps;
    },
    [sandboxesInfo]
  );

  return {
    sessionInfoHandler,
    messageIdHandler,
    queryMessageIdHandler,
    messageHandler,
    resComIdsHandler,
    textHandler,
    rewriteQuestionHandler,
    browserHandler,
    answerCompletedHandler,
  };
}

export default useHandler;
