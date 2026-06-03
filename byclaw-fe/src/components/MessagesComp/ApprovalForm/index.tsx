// tslint:disable:ordered-imports
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import classnames from 'classnames';

import { get, keys, set, isBoolean, size } from 'lodash';
import { Form, Button, Steps } from 'antd';
// @ts-ignore
import { useIntl, getLocale } from '@umijs/max';

import { splitKey } from './utils';
import FormFieldsRender from './components/FormFieldsRender';

import { IMessageState } from '@/constants/message';
import { IMessageListItem } from '@/typescript/message';
import { updateMessageStructById } from '@/service/message';
import useGlobal from '@/hooks/useGlobal';
import { IFormStatus } from '@/hooks/useSseSender/agent/typescript';

import type { IMessage } from '@/typescript/message';
import type { OperationFormConfirmation } from './index.d';

import styles from './index.module.less';

export type IProps = {
  message: IMessage;
  updateMessageListItemContent: (messageListItemContent: OperationFormConfirmation) => void;
  messageListItemContent: OperationFormConfirmation;

  messageListItem?: IMessageListItem;
  thinkListItem?: IMessageListItem;

  messageIdx: number;
};

type StepStatus = 'wait' | 'process' | 'finish' | 'error';

function ApprovalForm(props: IProps) {
  const { messageListItemContent, message, messageListItem, thinkListItem } = props;
  const { uuid, orginContent, resumeMessageId } = messageListItem || thinkListItem || {};

  const { messageId } = message;
  const {
    substance = [],
    title,
    description,
    formId,
    sourceAgentType,
    metadata = '',
    formStatus,
  } = messageListItemContent || {};
  const { EventEmitter } = useGlobal();

  const stepDescriptionRef = useRef<HTMLDivElement>(null);

  const intl = useIntl();
  const [form] = Form.useForm();

  // 是否显示按钮
  const [isDisable, setIsDisableBtn] = useState<boolean>(formStatus === IFormStatus.FINISH);
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [confirmedVersion, setConfirmedVersion] = useState<number>(0);

  const isThinkingProcess = !!props.thinkListItem;
  const updateField = isThinkingProcess ? 'inferLog' : 'messageStruct';

  const totalSteps = substance.length;
  const currentStepIndex = Math.min(currentStep, Math.max(totalSteps - 1, 0));
  const currentStepItem = substance[currentStepIndex];
  const isFirstStep = currentStepIndex <= 0;
  const isLastStep = currentStepIndex >= totalSteps - 1;

  const allStepsConfirmed = useMemo(
    () => substance.length > 0 && substance.every((item) => typeof item.confirmed === 'boolean'),
    [confirmedVersion, substance]
  );

  const stepItems = useMemo(
    () =>
      substance.map((item, idx) => {
        let status: StepStatus = 'wait';

        if (isBoolean(item.confirmed)) {
          status = item.confirmed ? 'finish' : 'error';
        } else if (idx === currentStepIndex) {
          status = 'process';
        }

        return {
          key: item.toolCallId || item.actionCode || `${idx}`,
          status,
          title: item.title || item.actionName || item.toolName || `${idx + 1}`,
        };
      }),
    [confirmedVersion, currentStepIndex, substance]
  );
  const hasMoreSteps = size(stepItems) > 1;

  const scrollToStepDescription = useCallback(() => {
    const scroll = () => {
      stepDescriptionRef.current?.scrollIntoView?.({
        behavior: 'smooth',
        block: 'start',
      });
    };

    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(scroll);
      return;
    }

    window.setTimeout(scroll, 0);
  }, []);

  const handlePrevStep = () => {
    setCurrentStep((prevStep) => Math.max(prevStep - 1, 0));
  };

  const handleNextStep = async () => {
    try {
      await form.validateFields();
      setCurrentStep((prevStep) => Math.min(prevStep + 1, Math.max(totalSteps - 1, 0)));
    } catch (e) {
      // 保持当前页，让 antd Form 展示字段校验错误。
    }
  };

  const handleConfirmCurrentStep = async (nextConfirmed: boolean) => {
    if (!currentStepItem) return;

    set(currentStepItem, 'confirmed', nextConfirmed);
    setConfirmedVersion(Date.now());

    await handleNextStep();
  };

  const myUpdateMessageStructById = useCallback(
    (newOrginContent: Record<string, unknown>) => {
      let contentStr;
      try {
        contentStr = JSON.stringify(newOrginContent);
      } catch (e) {
        console.error(e);
      }

      updateMessageStructById({
        id: uuid,
        messageId,
        content: contentStr,
        updateField,
      });
    },
    [uuid, messageId, updateField]
  );

  const myToApproveForm = async () => {
    await form.validateFields();
    // const values = form.getFieldsValue();

    let metadataObj = {};

    try {
      metadataObj = JSON.parse(metadata);
    } catch (e) {
      console.error(e);
    }

    let operationForm = {};
    try {
      operationForm = JSON.parse(orginContent || '');
      set(operationForm, 'actions', substance);
      set(operationForm, 'formStatus', IFormStatus.FINISH);
    } catch (e) {
      console.error(e);
    }

    set(messageListItemContent, 'formStatus', IFormStatus.FINISH);
    const queryQuestion = intl.formatMessage({ id: 'common.submit' });

    const payload = {
      sendProps: {
        queryQuestion,
        // 用于合并消息记录
        inheritQryMsgId: message.queryMsgId,
        payload: {
          actionType: 'RESUME',
          sourceAgentType,
          resumeMessageId,
          extParams: {
            humanInput: {
              operationForm,
              metadata: metadataObj,
            },
            query: queryQuestion,
            language: getLocale(),
          },
          llmMessageId: messageId,
          traceId: message.traceId,
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

    setIsDisableBtn(true);

    EventEmitter.emit('beyond-chat-on-send-msg', payload);
    EventEmitter.emit('beyond-easyconfirm-set-approvalform-item', props);

    myUpdateMessageStructById(operationForm);
  };

  useEffect(() => {
    setIsDisableBtn(formStatus === IFormStatus.FINISH);
  }, [formStatus]);

  return (
    <div className={classnames(styles.myForm, 'ub ub-ver overflow-hidden')} key={`${messageId}_approveForm`}>
      <div className={'ub ub-ver gap2'}>
        <div className={classnames(styles.myFormTitle, 'ub ub-ac')}>
          {/* 表单 */}
          {title || ''}
        </div>
        <div className={classnames(styles.myFormDescription, 'ub ub-ac')}>
          {/* 表单 */}
          {description || ''}
        </div>
      </div>
      <div className={classnames(styles.myFormContent)} ref={stepDescriptionRef}>
        <Form
          form={form}
          name={formId}
          layout="vertical"
          disabled={isDisable}
          onValuesChange={(changedValues) => {
            keys(changedValues).forEach((key) => {
              const [formItemName, path] = key.split(splitKey);

              const target = get(substance, path);
              if (target && target.fieldCode === formItemName) {
                set(target, 'fieldValue', changedValues[key]);
              }
            });
          }}
        >
          {hasMoreSteps && (
            <Steps
              className={styles.approvalSteps}
              current={currentStepIndex}
              direction="horizontal"
              labelPlacement="vertical"
              items={stepItems}
            />
          )}
          {currentStepItem ? (
            <div className={styles.stepDescription}>
              {/* {currentStepItem.description ? (
                <div className={styles.stepIntro}>{currentStepItem.description}</div>
              ) : null} */}
              <div className={styles.stepFormContent}>
                <FormFieldsRender
                  isDisable={isDisable}
                  substance={currentStepItem.rule || []}
                  pathPrefix={`${currentStepIndex}.rule`}
                />
              </div>
            </div>
          ) : null}
        </Form>
      </div>
      <div className={classnames(styles.myFormFooter, 'ub ub-ver gap8')}>
        <div className={'ub ub-pe ub-ac gap8'}>
          {hasMoreSteps && (
            <Button
              key={`${messageId}_prev_btn`}
              onClick={() => {
                handlePrevStep();
                scrollToStepDescription();
              }}
              disabled={isFirstStep}
            >
              {intl.formatMessage({ id: 'common.prev' })}
            </Button>
          )}
          {hasMoreSteps && isDisable && (
            <Button
              key={`${messageId}_next_btn`}
              onClick={async () => {
                await handleNextStep();
                scrollToStepDescription();
              }}
              disabled={isLastStep}
            >
              {intl.formatMessage({ id: 'common.next' })}
            </Button>
          )}
          {!isDisable && (
            <>
              <Button
                key={`${messageId}_skip_btn`}
                onClick={() => {
                  handleConfirmCurrentStep(false).then(() => {
                    if (!hasMoreSteps) {
                      myToApproveForm();
                    }
                  });
                }}
                disabled={isDisable}
                style={{ marginLeft: 'auto' }}
              >
                {hasMoreSteps ? intl.formatMessage({ id: 'common.skip' }) : intl.formatMessage({ id: 'common.cancel' })}
              </Button>
              <Button
                key={`${messageId}_confirm_btn`}
                type="primary"
                onClick={() => {
                  handleConfirmCurrentStep(true).then(() => {
                    if (!hasMoreSteps) {
                      myToApproveForm();
                    }
                  });
                }}
                disabled={isDisable}
              >
                {hasMoreSteps
                  ? intl.formatMessage({ id: 'common.confirm' })
                  : intl.formatMessage({ id: 'common.submit' })}
              </Button>
            </>
          )}
        </div>
        {hasMoreSteps && !isDisable && isLastStep && allStepsConfirmed ? (
          <div className={'ub ub-pe ub-ac gap8'} style={{ borderTop: '1px solid #e5e5e5', paddingTop: '8px' }}>
            <Button
              key={`${messageId}_approve_btn`}
              type="primary"
              onClick={() => {
                myToApproveForm();
              }}
            >
              {intl.formatMessage({ id: 'common.submit' })}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// const ApprovalFormWarpper = (props: IProps) => {
//   const { EventEmitter } = useGlobal();

//   useEffect(() => {
//     if (props.message.messageState === IMessageState.Answer) {
//       EventEmitter.emit('beyond-easyconfirm-set-approvalform-item', props);
//     }
//   }, []);

//   return <ApprovalForm {...props} />;
// };

export default ApprovalForm;
// export default ApprovalFormWarpper;
