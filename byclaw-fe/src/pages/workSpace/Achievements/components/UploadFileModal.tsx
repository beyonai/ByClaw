import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Form, Upload, ModalProps, UploadProps, FormInstance, Spin, message } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import { RcFile } from 'antd/es/upload';
// @ts-ignore
import { useIntl, getIntl } from '@umijs/max';
import { uploadFile } from '@/service/workSpace';

interface UploadFileModalProps extends ModalProps {
  onOk?: () => void;
  onSubmit?: (files: RcFile[], form: FormInstance) => Promise<boolean>;
  uploadProps?: UploadProps;
}

export default function UploadFileModal(props: UploadFileModalProps) {
  const intl = useIntl();
  const { title, uploadProps, onSubmit, onOk, ...modalProps } = props;
  const [fileList, setFileList] = useState<RcFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();

  const beforeUpload = (file: RcFile) => {
    setFileList((v) => [...v, file]);
    return false;
  };

  const handleSubmit = async () => {
    setLoading(true);
    const pass = (await onSubmit?.(fileList, form)) ?? true;
    setLoading(false);
    if (pass) {
      setFileList([]);
      form.resetFields();
      onOk?.();
    }
  };

  useEffect(() => {
    return () => {
      setFileList([]);
      form.resetFields();
    };
  }, []);

  return (
    <Modal
      title={title || intl.formatMessage({ id: 'workSpace.uploadFileModal.title' })}
      {...modalProps}
      onOk={handleSubmit}
      okButtonProps={{ loading, disabled: !fileList.length || loading }}
    >
      <Spin spinning={loading} style={{ paddingTop: 16 }}>
        <Form form={form}>
          <Form.Item name="files">
            <Upload.Dragger {...uploadProps} fileList={fileList} beforeUpload={beforeUpload}>
              <p style={{ marginBottom: 12 }}>
                <InboxOutlined style={{ fontSize: 36, color: '#165dff' }} />
              </p>
              <p style={{ lineHeight: 1.8, color: '#00000073' }}>
                {intl.formatMessage({ id: 'workSpace.uploadFileModal.dragText' })}
              </p>
              <p style={{ lineHeight: 1.8, color: '#00000073' }}>
                {intl.formatMessage({ id: 'workSpace.uploadFileModal.supportText' })}
              </p>
            </Upload.Dragger>
          </Form.Item>
        </Form>
      </Spin>
    </Modal>
  );
}

type useUploadFileModalParam = UploadFileModalProps & {
  taskId?: string;
  sessionId?: string;
  taskCatalogId?: string;
};

export function useUploadFileModal() {
  const [attrs, setAttrs] = useState<[a: useUploadFileModalParam, f?: (v: boolean) => void]>([{}]);

  const show = useRef((props: useUploadFileModalParam) => {
    const task = new Promise<boolean>((resolve) => {
      setAttrs([props, resolve]);
    });
    return task;
  });

  const hide = useRef(() => {});

  const holder = useMemo(() => {
    const intl = getIntl();
    const [props, resolve] = attrs;
    const { taskId, sessionId, taskCatalogId, ...rest } = props;
    const onOk = () => {
      setAttrs([{}]);
    };

    const onSubmit = async (files: RcFile[]) => {
      if (!taskId || !sessionId || !taskCatalogId) return false;

      const formData = new FormData();
      formData.append('taskId', taskId);
      formData.append('sessionId', sessionId);
      formData.append('taskCatalogId', taskCatalogId);

      files.forEach((file) => {
        formData.append('files', file);
      });

      const res = await uploadFile(formData);
      if (res?.failedFiles?.length) {
        res.failedFiles.forEach((item: any) => {
          message.error(
            intl.formatMessage(
              { id: 'workSpace.uploadFileModal.uploadFailed' },
              { fileName: item.fileName, msg: item.msg }
            )
          );
        });
        resolve?.(false);
        return false;
      }
      if (res?.successFiles?.length) {
        const fileName = res.successFiles.reduce((acc: string, curr: any) => {
          const separator = intl.formatMessage({ id: 'workSpace.uploadFileModal.fileNameSeparator' });
          return `${acc}${acc ? separator : ''}${curr.fileName}`;
        }, '');
        message.success(intl.formatMessage({ id: 'workSpace.uploadFileModal.uploadSuccess' }, { fileName }));
        resolve?.(true);
      }

      return true;
    };

    return (
      <UploadFileModal {...rest} onOk={onOk} open={!!resolve} onCancel={onOk} onSubmit={onSubmit} destroyOnHidden />
    );
  }, [attrs]);

  return {
    show: show.current,
    hide: hide.current,
    holder,
  };
}
