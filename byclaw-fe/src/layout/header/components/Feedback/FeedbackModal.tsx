import React, { useEffect, useState } from 'react';
import { Form, Input, message, Modal, ModalProps, Select, Spin, Upload } from 'antd';
import { useIntl } from '@umijs/max';
import { sendFeedback, uploadFeedbackFile } from '@/service/feedback';

const normalizeUploadFileList = (event: any) => (Array.isArray(event) ? event : event?.fileList || []);

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
    if (!values) {
      return;
    }
    setLoading(true);
    try {
      if (files?.length > 0) {
        const uploadFiles = files.map((file: any) => file?.originFileObj || file).filter(Boolean);
        if (uploadFiles.length !== files.length) {
          throw new Error(intl.formatMessage({ id: 'feedbackModal.uploadFailed' }));
        }
        const formData = new FormData();
        uploadFiles.forEach((file: File) => formData.append('files', file));
        const res = await uploadFeedbackFile(formData);
        const successFiles = res?.data?.successFiles;
        if (res?.code !== 0 || !Array.isArray(successFiles) || successFiles.length !== uploadFiles.length) {
          throw new Error(res?.msg || intl.formatMessage({ id: 'feedbackModal.uploadFailed' }));
        }
        values.attachFileIds = successFiles.map((item: any) => item.attachFileId);
      }

      const res = await sendFeedback({ ...values, userId });
      if (res?.code !== 0) {
        throw new Error(res?.msg || intl.formatMessage({ id: 'common.systemErrorRetry' }));
      }
      message.success(intl.formatMessage({ id: 'feedbackModal.success' }));
      onCancel?.();
    } catch (error) {
      message.error(error instanceof Error ? error.message : intl.formatMessage({ id: 'common.systemErrorRetry' }));
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
          <Form.Item
            name="files"
            label={intl.formatMessage({ id: 'feedbackModal.files' })}
            valuePropName="fileList"
            getValueFromEvent={normalizeUploadFileList}
          >
            <Upload.Dragger multiple beforeUpload={() => false} maxCount={3}>
              <div>{intl.formatMessage({ id: 'common.upload' })}</div>
            </Upload.Dragger>
          </Form.Item>
        </Form>
      </Spin>
    </Modal>
  );
}
