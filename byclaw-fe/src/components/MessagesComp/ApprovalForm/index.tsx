// tslint:disable:ordered-imports
import React, { useRef } from 'react';
import classnames from 'classnames';

import { isNil } from 'lodash';
import { Form, Button, Input, Select, Col, Row, message as antdMessage, Space } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
// @ts-ignore
import { useIntl } from '@umijs/max';

import type { IMessage } from '@/typescript/message';
import { IFormStatus } from '@/hooks/useSseSender/agent/typescript';

import { toApproveForm } from '@/service/agent';

import styles from './index.module.less';

export type IForm = {
  formType: 'input' | 'select' | 'textarea';
  fieldName: string;
  fieldCode: string;
  defaultValue: string;
  description: string;
  optional: string;
  fieldValue?: string;

  requestType: number;
  fieldType: string;

  readonly?: boolean;
  isHidden?: boolean;
};

export type IMessageListItemContent = {
  substance: IForm[];
  formStatus: IFormStatus;
  title?: string;
  extParam?: {
    state: 'PENDING' | 'APPROVED' | 'REJECTED';
  } & Record<string, unknown>;
};

export type IProps = {
  message: IMessage;
  updateMessageListItemContent: (messageListItemContent: IMessageListItemContent) => void;
  messageListItemContent: IMessageListItemContent;
};

const { TextArea } = Input;

function ApprovalForm(props: IProps) {
  const { updateMessageListItemContent, messageListItemContent, message } = props;

  const { messageId } = message;
  const { substance = [], formStatus, title, extParam } = messageListItemContent || {};
  const { state } = extParam || {};

  const intl = useIntl();

  const [form] = Form.useForm();

  const randomRef = useRef(Math.floor(Math.random() * 1000));

  const myToApproveForm = async (approved: boolean) => {
    await form.validateFields();
    const values = form.getFieldsValue();

    updateMessageListItemContent({
      ...messageListItemContent,
      formStatus: IFormStatus.LOADING,
    });

    try {
      const respState = await toApproveForm({
        messageId,
        approved,

        formValues: values,
        extParam,
      });

      if (isNil(respState)) {
        antdMessage.error(intl.formatMessage({ id: 'common.systemError' }));
        updateMessageListItemContent({
          ...messageListItemContent,
          formStatus: IFormStatus.INIT,
        });

        return;
      }

      updateMessageListItemContent({
        ...messageListItemContent,
        formStatus: IFormStatus.FINISH,
        extParam: {
          ...extParam,
          state: respState,
        },
      });
    } catch (e) {
      console.error(e);
      antdMessage.error(intl.formatMessage({ id: 'common.requestFailed' }));
      updateMessageListItemContent({
        ...messageListItemContent,
        formStatus: IFormStatus.INIT,
      });
    }
  };

  const isDisable = formStatus !== IFormStatus.INIT || state !== 'PENDING';

  return (
    <div className={classnames(styles.myForm, 'mW600')} key={`${messageId}_approveForm`}>
      <div className={classnames(styles.myFormHeader, 'ub ub-ac')}>
        {/* 表单 */}
        {title || ''}
      </div>
      <div className={styles.myFormContent}>
        <Form
          form={form}
          name={`${randomRef.current}_message_form`}
          layout="vertical"
          disabled={isDisable}
          // onFinish={() => {}}
        >
          <Row gutter={24}>
            {substance?.map?.((item, idx) => {
              const {
                formType,
                fieldCode,
                fieldName,
                defaultValue,
                optional,
                description,
                fieldValue,
                readonly,
                isHidden,
              } = item;

              let comp = <Input disabled={readonly} />;

              if (formType === 'select') {
                let options = [];
                try {
                  const changed = optional.replace(/'/g, '"');
                  const optionalArr = JSON.parse(changed);
                  options = optionalArr.map((o: string) => ({
                    label: o,
                    value: o,
                  }));
                } catch (e) {
                  console.error(e);
                }

                comp = <Select options={options} disabled={readonly} />;
              }
              if (formType === 'textarea') {
                comp = <TextArea style={{ resize: 'none', overflow: 'auto' }} rows={4} disabled={readonly} />;
              }

              let span = ['textarea'].includes(formType) ? 24 : 12;
              if (isHidden) {
                span = 0;
              }

              return (
                <Col span={span} key={idx}>
                  <Form.Item
                    name={fieldCode}
                    label={fieldName}
                    rules={[{ required: true }]}
                    tooltip={description ? { title: description, icon: <InfoCircleOutlined /> } : undefined}
                    initialValue={fieldValue || defaultValue}
                  >
                    {comp}
                  </Form.Item>
                </Col>
              );
            })}
          </Row>
        </Form>
      </div>
      <div className={classnames(styles.myFormFooter, 'ub ub-pe ub-ac')}>
        <Space>
          {['PENDING', 'REJECTED'].includes(state || '') && (
            <Button
              key={`${messageId}_reject_btn`}
              // type="primary"
              onClick={() => {
                myToApproveForm(false);
              }}
              loading={formStatus === IFormStatus.LOADING}
              disabled={isDisable}
            >
              {intl.formatMessage({ id: 'approvalForm.reject' })}
            </Button>
          )}
          {['PENDING', 'APPROVED'].includes(state || '') && (
            <Button
              key={`${messageId}_approve_btn`}
              type="primary"
              onClick={() => {
                myToApproveForm(true);
              }}
              loading={formStatus === IFormStatus.LOADING}
              disabled={isDisable}
            >
              {intl.formatMessage({ id: 'common.approve' })}
            </Button>
          )}
        </Space>
      </div>
    </div>
  );
}

export default ApprovalForm;
