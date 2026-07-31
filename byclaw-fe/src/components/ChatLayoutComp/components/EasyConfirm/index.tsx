import React, { Suspense, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import classnames from 'classnames';
import { Pagination, theme } from 'antd';
import { concat, isEmpty, merge } from 'lodash';
// import CloseOutlined from '@ant-design/icons/CloseOutlined';

import QueryInput from '@/components/QueryInput';
import lazyHandler from '@/components/MessageList/lazyHandler';
import NotSupport from '@/components/NotSupport';

import useGlobal from '@/hooks/useGlobal';
import { IFormStatus } from '@/hooks/useSseSender/agent/typescript';

import type { IAgentType } from '@/typescript/agent';
import type { IMessage, IMessageListItem } from '@/typescript/message';
import type { ISendProps } from '@/hooks/useChat';
import type { DefaultValueSchema } from '@/components/QueryInput/RichInput/types';
import { useIntl } from '@umijs/max';

import styles from './index.module.less';
import inputStyle from '@/components/ChatLayoutComp/index.module.less';
import { IMessageState } from '@/constants/message';

const inputDraftMap = new Map<string, DefaultValueSchema>();

export const clearEasyConfirmInputDraft = () => {
  inputDraftMap.clear();
};

type IProps = {
  disabledInput: boolean;
  isBottom: boolean;
  cannotAt: boolean;
  queryInputProps: Record<string, unknown>;
  lastMsg?: IMessage;
  sessionId: string;

  onSend: (param: ISendProps) => void;
  onCancel: () => void;

  myAgentType: IAgentType;
  setMyAgentType: React.Dispatch<React.SetStateAction<IAgentType>>;
  messageState?: IMessageState;
};

type IEasyConfirmCompProps = {
  message: IMessage;
  messageListItemContent: IMessageListItem['content'];
  messageListItem?: IMessageListItem;
  thinkListItem?: IMessageListItem;
  [key: string]: unknown;
};

const EasyConfirm = (props: IProps) => {
  const {
    disabledInput,
    isBottom,
    cannotAt,
    queryInputProps,
    lastMsg,
    sessionId,
    onSend,
    onCancel,
    myAgentType,
    setMyAgentType,
    messageState,
  } = props;

  const { EventEmitter } = useGlobal();
  const { formatMessage } = useIntl();
  const { token } = theme.useToken();

  const [page, setPage] = useState<number>(1);
  const [list, setList] = useState<IEasyConfirmCompProps[]>([]);

  const currentMsgIdRef = useRef(lastMsg?.msgId || '');
  const pendingNewSessionDraftRef = useRef(false);

  const getUUId = useCallback((easyConfirmItem: IEasyConfirmCompProps) => {
    const listItem = easyConfirmItem?.messageListItem || easyConfirmItem?.thinkListItem;
    const uuid = listItem?.uuid || '';

    return uuid;
  }, []);

  const compProps = useMemo(() => list[page - 1], [page, list]);
  const Comp = useMemo(() => {
    const contentType = compProps?.messageListItem?.contentType || compProps?.thinkListItem?.contentType;
    return lazyHandler.lazyComp(`${contentType}`) as React.ComponentType<any> | null;
  }, [compProps]);

  const inputDraftKey = sessionId || 'default';
  if (sessionId && pendingNewSessionDraftRef.current) {
    // 新会话从 default 临时键切到真实 sessionId 时同步迁移草稿，避免输入框重挂载后只剩当前员工。
    const pendingDraft = inputDraftMap.get('default');
    if (pendingDraft && !inputDraftMap.has(inputDraftKey)) {
      inputDraftMap.set(inputDraftKey, pendingDraft);
    }
    inputDraftMap.delete('default');
    pendingNewSessionDraftRef.current = false;
  }
  const inputDraft = inputDraftMap.get(inputDraftKey);

  const onInputDraftChange = useCallback(
    (draft: DefaultValueSchema) => {
      if (!draft.text && isEmpty(draft.resourceList)) {
        inputDraftMap.delete(inputDraftKey);
        return;
      }

      inputDraftMap.set(inputDraftKey, draft);
    },
    [inputDraftKey]
  );

  const onSendWithDraftClean = useCallback(
    (param: ISendProps) => {
      // 无 sessionId 时发送会创建新会话，标记后续需要把 default 草稿迁移到真实会话。
      pendingNewSessionDraftRef.current = inputDraftKey === 'default';
      inputDraftMap.delete(inputDraftKey);
      onSend(param);
    },
    [inputDraftKey, onSend]
  );

  useEffect(() => {
    currentMsgIdRef.current = lastMsg?.msgId || '';
  }, [lastMsg?.msgId]);

  useEffect(() => {
    const getter = (list: IEasyConfirmCompProps | IEasyConfirmCompProps[]) => {
      if (!list || isEmpty(list)) return;

      setList((prevList) => {
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
    setList([]);
  }, [sessionId]);

  if (isEmpty(list)) {
    return (
      <div
        className={classnames(inputStyle.queryInput, {
          [inputStyle.queryInputDisabled]: disabledInput,
        })}
        data-isbottom={isBottom}
      >
        <QueryInput
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
      <div className={classnames(styles.easyConfirm, 'ub ub-ver gap8')} style={{ boxShadow: token.boxShadowTertiary }}>
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
                <Comp {...compProps} key={getUUId(compProps)} />
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
