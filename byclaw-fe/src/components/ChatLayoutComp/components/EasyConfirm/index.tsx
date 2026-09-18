import React, { Suspense, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import classnames from 'classnames';
import { Pagination } from 'antd';
import { concat, isEmpty, merge } from 'lodash';
// import CloseOutlined from '@ant-design/icons/CloseOutlined';

import QueryInput from '@/components/QueryInput';
import lazyHandler from '@/components/MessageList/lazyHandler';
import NotSupport from '@/components/NotSupport';

import useGlobal from '@/hooks/useGlobal';
import { IFormStatus } from '@/hooks/useSseSender/agent/typescript';

import type { IAgentType } from '@/typescript/agent';
import type { IMessage } from '@/typescript/message';
import type { ISendProps } from '@/hooks/useChat';
import type { DefaultValueSchema } from '@/components/QueryInput/RichInput/types';
import { useIntl } from '@umijs/max';

import styles from './index.module.less';
import inputStyle from '@/components/ChatLayoutComp/index.module.less';
import { IMessageState } from '@/constants/message';
import {
  collectEasyConfirmItems,
  isEasyConfirmContentType,
  isPendingEasyConfirmListItem,
} from '@/components/MessagesComp/easyConfirm';
import type { EasyConfirmDescriptor } from '@/components/MessagesComp/easyConfirm';
import { notifyEasyConfirmInteraction } from '@/components/MessagesComp/withEasyConfirm';
import { chatSessionRuntimeManager } from '@/utils/chatSessionRuntimeManager';

// 普通聊天共用当前未发送草稿，跨会话及新建任务时继续编辑；不写入持久化存储。
let sharedInputDraft: DefaultValueSchema | undefined;

export const clearEasyConfirmInputDraft = () => {
  sharedInputDraft = undefined;
};

type IProps = {
  disabledInput: boolean;
  isBottom: boolean;
  cannotAt: boolean;
  disableInputDraft: boolean;
  queryInputProps: Record<string, unknown>;
  lastMsg?: IMessage;
  sessionId: string;

  /** 新建任务上传文件后保持输入框实例，避免接口返回 sessionId 导致已上传文件丢失。 */
  preserveInputOnSessionChange?: boolean;

  onSend: (param: ISendProps) => void;
  onCancel: () => void;

  myAgentType: IAgentType;
  setMyAgentType: React.Dispatch<React.SetStateAction<IAgentType>>;
  messageState?: IMessageState;
  updateMessage: (message: IMessage) => IMessage | void;
};

type IEasyConfirmCompProps = EasyConfirmDescriptor & {
  [key: string]: unknown;
};

const EasyConfirm = (props: IProps) => {
  const {
    disabledInput,
    isBottom,
    cannotAt,
    disableInputDraft,
    queryInputProps,
    lastMsg,
    sessionId,
    preserveInputOnSessionChange = false,
    onSend,
    onCancel,
    myAgentType,
    setMyAgentType,
    messageState,
    updateMessage,
  } = props;

  const { EventEmitter } = useGlobal();
  const { formatMessage } = useIntl();

  const [page, setPage] = useState<number>(1);
  const [eventList, setEventList] = useState<IEasyConfirmCompProps[]>([]);

  const currentMsgIdRef = useRef(lastMsg?.msgId || '');

  const getUUId = useCallback((easyConfirmItem: IEasyConfirmCompProps) => {
    const listItem = easyConfirmItem?.messageListItem || easyConfirmItem?.thinkListItem;
    const uuid = listItem?.uuid || '';

    return uuid;
  }, []);

  const messageItems = useMemo(() => collectEasyConfirmItems(lastMsg, updateMessage), [lastMsg, updateMessage]);
  const list = useMemo(() => {
    const itemMap = new Map<string, IEasyConfirmCompProps>();

    messageItems.forEach((item) => itemMap.set(getUUId(item), item));
    eventList.forEach((item) => {
      const uuid = getUUId(item);
      if (!uuid || itemMap.has(uuid) || item.message?.msgId !== lastMsg?.msgId) return;

      const currentItem = [...(lastMsg?.thinkList || []), ...(lastMsg?.messageList || [])].find(
        (messageListItem) => messageListItem.uuid === uuid
      );
      if (!currentItem) return;
      if (currentItem && isEasyConfirmContentType(currentItem.contentType)) {
        if (!lastMsg || !isPendingEasyConfirmListItem(lastMsg, currentItem)) return;
      }

      itemMap.set(uuid, item);
    });
    return [...itemMap.values()];
  }, [eventList, getUUId, lastMsg, messageItems]);
  const notificationStateRef = useRef({
    sessionId,
    itemKeys: new Set(list.map(getUUId).filter(Boolean)),
  });
  const compProps = useMemo(() => list[page - 1], [page, list]);
  const Comp = useMemo(() => {
    const contentType = compProps?.messageListItem?.contentType || compProps?.thinkListItem?.contentType;
    return lazyHandler.lazyComp(`${contentType}`) as React.ComponentType<any> | null;
  }, [compProps]);

  const inputDraftKey = sessionId || 'default';
  // 固定聊天对象页面不读取或覆盖普通聊天草稿。
  const inputDraft = disableInputDraft ? undefined : sharedInputDraft;

  const onInputDraftChange = useCallback(
    (draft: DefaultValueSchema) => {
      if (disableInputDraft) return;
      sharedInputDraft = !draft.text && isEmpty(draft.resourceList) ? undefined : draft;
    },
    [disableInputDraft]
  );

  const onSendWithDraftClean = useCallback(
    (param: ISendProps) => {
      // 发送后不再带入本轮正文和引用；输入组件随后回写保留的 @ 员工。
      if (!disableInputDraft) clearEasyConfirmInputDraft();
      onSend(param);
    },
    [disableInputDraft, onSend]
  );

  useEffect(() => {
    currentMsgIdRef.current = lastMsg?.msgId || '';
  }, [lastMsg?.msgId]);

  useEffect(() => {
    const getter = (list: IEasyConfirmCompProps | IEasyConfirmCompProps[]) => {
      if (!list || isEmpty(list)) return;

      setEventList((prevList) => {
        concat([], list).forEach((approvalFormItem) => {
          const uuid = getUUId(approvalFormItem);

          if (!uuid || approvalFormItem?.message?.msgId !== currentMsgIdRef.current) return;

          const target = prevList.find((item) => {
            return getUUId(item) === uuid;
          });
          if (target) {
            merge(target, approvalFormItem);
          } else {
            prevList.push(approvalFormItem);
          }
        });

        const res = prevList.filter((item) => {
          const formStatus = item?.messageListItemContent?.formStatus;
          if (!formStatus) return true;

          return ![IFormStatus.FINISH, IFormStatus.ERROR, IFormStatus.DISABLED].includes(formStatus);
        });
        return [...res];
      });
    };

    EventEmitter.on('beyond-easyconfirm-set-approvalform-item', getter);
    return () => {
      EventEmitter.off('beyond-easyconfirm-set-approvalform-item', getter);
    };
  }, []);

  useEffect(() => {
    setEventList([]);
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;

    // 用户提交交互内容后同步清除会话暂停标记，侧边栏随运行时状态立即恢复。
    chatSessionRuntimeManager.setSessionWaitingForUserInput(sessionId, list.length > 0);
  }, [list.length, sessionId]);

  useEffect(() => {
    const currentItemKeys = new Set(list.map(getUUId).filter(Boolean));
    const notificationState = notificationStateRef.current;

    // 切换会话时把已有待处理项作为基线，避免为历史消息发送通知。
    if (notificationState.sessionId !== sessionId) {
      notificationStateRef.current = { sessionId, itemKeys: currentItemKeys };
      return;
    }

    list.forEach((item) => {
      const itemKey = getUUId(item);
      if (!itemKey || notificationState.itemKeys.has(itemKey)) return;

      void notifyEasyConfirmInteraction({
        title: formatMessage({ id: 'easyConfirm.notification.title' }),
        body: formatMessage({ id: 'easyConfirm.notification.body' }),
        permissionDenied: formatMessage({ id: 'easyConfirm.notification.permissionDenied' }),
        tag: `easy-confirm-${sessionId}-${itemKey}`,
      });
    });
    notificationStateRef.current = { sessionId, itemKeys: currentItemKeys };
  }, [formatMessage, getUUId, list, sessionId]);

  useEffect(() => {
    if (page > list.length) {
      setPage(Math.max(list.length, 1));
    }
  }, [list.length, page]);

  if (isEmpty(list)) {
    return (
      <div
        className={classnames(inputStyle.queryInput, {
          [inputStyle.queryInputDisabled]: disabledInput,
        })}
        data-isbottom={isBottom}
      >
        <QueryInput
          // 每个会话使用独立的 Slate 编辑器实例，切换详情时避免沿用上一会话的默认 @ 员工节点。
          // 重挂载时从共享草稿恢复未发送的文字、@ 员工和引用。
          key={preserveInputOnSessionChange ? 'new-session-input' : inputDraftKey}
          messageState={messageState}
          onCancel={onCancel}
          myAgentType={myAgentType}
          setMyAgentType={setMyAgentType}
          isBottom={isBottom}
          cannotAt={cannotAt}
          sessionId={sessionId}
          {...queryInputProps}
          inputDraft={inputDraft}
          onInputDraftChange={onInputDraftChange}
          onSend={onSendWithDraftClean}
        />
      </div>
    );
  }

  return (
    <>
      <div className={classnames(styles.easyConfirm, 'ub ub-ver gap8')}>
        <div className="ub ub-pj" style={{ display: list.length > 1 ? 'flex' : 'none' }}>
          <div>{formatMessage({ id: 'easyConfirm.pagination.title' })}</div>
          <Pagination
            simple
            size="small"
            total={list.length}
            current={page}
            onChange={(page: number) => setPage(page)}
            pageSize={1}
          />
          {/* <CloseOutlined /> */}
        </div>
        <div className="ub-f1">
          {compProps &&
            (Comp ? (
              <Suspense>
                <Comp {...compProps} presentation="dock" key={getUUId(compProps)} renderInEasyConfirm />
              </Suspense>
            ) : (
              <NotSupport />
            ))}
        </div>
      </div>
    </>
  );
};

export default EasyConfirm;
