import React, { useEffect } from 'react';
import { Drawer, Form, Input, Button, message, Space, Spin } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import { saveSystemConfigList, updateSystemConfigList, getByParamGroupCode } from '@/pages/manager/service/System';

type SystemParamsItem = {
  paramGroupCode: string;
  paramGroupName: string;
  cacheJson: string;
};

type ParameterItem = {
  paramGroupName: string;
  paramGroupCode: string;
  byaiSystemConfigLists: {
    paramCode: string;
    paramName: string;
    paramEnName: string;
    paramValue: string;
    paramDesc: string;
    paramSeq: number;
  }[];
};

export default function StaticsDrawer(props: {
  open: boolean;
  onClose: () => void;
  record: SystemParamsItem | null;
  onSuccess?: (isEdit: boolean) => void;
}) {
  const { open, onClose, record, onSuccess } = props;
  const intl = useIntl();
  const [form] = Form.useForm();
  const [confirmLoading, setConfirmLoading] = React.useState(false);

  const [loading, setLoading] = React.useState(false);

  const isEdit = !!record;

  const myGetByParamGroupCode = React.useCallback(async (paramGroupCode: string) => {
    setLoading(true);
    try {
      const res = await getByParamGroupCode({ paramGroupCode });
      if (`${res?.code}` === '0') {
        return res.data;
      }
      return null;
    } catch (error) {
      console.error(intl.formatMessage({ id: 'SystemParams.common.getDataFail' }), error);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  // 初始化表单数据
  useEffect(() => {
    if (open) {
      if (record) {
        // 编辑模式：获取详细数据
        myGetByParamGroupCode(record.paramGroupCode).then((data: ParameterItem | null) => {
          if (data) {
            // 将后端数据转换为表单格式
            const formParameters = (data.byaiSystemConfigLists || []).map((item) => ({
              paramCode: item.paramCode || '',
              paramName: item.paramName || '',
              paramEnName: item.paramEnName || '',
              paramValue: item.paramValue || '',
              paramSeq: `${item.paramSeq || ''}`, // 如果没有顺序字段，使用索引+1
              description: item.paramDesc || '',
            }));

            form.setFieldsValue({
              paramGroupName: data.paramGroupName || '',
              paramGroupCode: data.paramGroupCode || '',
              parameters:
                formParameters.length > 0
                  ? formParameters
                  : [{ paramCode: '', paramName: '', paramEnName: '', paramValue: '', paramSeq: '', description: '' }],
            });
          } else {
            // 如果获取失败，使用record的基础信息
            form.setFieldsValue({
              paramGroupName: record.paramGroupName || '',
              paramGroupCode: record.paramGroupCode || '',
              parameters: [
                { paramCode: '', paramName: '', paramEnName: '', paramValue: '', paramSeq: '', description: '' },
              ],
            });
          }
        });
      } else {
        // 新增模式：初始化空表单
        form.setFieldsValue({
          paramGroupName: '',
          paramGroupCode: '',
          parameters: [
            { paramCode: '', paramName: '', paramEnName: '', paramValue: '', paramSeq: '', description: '' },
          ],
        });
      }
    } else {
      // 关闭时重置
      form.resetFields();
    }
  }, [open, record, form, myGetByParamGroupCode]);

  // 提交表单
  const onFinish = async (values: any) => {
    setConfirmLoading(true);
    try {
      const parametersList = values.parameters || [];

      // 验证所有参数项的必填字段
      const emptyItems: number[] = [];
      parametersList.forEach((item: any, index: number) => {
        const paramName = item?.paramName?.trim();
        const paramSeq = item?.paramSeq;

        if (!paramName || !paramSeq) {
          emptyItems.push(index + 1);
        }
      });

      // 如果有空的参数项，停止保存并提示
      if (emptyItems.length > 0) {
        message.error(
          intl.formatMessage({ id: 'SystemParams.staticsDrawer.missingRequiredInfo' }, { items: emptyItems.join('、') })
        );
        setConfirmLoading(false);
        return;
      }

      // 所有参数项都完整，转换为后端需要的格式
      const parameters = parametersList.map((item: any) => ({
        paramCode: item.paramCode, // 如果没有编码，生成一个
        paramName: item.paramName || '',
        paramEnName: item.paramEnName || '',
        paramValue: item.paramValue || '',
        paramDesc: item.description || '',
        paramSeq: item.paramSeq,
        // 注意：parentParamValue 和 paramSeq 如果后端不需要，可以不传
      }));

      const params = {
        paramGroupName: values.paramGroupName,
        paramGroupCode: values.paramGroupCode,
        byaiSystemConfigLists: parameters,
      };

      let res;
      if (record) {
        // 编辑模式：保持原编码不变
        res = await updateSystemConfigList({
          ...params,
          paramGroupCode: record.paramGroupCode,
        });
      } else {
        // 新增模式
        res = await saveSystemConfigList(params);
      }

      if (`${res?.code}` === '0') {
        message.success(res.msg || intl.formatMessage({ id: 'SystemParams.common.operationSuccess' }));
        // 触发父组件刷新列表
        if (onSuccess) {
          onSuccess(isEdit);
        }
      } else {
        message.error(res?.msg || intl.formatMessage({ id: 'SystemParams.common.operationFail' }));
      }
    } catch (error) {
      console.error(intl.formatMessage({ id: 'SystemParams.common.submitFail' }), error);
      message.error(intl.formatMessage({ id: 'SystemParams.common.operationFailRetry' }));
    } finally {
      setConfirmLoading(false);
    }
  };

  const handleClose = () => {
    form.resetFields();
    onClose();
  };

  // 检查是否存在空的参数项
  const checkEmptyParameters = (): boolean => {
    const parameters = form.getFieldValue('parameters') || [];
    // 检查是否有必填字段为空的项
    const hasEmpty = parameters.some((item: any) => {
      // 检查必填字段：paramName 和 paramSeq
      const paramName = item?.paramName?.trim();
      const paramSeq = item?.paramSeq;
      return !paramName || !paramSeq;
    });
    return hasEmpty;
  };

  // 处理新增参数项
  const handleAddParameter = (add: (defaultValue?: any) => void) => {
    // 检查是否存在空的参数项
    if (checkEmptyParameters()) {
      message.warning(intl.formatMessage({ id: 'SystemParams.staticsDrawer.completeRequiredInfo' }));
      return;
    }
    // 如果没有空的参数项，允许添加新行
    add({ paramCode: '', paramName: '', paramEnName: '', paramValue: '', paramSeq: '', description: '' });
  };

  return (
    <Drawer
      title={
        record
          ? intl.formatMessage({ id: 'SystemParams.params.edit' })
          : intl.formatMessage({ id: 'SystemParams.params.add' })
      }
      open={open}
      onClose={handleClose}
      width={'80%'}
      destroyOnClose
      footer={
        <div style={{ textAlign: 'right' }}>
          <Space>
            <Button onClick={handleClose}>{intl.formatMessage({ id: 'SystemParams.params.cancel' })}</Button>
            <Button type="primary" loading={confirmLoading} onClick={() => form.submit()}>
              {intl.formatMessage({ id: 'SystemParams.common.confirm' })}
            </Button>
          </Space>
        </div>
      }
    >
      <Spin spinning={loading}>
        <Form form={form} layout="vertical" onFinish={onFinish} style={{ padding: '0 16px' }}>
          {/* 基本信息区域 */}
          <div>
            <Form.Item
              label={<span>{intl.formatMessage({ id: 'SystemParams.staticsDrawer.staticDataName' })}</span>}
              name="paramGroupName"
              rules={[
                {
                  required: true,
                  message: intl.formatMessage({ id: 'SystemParams.staticsDrawer.staticDataNamePlaceholder' }),
                },
              ]}
              style={{ display: 'inline-block', width: 'calc(33.33% - 16px)', marginRight: 24 }}
            >
              <Input placeholder={intl.formatMessage({ id: 'SystemParams.staticsDrawer.staticDataNamePlaceholder' })} />
            </Form.Item>
            <Form.Item
              label={<span>{intl.formatMessage({ id: 'SystemParams.params.code' })}</span>}
              name="paramGroupCode"
              rules={[
                { required: true, message: intl.formatMessage({ id: 'SystemParams.staticsDrawer.codePlaceholder' }) },
              ]}
              style={{ display: 'inline-block', width: 'calc(33.33% - 16px)', marginRight: 24 }}
            >
              <Input
                placeholder={intl.formatMessage({ id: 'SystemParams.staticsDrawer.codePlaceholder' })}
                disabled={!!record}
              />
            </Form.Item>
          </div>

          {/* 参数列表区域 */}
          <div>
            <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 16 }}>
              {intl.formatMessage({ id: 'SystemParams.staticsDrawer.parameterList' })}
            </div>
            <Form.List name="parameters">
              {(fields, { add, remove }) => (
                <>
                  {fields.map((field) => (
                    <div
                      key={field.key}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        marginBottom: 16,
                        padding: 16,
                        backgroundColor: '#fafafa',
                        borderRadius: 4,
                      }}
                    >
                      <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 16 }}>
                        <Form.Item
                          {...field}
                          label={<span>{intl.formatMessage({ id: 'SystemParams.createModal.paramName' })}</span>}
                          name={[field.name, 'paramName']}
                          rules={[
                            {
                              required: true,
                              message: intl.formatMessage({ id: 'SystemParams.createModal.paramNamePlaceholder' }),
                            },
                          ]}
                          style={{ width: 'calc(20% - 12.8px)', marginBottom: 0 }}
                        >
                          <Input
                            placeholder={intl.formatMessage({ id: 'SystemParams.createModal.paramNamePlaceholder' })}
                          />
                        </Form.Item>
                        <Form.Item
                          {...field}
                          label={<span>{intl.formatMessage({ id: 'SystemParams.createModal.paramEnName' })}</span>}
                          name={[field.name, 'paramEnName']}
                          rules={[
                            {
                              required: true,
                              message: intl.formatMessage({ id: 'SystemParams.createModal.paramEnNamePlaceholder' }),
                            },
                          ]}
                          style={{ width: 'calc(20% - 12.8px)', marginBottom: 0 }}
                        >
                          <Input
                            placeholder={intl.formatMessage({ id: 'SystemParams.createModal.paramEnNamePlaceholder' })}
                          />
                        </Form.Item>
                        <Form.Item
                          {...field}
                          label={intl.formatMessage({ id: 'SystemParams.createModal.paramValue' })}
                          name={[field.name, 'paramValue']}
                          style={{ width: 'calc(20% - 12.8px)', marginBottom: 0 }}
                        >
                          <Input
                            placeholder={intl.formatMessage({ id: 'SystemParams.createModal.paramValuePlaceholder' })}
                          />
                        </Form.Item>
                        <Form.Item
                          {...field}
                          label={<span>{intl.formatMessage({ id: 'SystemParams.staticsDrawer.paramSeq' })}</span>}
                          name={[field.name, 'paramSeq']}
                          rules={[
                            {
                              required: true,
                              message: intl.formatMessage({ id: 'SystemParams.staticsDrawer.paramSeqPlaceholder' }),
                            },
                          ]}
                          style={{ width: 'calc(20% - 12.8px)', marginBottom: 0 }}
                        >
                          <Input
                            type="number"
                            placeholder={intl.formatMessage({ id: 'SystemParams.staticsDrawer.paramSeqPlaceholder' })}
                          />
                        </Form.Item>
                        <Form.Item
                          {...field}
                          label={intl.formatMessage({ id: 'SystemParams.params.desc' })}
                          name={[field.name, 'description']}
                          style={{ width: 'calc(20% - 12.8px)', marginBottom: 0 }}
                        >
                          <Input
                            placeholder={intl.formatMessage({ id: 'SystemParams.staticsDrawer.descPlaceholder' })}
                          />
                        </Form.Item>
                        {/* 隐藏字段：用于保存paramCode和paramEnName */}
                        <Form.Item {...field} name={[field.name, 'paramCode']} style={{ display: 'none' }}>
                          <Input type="hidden" />
                        </Form.Item>
                      </div>
                      <Button
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => remove(field.name)}
                        style={{ marginLeft: 8, marginTop: 35 }}
                      />
                    </div>
                  ))}
                  <Form.Item>
                    <Button
                      type="dashed"
                      onClick={() => handleAddParameter(add)}
                      block
                      icon={<PlusOutlined />}
                      style={{ marginTop: 16 }}
                    >
                      {intl.formatMessage({ id: 'SystemParams.params.add' })}
                    </Button>
                  </Form.Item>
                </>
              )}
            </Form.List>
          </div>
        </Form>
      </Spin>
    </Drawer>
  );
}
