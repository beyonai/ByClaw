import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import classnames from 'classnames';
import { Pagination } from 'antd';
import { concat, isEmpty, assign } from 'lodash';
// import CloseOutlined from '@ant-design/icons/CloseOutlined';

import QueryInput from '@/components/QueryInput';
import ApprovalFormComp, { IProps as IApprovalFormProps } from '@/components/MessagesComp/ApprovalForm';

import useGlobal from '@/hooks/useGlobal';
import { IFormStatus } from '@/hooks/useSseSender/agent/typescript';

import type { IAgentType } from '@/typescript/agent';
import type { IMessage } from '@/typescript/message';
import type { ISendProps } from '@/hooks/useChat';

import styles from './index.module.less';
import inputStyle from '@/components/ChatLayoutComp/index.module.less';
import { IMessageState } from '@/constants/message';

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

  const [page, setPage] = useState<number>(1);
  const [list, setList] = useState<IApprovalFormProps[]>([]);

  const currentMsgIdRef = useRef(lastMsg?.msgId || '');

  const getUUId = useCallback((myapprovalFormItem: IApprovalFormProps) => {
    const listItem = myapprovalFormItem?.messageListItem || myapprovalFormItem?.thinkListItem;
    const uuid = listItem?.uuid || '';

    return uuid;
  }, []);

  const compProps = useMemo(() => list[page - 1], [page, list]);

  useEffect(() => {
    currentMsgIdRef.current = lastMsg?.msgId || '';
  }, [lastMsg?.msgId]);

  useEffect(() => {
    const getter = (list: IApprovalFormProps[]) => {
      if (!list || isEmpty(list)) return;

      setList((prevList) => {
        concat([], list).forEach((approvalFormItem) => {
          const uuid = getUUId(approvalFormItem);

          if (!uuid || approvalFormItem?.message?.msgId !== currentMsgIdRef.current) return;

          const target = prevList.find((item) => {
            return getUUId(item) === uuid;
          });
          console.log(target, approvalFormItem);
          if (target) {
            assign(target, approvalFormItem);
          } else {
            prevList.push(approvalFormItem);
          }
        });

        const res = prevList.filter(
          (item) =>
            ![IFormStatus.FINISH, IFormStatus.ERROR, IFormStatus.DISABLED].includes(
              item?.messageListItemContent?.formStatus
            )
        );
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
          onSend={onSend}
          onCancel={onCancel}
          myAgentType={myAgentType}
          setMyAgentType={setMyAgentType}
          isBottom={isBottom}
          cannotAt={cannotAt}
          sessionId={sessionId}
          {...queryInputProps}
        />
      </div>
    );
  }

  return (
    <>
      <div className={classnames(styles.easyConfirm, 'ub ub-ver gap8')}>
        <div className="ub ub-pj">
          <div>请选择要操作的步骤</div>
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
        <div className="ub-f1">{compProps && <ApprovalFormComp {...(compProps || {})} key={getUUId(compProps)} />}</div>
      </div>
    </>
  );
};

export default EasyConfirm;
