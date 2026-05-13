// @ts-nocheck
import React, { useEffect } from 'react';
import { Form, Input, InputNumber, Row, Select, Slider } from 'antd';
import { debounce, merge } from 'lodash';
import { useIntl } from '@umijs/max';
import styles from './index.module.less';

const formItemLayout = {
  labelCol: {
    span: 5,
  },
  wrapperCol: {
    span: 19,
  },
};

const ModelPopover = (props) => {
  const { modelList, resultDataRef, prologueRef, update, setModelName } = props;
  const intl = useIntl();

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _resultData = resultDataRef.current;
  const prologue = prologueRef.current;

  const [form] = Form.useForm();
  const multiModel = Form.useWatch(['prologue', 'multiModel', 'enable'], form);

  useEffect(() => {
    if (prologue) {
      form.setFieldsValue({ prologue });
    }
  }, []);

  return (
    <div className={styles.popoverConfig}>
      <Form
        {...formItemLayout}
        form={form}
        onValuesChange={debounce(() => {
          const values = form.getFieldsValue();
          setModelName(values?.prologue?.modelInfo?.model ?? '');
          prologueRef.current = merge({}, prologue, values.prologue);
          update?.();
        }, 400)}
      >
        <>
          <Row>
            <div className={styles.leftItem}>
              <div className={styles.headerTitle}>
                {intl.formatMessage({
                  id: 'modelPopover.QALargeModelConfiguration',
                })}
              </div>
            </div>
          </Row>
          <div style={{ display: 'none' }}>
            <Form.Item name={['prologue', 'modelInfo', 'model']}>
              <Input />
            </Form.Item>
          </div>
          <Form.Item
            label={intl.formatMessage({ id: 'modelPopover.largeModel' })}
            name={['prologue', 'modelInfo', 'modelId']}
          >
            <Select
              options={modelList}
              fieldNames={{
                label: 'modelName',
                value: 'modelId',
              }}
              showSearch
              onChange={(v, option) => {
                form.setFieldValue(['prologue', 'modelInfo', 'model'], option?.modelName);
              }}
              optionFilterProp="modelName"
              placeholder={intl.formatMessage(
                { id: 'form.selectPlaceholder' },
                {
                  content: intl.formatMessage({
                    id: 'modelPopover.largeModel',
                  }),
                }
              )}
            />
          </Form.Item>
          <Form.Item
            label={intl.formatMessage({ id: 'modelPopover.history' })}
            name={['prologue', 'modelInfo', 'history']}
          >
            <InputNumber min={0} max={30} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            label={intl.formatMessage({ id: 'modelPopover.temperature' })}
            name={['prologue', 'modelInfo', 'temperature']}
          >
            <Slider max={1.9} step={0.1} included={false} />
          </Form.Item>
          <Form.Item
            label={intl.formatMessage({ id: 'modelPopover.maxToken' })}
            name={['prologue', 'modelInfo', 'maxToken']}
          >
            <Slider max={4000} />
          </Form.Item>
        </>

        {multiModel && (
          <>
            <Form.Item
              label={intl.formatMessage({ id: 'modelPopover.prompt' })}
              name={['prologue', 'multiModel', 'prompt']}
            >
              <Input.TextArea
                placeholder={intl.formatMessage({
                  id: 'modelPopover.promptPlaceholder',
                })}
                rows={4}
              />
            </Form.Item>
            <Form.Item
              label={intl.formatMessage({ id: 'modelPopover.temperature' })}
              name={['prologue', 'multiModel', 'temperature']}
            >
              <Slider max={1.9} step={0.1} included={false} />
            </Form.Item>
          </>
        )}
      </Form>
    </div>
  );
};

export default ModelPopover;
