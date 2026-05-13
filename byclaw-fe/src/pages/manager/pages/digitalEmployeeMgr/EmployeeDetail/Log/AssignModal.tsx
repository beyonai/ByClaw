// @ts-nocheck
import React, { useState, useEffect, useCallback } from 'react';
import { Modal, Form, Select, Input, message } from 'antd';
import { useIntl } from '@umijs/max';
import { listAuthDetail } from '@/pages/manager/service/DigitalResourceMgr';
import { messageFeedbackAssign } from '@/pages/manager/service/ConversationMgr';

const { TextArea } = Input;

interface AssignModalProps {
  visible: boolean;
  agentId?: string;
  record?: any;
  onCancel: () => void;
  onOk: (values: { handlerId: number; reason: string }) => void;
}

/**
 * 指派弹窗组件
 * @param visible 是否显示
 * @param agentId 数字员工ID
 * @param record 当前记录
 * @param onCancel 取消回调
 * @param onOk 确认回调
 */
const AssignModal: React.FC<AssignModalProps> = ({ visible, agentId, record, onCancel, onOk }) => {
  const intl = useIntl();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [handlerOptions, setHandlerOptions] = useState<{ label: string; value: number }[]>([]);
  const [fetching, setFetching] = useState(false);

  /**
   * 获取处理人列表
   */
  const fetchHandlerList = useCallback(async () => {
    if (!agentId) {
      message.warning(intl.formatMessage({ id: 'employeeDetail.missingAgentId' }));
      return;
    }

    setFetching(true);
    try {
      const res = await listAuthDetail({
        grantType: 'ALLOW_MANAGE',
        grantObjType: 'DIG_EMPLOYEE',
        grantObjId: agentId,
      });

      if (res.code === 0 && res.data?.redList) {
        const options = res.data.redList.map((item: any) => ({
          label: item.grantToObjName,
          value: item.grantToObjId,
        }));
        setHandlerOptions(options);
      } else {
        message.error(res?.msg || intl.formatMessage({ id: 'employeeDetail.fetchHandlerListFail' }));
        setHandlerOptions([]);
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(intl.formatMessage({ id: 'employeeDetail.fetchHandlerListFail' }), error);
      message.error(intl.formatMessage({ id: 'employeeDetail.fetchHandlerListFail' }));
      setHandlerOptions([]);
    } finally {
      setFetching(false);
    }
  }, [agentId, intl]);

  /**
   * 弹窗打开时获取处理人列表
   */
  useEffect(() => {
    if (visible && agentId) {
      fetchHandlerList();
      form.resetFields();
    }
    // form 是稳定的引用，不需要添加到依赖项中
  }, [visible, fetchHandlerList, agentId]);

  /**
   * 确认提交
   */
  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      if (!agentId || !record) {
        message.error(intl.formatMessage({ id: 'employeeDetail.missingAgentId' }));
        return;
      }

      setLoading(true);
      try {
        // 调用指派接口
        const params: {
          resourceId: string | number;
          relId: number;
          resMsgId: number | string;
          askMsgId: number | string;
          feedbackLabel?: any;
          feedbackContent?: string;
          assignerIds: number[];
          assignReason: string;
        } = {
          resourceId: agentId,
          relId: record.relId,
          resMsgId: record.resMsgId,
          askMsgId: record.askMsgId,
          assignerIds: [values.handlerId],
          assignReason: values.reason,
        };

        // 可选字段
        if (record.feedbackLabels) {
          params.feedbackLabel = record.feedbackLabels?.join(',');
        }
        if (record.feedbackContent) {
          params.feedbackContent = record.feedbackContent;
        }

        const res = await messageFeedbackAssign(params);

        if (res.code === 0) {
          setLoading(false);
          message.success(intl.formatMessage({ id: 'employeeDetail.assignSuccess' }));
          form.resetFields();
          // 成功后才调用 onOk，触发父组件关闭弹窗和刷新列表
          onOk(values);
        } else {
          setLoading(false);
          message.error(res?.msg || intl.formatMessage({ id: 'employeeDetail.assignFail' }));
        }
      } catch (error) {
        setLoading(false);
        // eslint-disable-next-line no-console
        console.error('指派失败:', error);
        message.error(intl.formatMessage({ id: 'employeeDetail.assignFail' }));
      }
    } catch (error) {
      // 表单验证失败
      // eslint-disable-next-line no-console
      console.error('表单验证失败:', error);
      setLoading(false);
    }
  };

  /**
   * 取消
   */
  const handleCancel = () => {
    form.resetFields();
    onCancel();
  };

  return (
    <Modal
      title={intl.formatMessage({ id: 'employeeDetail.assign' })}
      visible={visible}
      onOk={handleOk}
      onCancel={handleCancel}
      confirmLoading={loading}
      width={520}
      destroyOnHidden
    >
      <Form form={form} layout="vertical">
        <Form.Item
          label={intl.formatMessage({ id: 'employeeDetail.handler' })}
          name="handlerId"
          rules={[
            {
              required: true,
              message: intl.formatMessage({ id: 'employeeDetail.handlerRequired' }),
            },
          ]}
        >
          <Select
            placeholder={intl.formatMessage({ id: 'employeeDetail.selectHandler' })}
            loading={fetching}
            allowClear
            showSearch
            filterOption={(input, option) => {
              const label = option?.children || '';
              const value = option?.value || '';
              return (
                String(label).toLowerCase().includes(input.toLowerCase()) ||
                String(value).toLowerCase().includes(input.toLowerCase())
              );
            }}
          >
            {handlerOptions.map((item) => (
              <Select.Option key={item.value} value={item.value}>
                {item.label}
              </Select.Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item
          label={intl.formatMessage({ id: 'employeeDetail.reason' })}
          name="reason"
          rules={[
            {
              required: true,
              message: intl.formatMessage({ id: 'employeeDetail.reasonRequired' }),
            },
          ]}
        >
          <TextArea
            placeholder={intl.formatMessage({ id: 'employeeDetail.inputReason' })}
            rows={4}
            maxLength={500}
            showCount
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default AssignModal;
