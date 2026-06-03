import { useState } from 'react';
import { Form, Input, Select, Col, Dropdown, Tag } from 'antd';
import { isString, concat } from 'lodash';
import { InfoCircleOutlined } from '@ant-design/icons';
import classnames from 'classnames';

import { buildFormFieldName } from '../utils';
import TermSelectDropdown from './TermSelectDropdown';

import type { FormField } from '../index.d';
import type { SelectProps } from 'antd';

import styles from '../index.module.less';

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

export default FormItemsRender;
