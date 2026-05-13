import classnames from 'classnames';
import { get, isString } from 'lodash';
import { useRef } from 'react';

import { useIntl } from '@umijs/max';
import { Button, message } from 'antd';
import useGlobal from '@/hooks/useGlobal';
import { IFormStatus } from '@/hooks/useSseSender/agent/typescript';
import { submitForm } from '@/service/agent';
import type { IMessage } from '@/typescript/message';
import { LayoutMode } from '@/constants/system';
import MessageForm, { IFormItem } from '@/components/MessageForm';
import styles from './index.module.less';

export type IMessageListItemContent = {
  substance: IFormItem[];
  pluginAppId: string;
  pluginMachineId: string;
  formStatus: IFormStatus;
  stepId: string;
};

export type IProps = {
  message: IMessage;
  updateMessageListItemContent: (messageListItemContent: IMessageListItemContent) => void;
  messageListItemContent: IMessageListItemContent;
};

function FormComp(props: IProps) {
  const { updateMessageListItemContent, messageListItemContent, message: messageInfo } = props;
  const { substance = [], pluginAppId, pluginMachineId, formStatus, stepId } = messageListItemContent || {};
  const { messageId } = messageInfo || {};
  const intl = useIntl();
  const { EventEmitter, layoutMode } = useGlobal();
  const isPreviewMode = layoutMode === LayoutMode.preview;

  const formRef = useRef<any>();

  return (
    <div className={classnames(styles.myForm, 'mW600')} key={`${pluginAppId}_${pluginMachineId}`}>
      <div className={classnames(styles.myFormHeader, 'ub ub-ac')}>{/* 表单 */}</div>
      <div className={styles.myFormContent}>
        <MessageForm ref={formRef} substance={substance} disabled={formStatus !== IFormStatus.INIT} />
      </div>
      <div className={classnames(styles.myFormFooter, 'ub ub-pe ub-ac')}>
        <Button
          key={`${pluginAppId}_${pluginMachineId}_btn`}
          type="primary"
          disabled={formStatus === IFormStatus.FINISH || isPreviewMode}
          onClick={async () => {
            const form = formRef.current;
            await form.validateFields();
            const values = form.getFieldsValue();
            updateMessageListItemContent({
              ...messageListItemContent,
              formStatus: IFormStatus.LOADING,
            });

            try {
              const resp = await submitForm({
                pluginMachineId,
                pluginAppId,
                messageId,
                inOutType: '',
                pluginMachineFields: substance.map((item) => {
                  return {
                    ...item,
                    fieldValue: get(values, item.fieldCode),
                  };
                }),
              });

              let { result } = resp;
              if (isString(result)) {
                result = JSON.parse(result);
              }

              if (`${result.code}` !== '0') {
                message.error(result.msg);
                updateMessageListItemContent({
                  ...messageListItemContent,
                  formStatus: IFormStatus.INIT,
                });
                return;
              }

              message.success(result.msg);
              updateMessageListItemContent({
                ...messageListItemContent,
                formStatus: IFormStatus.FINISH,
              });
              if (!stepId) return;
              // 处理表单数据
              const formContentString = substance
                .map((item) => {
                  const value = get(values, item.fieldCode);
                  return value ? `${item.fieldCode}:${value}` : '';
                })
                .join(',');
              // 启动会话
              EventEmitter.emit('beyond-chat-on-send-msg', {
                sendProps: {
                  queryQuestion: intl.formatMessage(
                    { id: 'form.content' },
                    { formContent: formContentString, msg: result.msg }
                  ),
                  payload: {
                    taskOperateType: 'FEEDBACK',
                    llmMessageId: messageId,
                    taskStepId: stepId,
                  },
                  msgOpt: {
                    answerMsg: {
                      ...messageInfo,
                    },
                  },
                },
                sendConf: {
                  onlyQuery: true,
                },
              });
            } catch (e) {
              console.error(e);
              message.error(intl.formatMessage({ id: 'form.requestFailed' }));
              updateMessageListItemContent({
                ...messageListItemContent,
                formStatus: IFormStatus.INIT,
              });
            }
          }}
          loading={formStatus === IFormStatus.LOADING}
        >
          {formStatus === IFormStatus.FINISH
            ? intl.formatMessage({ id: 'form.completed' })
            : intl.formatMessage({ id: 'form.confirm' })}
        </Button>
      </div>
    </div>
  );
}

export default FormComp;
