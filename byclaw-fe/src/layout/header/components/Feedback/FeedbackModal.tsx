import React, { useEffect, useState } from 'react';
import { Form, Input, message, Modal, ModalProps, Select, Spin, Upload } from 'antd';
import { useControllableValue } from 'ahooks';
import { useIntl } from '@umijs/max';
import { sendFeedback, uploadFeedbackFile } from '@/service/feedback';

interface UploadFileProps {
  // eslint-disable-next-line react/no-unused-prop-types
  value?: (string | File)[];
  // eslint-disable-next-line react/no-unused-prop-types
  onChange?: (value: (string | File)[]) => void;
}

const UploadFile = (props: UploadFileProps) => {
  const [value, setValue] = useControllableValue(props);
  const intl = useIntl();

  const handleBeforeUpload = () => {
    return false;
  };

  const handleChange = ({ fileList }: any) => {
    setValue(fileList);
  };

  useEffect(() => {
    console.log(value, 'value');
  }, [value]);

  return (
    <Upload.Dragger multiple beforeUpload={handleBeforeUpload} onChange={handleChange} maxCount={3}>
      <div>{intl.formatMessage({ id: 'common.upload' })}</div>
    </Upload.Dragger>
  );
};

interface FeedbackModalProps extends ModalProps {
  userId: string;
  onCancel?: () => void;
}

export default function FeedbackModal(props: FeedbackModalProps) {
  const { userId, onCancel, open, ...rest } = props;
  const intl = useIntl();
  const [loading, setLoading] = useState(false);

  const [form] = Form.useForm();

  const handleSubmit = async () => {
    const { files, ...values } = await form.validateFields();
    if (!values) return;
    setLoading(true);
    if (files?.length > 0) {
      const formData = new FormData();
      files.forEach((file: any) => {
        formData.append('files', file.originFileObj);
      });
      try {
        const res = await uploadFeedbackFile(formData);
        console.log(res, 'res111');
        if (res?.data?.successFiles?.length > 0) {
          values.fileIds = res.data.successFiles.map((item: any) => item.fileId);
          values.attachFileIds = res.data.successFiles.map((item: any) => item.attachFileId);
        }
      } catch (error) {
        message.error(error instanceof Error ? error.message : String(error));
        return;
      } finally {
        setLoading(false);
      }
    }
    try {
      const res = await sendFeedback({ ...values, userId });
      if (res.code === 0) {
        message.success(intl.formatMessage({ id: 'feedbackModal.success' }));
        onCancel?.();
      }
    } catch (error) {
      message.warning(intl.formatMessage({ id: 'common.systemErrorRetry' }));
    } finally {
      setLoading(false);
    }
  };

  useEffect(
    () => () => {
      form.resetFields();
    },
    [open]
  );

  return (
    <Modal
      title={intl.formatMessage({ id: 'contentHeader.feedback' })}
      width={720}
      destroyOnHidden
      {...rest}
      open={open}
      onCancel={onCancel}
      confirmLoading={loading}
      onOk={handleSubmit}
    >
      <Spin spinning={loading}>
        <Form layout="vertical" form={form}>
          <Form.Item
            name="feedbackType"
            label={intl.formatMessage({ id: 'feedbackModal.type' })}
            rules={[{ required: true, message: intl.formatMessage({ id: 'feedbackModal.typeTip' }) }]}
          >
            <Select
              placeholder={intl.formatMessage({ id: 'feedbackModal.typeTip' })}
              options={[
                { label: intl.formatMessage({ id: 'feedbackModal.type1' }), value: 'BUG' },
                { label: intl.formatMessage({ id: 'feedbackModal.type2' }), value: 'SUGGESTION' },
                { label: intl.formatMessage({ id: 'feedbackModal.type3' }), value: 'INQUIRY' },
                { label: intl.formatMessage({ id: 'feedbackModal.type4' }), value: 'OTHER' },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="title"
            label={intl.formatMessage({ id: 'feedbackModal.title' })}
            rules={[{ required: true, max: 100, message: intl.formatMessage({ id: 'feedbackModal.titleTip' }) }]}
          >
            <Input placeholder={intl.formatMessage({ id: 'feedbackModal.titleTip' })} />
          </Form.Item>
          <Form.Item
            name="content"
            label={intl.formatMessage({ id: 'feedbackModal.content' })}
            rules={[
              { required: true, message: intl.formatMessage({ id: 'feedbackModal.contentTip' }) },
              { max: 1000, message: intl.formatMessage({ id: 'feedbackModal.contentTip' }) },
              { min: 10, message: intl.formatMessage({ id: 'feedbackModal.contentTip' }) },
            ]}
          >
            <Input.TextArea
              rows={4}
              showCount
              maxLength={1000}
              placeholder={intl.formatMessage({ id: 'feedbackModal.contentTip' })}
            />
          </Form.Item>
          <Form.Item name="files" label={intl.formatMessage({ id: 'feedbackModal.files' })}>
            <UploadFile />
          </Form.Item>
        </Form>
      </Spin>
    </Modal>
  );
}
