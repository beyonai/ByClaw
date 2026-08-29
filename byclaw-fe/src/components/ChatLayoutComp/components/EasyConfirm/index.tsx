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

const inputDraftMap = new Map<string, DefaultValueSchema>();

export const clearEasyConfirmInputDraft = (sessionId?: string | number) => {
  if (sessionId === undefined || sessionId === null || `${sessionId}` === '') {
    inputDraftMap.clear();
    return;
  }
  inputDraftMap.delete(`${sessionId}`);
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
  const pendingNewSessionDraftRef = useRef(false);

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
  const compProps = useMemo(() => list[page - 1], [page, list]);
  const Comp = useMemo(() => {
    const contentType = compProps?.messageListItem?.contentType || compProps?.thinkListItem?.contentType;
    return lazyHandler.lazyComp(`${contentType}`) as React.ComponentType<any> | null;
  }, [compProps]);

  const inputDraftKey = sessionId || 'default';
  if (!disableInputDraft && sessionId && pendingNewSessionDraftRef.current) {
    // 新会话从 default 临时键切到真实 sessionId 时同步迁移草稿，避免输入框重挂载后只剩当前员工。
    const pendingDraft = inputDraftMap.get('default');
    if (pendingDraft && !inputDraftMap.has(inputDraftKey)) {
      inputDraftMap.set(inputDraftKey, pendingDraft);
    }
    inputDraftMap.delete('default');
    pendingNewSessionDraftRef.current = false;
  }
  // 固定聊天对象页面不读取共享草稿，避免把其他会话场景的文字、@ 员工或 # 引用带进来。
  const inputDraft = disableInputDraft ? undefined : inputDraftMap.get(inputDraftKey);

  const onInputDraftChange = useCallback(
    (draft: DefaultValueSchema) => {
      if (disableInputDraft) {
        return;
      }
      if (!draft.text && isEmpty(draft.resourceList)) {
        inputDraftMap.delete(inputDraftKey);
        return;
      }

      inputDraftMap.set(inputDraftKey, draft);
    },
    [disableInputDraft, inputDraftKey]
  );

  const onSendWithDraftClean = useCallback(
    (param: ISendProps) => {
      // 无 sessionId 时发送会创建新会话，标记后续需要把 default 草稿迁移到真实会话。
      pendingNewSessionDraftRef.current = !disableInputDraft && inputDraftKey === 'default';
      inputDraftMap.delete(inputDraftKey);
      onSend(param);
    },
    [disableInputDraft, inputDraftKey, onSend]
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
          // 会话草稿仍由 inputDraftMap 按 sessionId 恢复，不会丢失用户已输入内容。
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
