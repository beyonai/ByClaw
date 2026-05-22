import React, { useEffect, useMemo, useState } from 'react';
import { Button, Empty, Form, Input, InputNumber, List, Select, Steps, Switch, Typography, message } from 'antd';
import { useIntl } from '@umijs/max';
import { get } from 'lodash';
import classNames from 'classnames';

import { copyWithMessage } from '@/utils/copy';
import { RenderItem } from '../../SkillDetailDrawer.utils';

import { queryCallMCPToolRequest } from '@/pages/manager/service/resources';

import styles from '@/pages/employees/components/SkillDetailDrawer/SkillDetailDrawer.module.less';
import myStyles from './index.module.less';
import { ISkillDetail } from '../../SkillDetailDrawer';

type InputSchema = {
  type?: string;
  properties?: Record<string, InputSchema>;
  required?: string[];
  description?: string;
  default?: any;
  enum?: any[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  items?: InputSchema;
};

type MCPToolRecord = RenderItem & {
  key?: React.Key;
  name?: string;
  description?: string;
  inputSchema?: InputSchema;
};

const getSchemaProperties = (schema?: InputSchema) =>
  schema?.properties && typeof schema.properties === 'object' ? schema.properties : {};

const getRequiredFields = (schema?: InputSchema) => (Array.isArray(schema?.required) ? schema.required : []);

const parsePatternOptions = (pattern?: string) => {
  const match = pattern?.match(/^\^\(([^()]+)\)\$$/);
  if (!match) return [];
  return match[1].split('|').filter(Boolean);
};

function getInitialValues(properties: Record<string, InputSchema>) {
  const getDefaultValue = (schema: InputSchema): any => {
    if (schema.default !== undefined) {
      return schema.default;
    }

    if (schema.type === 'object' && schema.properties) {
      return getInitialValues(schema.properties);
    }

    return undefined;
  };

  return Object.entries(properties).reduce((acc, [key, schema]) => {
    const value = getDefaultValue(schema);
    if (value !== undefined) {
      acc[key] = value;
    }
    return acc;
  }, {} as Record<string, any>);
}

const getPatternRule = (pattern?: string) => {
  if (!pattern) return undefined;
  try {
    return new RegExp(pattern);
  } catch (error) {
    console.warn(error);
    return undefined;
  }
};

const normalizeValuesBySchema = (values: any, schema?: InputSchema): any => {
  if (!schema || !values) {
    return values;
  }

  const properties = getSchemaProperties(schema);
  if (schema.type === 'object' && Object.keys(properties).length) {
    return Object.entries(properties).reduce((acc, [key, childSchema]) => {
      acc[key] = normalizeValuesBySchema(values[key], childSchema);
      return acc;
    }, {} as Record<string, any>);
  }

  if ((schema.type === 'array' || schema.type === 'object') && typeof values === 'string') {
    try {
      return values.trim() ? JSON.parse(values) : values;
    } catch {
      return values;
    }
  }

  return values;
};

const MCPTestPanel = (props: { record: RenderItem | null; skillDetail: ISkillDetail }) => {
  const { record, skillDetail } = props;
  const intl = useIntl();
  const [form] = Form.useForm();

  const [data, setData] = useState<MCPToolRecord[]>([]);

  const [selectedItem, setSelectedItem] = useState<MCPToolRecord | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState('');
  const [activeStep, setActiveStep] = useState(0);

  const selectedSchema = selectedItem?.inputSchema;
  const schemaProperties = useMemo(() => getSchemaProperties(selectedSchema), [selectedSchema]);
  const initialValues = useMemo(() => getInitialValues(schemaProperties), [schemaProperties]);

  const handleSubmit = async (values: Record<string, any>) => {
    if (!selectedItem?.name) {
      return;
    }

    const propertiesSchema: InputSchema = {
      type: 'object',
      properties: schemaProperties,
    };

    setRunning(true);
    setResult('');
    try {
      const data = await queryCallMCPToolRequest({
        resourceId: skillDetail?.resourceId || '',
        name: selectedItem?.name || '',
        arguments: normalizeValuesBySchema(values, propertiesSchema),
      } as any);
      setResult(JSON.stringify(data, null, 2));
      setActiveStep(1);
    } catch (error: any) {
      setResult(error?.message || String(error));
      message.error(error?.message || String(error));
      setActiveStep(1);
    } finally {
      setRunning(false);
    }
  };

  const copyDebugContent = (content: string) =>
    copyWithMessage(
      content,
      intl.formatMessage({ id: 'common.copySuccess' }),
      intl.formatMessage({ id: 'common.copyFail' })
    );

  useEffect(() => {
    const dataSource = get(skillDetail, 'items.0.dataSource') || [];
    setData(dataSource);
  }, [skillDetail]);

  useEffect(() => {
    if (record) {
      setSelectedItem(record as MCPToolRecord);
      return;
    }

    setSelectedItem((current) => {
      if (current && data.some((item) => item.key === current.key)) {
        return current;
      }
      return data[0] || null;
    });
  }, [data, record]);

  useEffect(() => {
    form.resetFields();
    form.setFieldsValue(initialValues);
    setResult('');
    setActiveStep(0);
  }, [form, initialValues, selectedItem?.key]);

  const buildRules = (name: string, schema: InputSchema, required: boolean) => {
    const rules: any[] = [];
    if (required) {
      rules.push({ required: true, message: `${name} 为必填项` });
    }

    if (schema.type === 'string') {
      if (schema.minLength !== undefined) {
        rules.push({ min: schema.minLength, message: `${name} 最少 ${schema.minLength} 个字符` });
      }
      if (schema.maxLength !== undefined) {
        rules.push({ max: schema.maxLength, message: `${name} 最多 ${schema.maxLength} 个字符` });
      }
    }

    if (schema.type === 'number' || schema.type === 'integer') {
      if (schema.minimum !== undefined) {
        rules.push({ type: 'number', min: schema.minimum, message: `${name} 不能小于 ${schema.minimum}` });
      }
      if (schema.maximum !== undefined) {
        rules.push({ type: 'number', max: schema.maximum, message: `${name} 不能大于 ${schema.maximum}` });
      }
    }

    const pattern = getPatternRule(schema.pattern);
    if (pattern) {
      rules.push({ pattern, message: `${name} 不符合格式 ${schema.pattern}` });
    }

    return rules;
  };

  const renderFieldControl = (schema: InputSchema) => {
    const options = schema.enum || parsePatternOptions(schema.pattern);
    if (schema.type === 'boolean') {
      return <Switch />;
    }

    if (schema.type === 'number' || schema.type === 'integer') {
      return (
        <InputNumber
          min={schema.minimum}
          max={schema.maximum}
          precision={schema.type === 'integer' ? 0 : undefined}
          style={{ width: '100%' }}
        />
      );
    }

    if (options.length) {
      return <Select allowClear options={options.map((value) => ({ label: String(value), value }))} />;
    }

    if (schema.type === 'array' || schema.type === 'object') {
      return <Input.TextArea autoSize={{ minRows: 3, maxRows: 8 }} />;
    }

    return <Input maxLength={schema.maxLength} />;
  };

  const renderSchemaFields = (
    properties: Record<string, InputSchema>,
    requiredFields: string[],
    parentPath: Array<string | number> = []
  ): React.ReactNode[] =>
    Object.entries(properties).map(([name, schema]) => {
      const fieldPath = [...parentPath, name];
      const fieldKey = fieldPath.join('.');

      if (schema.type === 'object' && schema.properties) {
        return (
          <div key={fieldKey} style={{ marginBottom: 12 }}>
            <div style={{ marginBottom: 8, fontWeight: 500 }}>{name}</div>
            <div style={{ paddingLeft: 12, borderLeft: '2px solid #d8e2f0' }}>
              {renderSchemaFields(schema.properties, getRequiredFields(schema), fieldPath)}
            </div>
          </div>
        );
      }

      return (
        <Form.Item
          key={fieldKey}
          label={name}
          name={fieldPath}
          rules={buildRules(name, schema, requiredFields.includes(name))}
          extra={schema.description}
          valuePropName={schema.type === 'boolean' ? 'checked' : undefined}
        >
          {renderFieldControl(schema)}
        </Form.Item>
      );
    });

  const resetForm = () => {
    form.resetFields();
    form.setFieldsValue(initialValues);
    setResult('');
    setActiveStep(0);
  };

  return (
    <div className="ub gap8 full-height">
      <List
        size="small"
        bordered={false}
        dataSource={data}
        renderItem={(item) => (
          <List.Item
            className={classNames(myStyles.listItem, {
              [myStyles.listItemActive]: item.key === selectedItem?.key,
              disabled: running,
            })}
            onClick={() => {
              if (running) {
                return;
              }
              setSelectedItem(item);
            }}
          >
            <List.Item.Meta
              title={item.name}
              description={
                <Typography.Paragraph ellipsis={{ rows: 1, tooltip: { title: item.description, placement: 'left' } }}>
                  {item.description}
                </Typography.Paragraph>
              }
            />
          </List.Item>
        )}
        className={classNames(myStyles.mcplist, 'full-height')}
      />
      <div className={classNames(styles.debugTestPanel, 'ub-f1 full-height')}>
        <div
          className={classNames(myStyles.debugCodePanel, 'full-height', 'ub ub-ver')}
          style={{ padding: '8px 0 0 8px' }}
        >
          <Steps size="small" current={activeStep} items={[{ title: '输入' }, { title: '输出' }]} />
          {selectedItem ? (
            activeStep === 0 ? (
              <div className="ub gap8 ub-ver ub-f1" style={{ marginTop: 16 }}>
                <Form form={form} layout="vertical" onFinish={handleSubmit} className="ub-f1 overflow-auto">
                  {Object.keys(schemaProperties).length ? (
                    renderSchemaFields(schemaProperties, getRequiredFields(selectedSchema))
                  ) : (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description={intl.formatMessage({ id: 'common.noData' })}
                    />
                  )}
                </Form>
                <div className="ub ub-pe gap8" style={{ marginTop: 16 }}>
                  <Button disabled={running} onClick={resetForm}>
                    {intl.formatMessage({ id: 'common.reset' })}
                  </Button>
                  <Button type="primary" loading={running} onClick={() => form.submit()}>
                    {intl.formatMessage({ id: 'skillDetail.run' })}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="ub gap8 ub-ver ub-f1" style={{ marginTop: 16 }}>
                <div className={classNames(styles.debugResultPanel, 'ub-f1')} style={{ marginTop: 0 }}>
                  {result ? (
                    <pre className={styles.debugCodeBlock}>{result}</pre>
                  ) : (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description={intl.formatMessage({ id: 'common.noData' })}
                    />
                  )}
                  {result && (
                    <Button className={styles.debugCopyButton} size="small" onClick={() => copyDebugContent(result)}>
                      {intl.formatMessage({ id: 'common.copy' })}
                    </Button>
                  )}
                </div>
                <div className="ub ub-pe gap8">
                  <Button onClick={resetForm}>{intl.formatMessage({ id: 'common.reset' })}</Button>
                </div>
              </div>
            )
          ) : (
            <div style={{ marginTop: 16 }}>
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={intl.formatMessage({ id: 'common.noData' })} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MCPTestPanel;
