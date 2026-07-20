import { useEffect, useState } from 'react';
import { Form, Input, Select, Col, Dropdown, Tag, DatePicker, Button, Tooltip } from 'antd';
import { isString, concat, isEqual } from 'lodash';
import { FullscreenOutlined, InfoCircleOutlined } from '@ant-design/icons';
import classnames from 'classnames';

import {
  buildFormFieldName,
  getApprovalFormDateFormat,
  getApprovalFormDatePickerValue,
  getApprovalFormDateSubmitValue,
  hasApprovalFormDateTimeFormat,
} from '../utils';
import TermSelectDropdown from './TermSelectDropdown';

import type { FormField } from '../index.d';
import type { SelectProps } from 'antd';
import type { TextAreaProps } from 'antd/es/input';

import styles from '../index.module.less';
import useGlobal from '@/hooks/useGlobal';

type FormFieldsRenderProps = {
  isDisable: boolean;
  substance: Array<FormField[]>;
  parentPath?: string;
  pathPrefix?: string;
};

type FormItemsRenderProps = {
  idx: string;
  item: FormField;
  isDisable: boolean;
  renderNestedForm: (props: FormFieldsRenderProps) => React.ReactNode;
};

const { TextArea } = Input;

type PreviewTextAreaProps = TextAreaProps & {
  onPreview: () => void;
};

const PreviewTextArea = ({ onPreview, ...textareaProps }: PreviewTextAreaProps) => (
  <div className={styles.textareaPreview}>
    <TextArea {...textareaProps} className={styles.textareaInput} />
    <Tooltip title="查看更多">
      <Button
        aria-label="查看更多"
        className={styles.textareaPreviewAction}
        disabled={false}
        icon={<FullscreenOutlined />}
        onClick={onPreview}
        size="small"
        type="text"
      />
    </Tooltip>
  </div>
);

function getArrayFieldValues(children: Array<FormField[]>) {
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

function getFormValueFromEvent(...args: unknown[]) {
  const event = args[0] as { target?: { checked?: unknown; type?: string; value?: unknown } } | undefined;

  if (event?.target) {
    return event.target.type === 'checkbox' ? event.target.checked : event.target.value;
  }

  return args[0];
}

const FormItemsRender = ({ idx, item, isDisable, renderNestedForm }: FormItemsRenderProps) => {
  const form = Form.useFormInstance();
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

  const termResolveNotice = 'termResolveNotice' in item ? item.termResolveNotice : undefined;
  const errorTips = termResolveNotice?.status === 'recommended' && termResolveNotice?.message;

  let myDisabled = readonly || isDisable;
  let key = buildFormFieldName(fieldCode, idx);
  const [isInitialErrorVisible, setIsInitialErrorVisible] = useState(Boolean(errorTips));

  const { EventEmitter } = useGlobal();

  useEffect(() => {
    setIsInitialErrorVisible(Boolean(errorTips));
  }, [errorTips, key]);

  let span = ['textarea'].includes(formType) ? 24 : 12;
  if (isHidden) {
    span = 0;
  }

  let name: string | undefined = key;
  let rules: any[] | undefined = [{ required }];
  let initialValue: unknown = fieldValue ?? defaultValue;
  let comp = <Input disabled={myDisabled} />;
  let formItemValueProps = {};

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
    let options: SelectProps['options'] = [];
    try {
      let optionalArr: string[] = [];

      if (isString(optional)) {
        const changed = optional.replace(/'/g, '"');
        optionalArr = JSON.parse(changed);
      } else {
        optionalArr = Array.isArray(optional) ? optional : [];
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
    comp = <TermSelectDropdown item={item} disabled={myDisabled} isMultiple={isMultiple} name={name} />;
  }

  if (formType === 'textarea') {
    comp = (
      <PreviewTextArea
        style={{ resize: 'none', overflow: 'auto' }}
        rows={4}
        disabled={myDisabled}
        onPreview={() => {
          EventEmitter.emit('beyond-main-driver-open-type', {
            width: '50vw',
            minWidth: '360px',
            maxWidth: '50vw',
            drawerType: 'preview',
            canClose: true,
            canFullScreen: true,
          });
          EventEmitter.emit('beyond-main-driver-message', {
            data: name ? form.getFieldValue(name) : fieldValue,
            type: 'md',
          });
        }}
      />
    );
  }

  if (formType === 'input' && isMultiple) {
    comp = <Select mode="tags" />;
  }

  if (formType === 'date_time') {
    const defaultFormat = getApprovalFormDateFormat(item?.format); // 暂时前端处理日期格式
    comp = <DatePicker format={{ format: defaultFormat }} showTime={hasApprovalFormDateTimeFormat(defaultFormat)} />;
    initialValue = getApprovalFormDateSubmitValue(initialValue, defaultFormat);
    formItemValueProps = {
      getValueProps: (value: unknown) => ({
        value: getApprovalFormDatePickerValue(value, defaultFormat),
      }),
      normalize: (value: unknown) => getApprovalFormDateSubmitValue(value, defaultFormat),
    };
  }

  useEffect(() => {
    if (!name) return;

    const currentValue = form.getFieldValue(name);
    const shouldSync = fieldValue !== undefined || !form.isFieldTouched(name);

    if (shouldSync && !isEqual(currentValue, initialValue)) {
      form.setFieldValue(name, initialValue);
    }

    if (formType === 'date_time' && initialValue !== undefined) {
      if (fieldValue !== undefined && !isEqual(fieldValue, initialValue)) {
        item.fieldValue = initialValue as typeof item.fieldValue;
      } else if (defaultValue !== undefined && !isEqual(defaultValue, initialValue)) {
        item.defaultValue = initialValue as typeof item.defaultValue;
      }
    }
  }, [defaultValue, fieldValue, form, formType, initialValue, item, name]);

  const visibleErrorTips = isInitialErrorVisible ? errorTips : undefined;

  return (
    <Col span={span} key={key}>
      <Form.Item
        key={key}
        name={name}
        label={fieldName}
        rules={rules}
        tooltip={description ? { title: description, icon: <InfoCircleOutlined /> } : undefined}
        initialValue={initialValue}
        validateStatus={visibleErrorTips ? 'error' : undefined}
        help={visibleErrorTips}
        {...formItemValueProps}
        getValueFromEvent={(...args) => {
          setIsInitialErrorVisible(false);
          return getFormValueFromEvent(...args);
        }}
      >
        {comp}
      </Form.Item>
    </Col>
  );
};

export default FormItemsRender;
