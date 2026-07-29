import React from 'react';
import { Form, Input, Modal } from 'antd';
import { useIntl } from '@umijs/max';

interface CreateFolderModalProps {
  open: boolean;
  value: string;
  error?: string;
  loading: boolean;
  onChange: (value: string) => void;
  onOk: () => void;
  onCancel: () => void;
}

const CreateFolderModal: React.FC<CreateFolderModalProps> = ({
  open,
  value,
  error,
  loading,
  onChange,
  onOk,
  onCancel,
}) => {
  const intl = useIntl();

  return (
    <Modal
      open={open}
      title={intl.formatMessage({ id: 'fileBrowser.toolbar.newFolder' })}
      okText={intl.formatMessage({ id: 'common.confirm' })}
      cancelText={intl.formatMessage({ id: 'common.cancel' })}
      confirmLoading={loading}
      onOk={onOk}
      onCancel={onCancel}
      destroyOnClose
    >
      <Form.Item validateStatus={error ? 'error' : undefined} help={error}>
        <Input
          value={value}
          placeholder={intl.formatMessage({ id: 'fileBrowser.createFolder.prompt' })}
          onChange={(event) => onChange(event.target.value)}
          onPressEnter={onOk}
          maxLength={100}
        />
      </Form.Item>
    </Modal>
  );
};

export default CreateFolderModal;
