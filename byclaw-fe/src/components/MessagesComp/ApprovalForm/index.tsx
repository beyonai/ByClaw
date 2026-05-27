// tslint:disable:ordered-imports
import React, { useEffect, useState, useMemo } from 'react';
import classnames from 'classnames';

import { get, keys, set, cloneDeep } from 'lodash';
import { Form, Button, Input, Select, Col, Row, Space, Dropdown, Tag } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
// @ts-ignore
import { useIntl, getLocale } from '@umijs/max';

import TermSelectDropdown from './TermSelectDropdown';
import { buildFormFieldName, buildFormItemPath, splitKey } from './utils';

import { SSEMessageType, IMessageState } from '@/constants/message';
import useGlobal from '@/hooks/useGlobal';

import type { IMessage } from '@/typescript/message';

import styles from './index.module.less';

export type IForm = {
  formType: 'input' | 'select' | 'textarea' | 'array' | 'term_select';
  fieldName: string;
  fieldCode: string;
  defaultValue: string;
  description: string;
  optional: string;
  fieldValue?: string | number;

  requestType: number;
  fieldType: string;

  readonly?: boolean;
  isHidden?: boolean;
  required?: boolean;

  children?: Array<IForm[]>;

  term?: {
    termSet: string;
    termTypeCode: string;
    termField: string;
    datasetId: number;
  };
  options?: Array<{
    label: string;
    value: string | number;
  }>;
  page?: number;
  pageSize?: number;
  total?: number;
  hasMore?: boolean;
  keyword?: string;
  termOptionsData?: unknown;
  termOptionsLoading?: boolean;
};

export type IMessageListItemContent = {
  formId: string;
  substance: Array<IForm[]>;
  title?: string;
  description?: string;
  sourceAgentType?: string;
  metadata?: string;
  extParam?: {
    state: 'PENDING' | 'APPROVED' | 'REJECTED';
  } & Record<string, unknown>;

  orginContent: Record<string, unknown>;
};

export type IProps = {
  message: IMessage;
  updateMessageListItemContent: (messageListItemContent: IMessageListItemContent) => void;
  messageListItemContent: IMessageListItemContent;
  thinkListItem?: any[];
  messageIdx: number;
};

const { TextArea } = Input;

function getArrayFieldValues(children: Array<IForm[]>) {
  return children.flat().map((child) => `${child.fieldName}：${child.fieldValue}`);
}

type FormFieldsRenderProps = {
  isDisable: boolean;
  substance: Array<IForm[]>;
  parentPath?: string;
};

type FormItemsRenderProps = {
  idx: string;
  item: IForm;
  isDisable: boolean;
  renderNestedForm: (props: FormFieldsRenderProps) => React.ReactNode;
};

const FormItemsRender = ({ idx, item, isDisable, renderNestedForm }: FormItemsRenderProps) => {
  const {
    formType,
    fieldCode,
    fieldName,
    defaultValue,
    optional,
    description,
    fieldValue,
    children,
    readonly,
    isHidden,
    required,
  } = item;

  const [, forceUpdate] = useState(0);

  let myDisabled = readonly || isDisable;
  let key = buildFormFieldName(fieldCode, idx);
  let span = ['textarea'].includes(formType) ? 24 : 12;
  if (isHidden) {
    span = 0;
  }

  let name: string | undefined = key;
  let rules: { required: boolean | undefined }[] | undefined = [{ required }];
  let initialValue: string | number | undefined = fieldValue ?? defaultValue;
  let comp = <Input disabled={myDisabled} />;

  if (formType === 'array' && Array.isArray(children)) {
    name = undefined;
    rules = undefined;
    initialValue = undefined;

    const childValues = getArrayFieldValues(children);

    comp = (
      <Dropdown
        trigger={['click']}
        popupRender={() => (
          <div className={styles.dropdownContent}>
            {renderNestedForm({ isDisable, substance: children, parentPath: idx })}
          </div>
        )}
        onOpenChange={(open) => {
          if (!open) {
            forceUpdate(Date.now());
          }
        }}
      >
        <div className={styles.arrayFieldPreview}>
          {childValues.length > 0 ? (
            childValues.map((value, valueIdx) => (
              <Tag className={styles.arrayFieldTag} key={`${value}_${valueIdx}`}>
                {value}
              </Tag>
            ))
          ) : (
            <span className={styles.arrayFieldPlaceholder}>{fieldName}</span>
          )}
        </div>
      </Dropdown>
    );
  }

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

    comp = <Select options={options} disabled={myDisabled} />;
  }

  if (formType === 'term_select') {
    comp = <TermSelectDropdown item={item} disabled={myDisabled} />;
  }

  if (formType === 'textarea') {
    comp = <TextArea style={{ resize: 'none', overflow: 'auto' }} rows={4} disabled={myDisabled} />;
  }

  return (
    <Col span={span} key={key}>
      <Form.Item
        name={name}
        label={fieldName}
        rules={rules}
        tooltip={description ? { title: description, icon: <InfoCircleOutlined /> } : undefined}
        initialValue={initialValue}
      >
        {comp}
      </Form.Item>
    </Col>
  );
};

function FormFieldsRender(props: FormFieldsRenderProps) {
  const { isDisable, substance, parentPath } = props;

  return (
    <>
      {substance?.map?.((list, lidx) => {
        return (
          <Row gutter={24} key={lidx} className={styles.formRow}>
            {list.map((item, idx) => {
              const key = buildFormItemPath(lidx, idx, parentPath);

              return (
                <FormItemsRender
                  key={key}
                  idx={key}
                  item={item}
                  isDisable={isDisable}
                  renderNestedForm={(formFieldsRenderProps) => <FormFieldsRender {...formFieldsRenderProps} />}
                />
              );
            })}
          </Row>
        );
      })}
    </>
  );
}

function ApprovalForm(props: IProps) {
  const { messageListItemContent, message, messageIdx } = props;

  const { messageId } = message;
  const {
    substance = [],
    title,
    description,
    formId,
    sourceAgentType,
    metadata = '',
    orginContent,
  } = messageListItemContent || {};

  const { EventEmitter } = useGlobal();

  const intl = useIntl();
  const [form] = Form.useForm();

  const { isHistoryMsg } = message;
  const isThinkingProcess = !!props.thinkListItem;

  // 是否显示按钮
  const [isDisable, setIsDisableBtn] = useState<boolean>(!isHistoryMsg);

  const myToApproveForm = async (confirmed: boolean) => {
    await form.validateFields();
    // const values = form.getFieldsValue();

    let metadataObj = {};

    try {
      metadataObj = JSON.parse(metadata);
    } catch (e) {
      console.error(e);
    }

    const myOrginContent = cloneDeep(orginContent || {});
    orginContent.rule = substance;

    let queryQuestion = intl.formatMessage({ id: 'common.cancel' });
    if (confirmed) {
      queryQuestion = intl.formatMessage({ id: 'common.submit' });
    }

    const payload = {
      sendProps: {
        queryQuestion,
        // 用于合并消息记录
        inheritQryMsgId: message.queryMsgId,
        payload: {
          actionType: 'RESUME',
          sourceAgentType,
          confirmed,
          extParams: {
            humanInput: {
              operationForm: {
                ...myOrginContent,
                confirmed,
              },
              metadata: metadataObj,
            },
            query: queryQuestion,
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

    console.log(payload);
    setIsDisableBtn(true);
    EventEmitter.emit('beyond-chat-on-send-msg', payload);
  };

  const list = useMemo(() => {
    if (isThinkingProcess) {
      return message.thinkList || [];
    }
    return message?.messageList || [];
  }, [message.messageList, message.thinkList, isThinkingProcess]);

  // 最后一个问题才显示按钮
  useEffect(() => {
    if (isHistoryMsg) {
      setIsDisableBtn(false);
      return;
    }

    let lastIndex = list?.findLastIndex((item) => {
      return `${get(item, 'contentType')}` === `${SSEMessageType.thinkRewriteQuestion}`;
    });
    console.log('lastIndex', lastIndex, messageIdx);
    setIsDisableBtn(lastIndex === messageIdx);
  }, [list, messageIdx, isHistoryMsg]);

  return (
    <div className={classnames(styles.myForm)} key={`${messageId}_approveForm`}>
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
      <div className={styles.myFormContent}>
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
          <FormFieldsRender isDisable={isDisable} substance={substance} />
        </Form>
      </div>
      <div className={classnames(styles.myFormFooter, 'ub ub-pe ub-ac')}>
        <Space>
          <Button
            key={`${messageId}_reject_btn`}
            // type="primary"
            onClick={() => {
              myToApproveForm(false);
            }}
            disabled={isDisable}
          >
            {intl.formatMessage({ id: 'common.cancel' })}
          </Button>
          <Button
            key={`${messageId}_approve_btn`}
            type="primary"
            onClick={() => {
              myToApproveForm(true);
            }}
            disabled={isDisable}
          >
            {intl.formatMessage({ id: 'common.submit' })}
          </Button>
        </Space>
      </div>
    </div>
  );
}

export default ApprovalForm;
