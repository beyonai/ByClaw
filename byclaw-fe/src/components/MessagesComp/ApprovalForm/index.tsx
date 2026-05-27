// tslint:disable:ordered-imports
import React, { useState, useCallback } from 'react';
import classnames from 'classnames';

import { get, keys, set, isString, isNil, concat } from 'lodash';
import { Form, Button, Input, Select, Col, Row, Space, Dropdown, Tag } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
// @ts-ignore
import { useIntl, getLocale } from '@umijs/max';

import TermSelectDropdown from './TermSelectDropdown';
import { buildFormFieldName, buildFormItemPath, splitKey } from './utils';

import { IMessageState } from '@/constants/message';
import { IMessageListItem } from '@/typescript/message';
import { updateMessageStructById } from '@/service/message';
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
  fieldValue?: string | number | Array<string | number>;

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
  confirmed?: boolean;

  orginContent: Record<string, unknown>;
};

export type IProps = {
  message: IMessage;
  messageListItem: IMessageListItem;
  updateMessageListItemContent: (messageListItemContent: IMessageListItemContent) => void;
  messageListItemContent: IMessageListItemContent;
  thinkListItem?: any[];
  messageIdx: number;
};

const { TextArea } = Input;

function getArrayFieldValues(children: Array<IForm[]>) {
  return children.flat().map((child) => {
    let selectName = child.fieldValue ?? child.defaultValue;

    if (Array.isArray(child?.options)) {
      selectName = concat([], child?.fieldValue)
        .map((item) => {
          const target = child.options?.find((option) => option.value === item);
          return target?.label ?? item;
        })
        .join('、');
    }

    return `${child.fieldName}：${selectName ?? ''}`;
  });
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
    fieldType,
  } = item;

  const isMultiple = fieldType.includes('array');

  const [, forceUpdate] = useState(0);

  let myDisabled = readonly || isDisable;
  let key = buildFormFieldName(fieldCode, idx);
  let span = ['textarea'].includes(formType) ? 24 : 12;
  if (isHidden) {
    span = 0;
  }

  let name: string | undefined = key;
  let rules: { required: boolean | undefined }[] | undefined = [{ required }];
  let initialValue: string | number | (string | number)[] | undefined = fieldValue ?? defaultValue;
  let comp = <Input disabled={myDisabled} />;

  if (['array', 'object'].includes(formType) && Array.isArray(children)) {
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
              <Tag className={classnames(styles.arrayFieldTag, 'textEllipsis')} key={`${value}_${valueIdx}`}>
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
      let optionalArr = [];

      if (isString(optional)) {
        const changed = optional.replace(/'/g, '"');
        optionalArr = JSON.parse(changed);
      } else {
        optionalArr = optional;
      }

      options = optionalArr.map((o: string) => ({
        label: o,
        value: o,
      }));
    } catch (e) {
      console.error(e);
    }

    comp = <Select options={options} disabled={myDisabled} mode={isMultiple ? 'multiple' : undefined} />;
  }

  if (formType === 'term_select') {
    comp = <TermSelectDropdown item={item} disabled={myDisabled} isMultiple={isMultiple} />;
  }

  if (formType === 'textarea') {
    comp = <TextArea style={{ resize: 'none', overflow: 'auto' }} rows={4} disabled={myDisabled} />;
  }

  if (formType === 'input' && isMultiple) {
    comp = <Select mode="tags" />;
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
  const { messageListItemContent, message, messageListItem } = props;

  const { uuid, orginContent } = messageListItem || {};
  const { messageId } = message;
  const {
    substance = [],
    title,
    description,
    formId,
    sourceAgentType,
    metadata = '',
    confirmed,
  } = messageListItemContent || {};

  const { EventEmitter } = useGlobal();

  const intl = useIntl();
  const [form] = Form.useForm();

  // 是否显示按钮
  const [isDisable, setIsDisableBtn] = useState<boolean>(!isNil(confirmed));

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
      });
    },
    [uuid, messageId]
  );

  const myToApproveForm = async (confirmed: boolean) => {
    await form.validateFields();
    // const values = form.getFieldsValue();

    let metadataObj = {};

    try {
      metadataObj = JSON.parse(metadata);
    } catch (e) {
      console.error(e);
    }

    let myOrginContent = {};
    try {
      myOrginContent = JSON.parse(orginContent);
      set(myOrginContent, 'rule', substance);
    } catch (e) {
      console.error(e);
    }

    let queryQuestion = intl.formatMessage({ id: 'common.cancel' });
    if (confirmed) {
      queryQuestion = intl.formatMessage({ id: 'common.submit' });
    }

    const operationForm = {
      ...myOrginContent,
      confirmed,
    };

    set(messageListItemContent, 'confirmed', confirmed);

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
              operationForm,
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

    setIsDisableBtn(true);
    EventEmitter.emit('beyond-chat-on-send-msg', payload);

    myUpdateMessageStructById(operationForm);
  };

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
