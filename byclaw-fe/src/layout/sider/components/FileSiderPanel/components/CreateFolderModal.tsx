import React from 'react';
import { Input, Modal } from 'antd';
import { useIntl } from '@umijs/max';

interface CreateFolderModalProps {
  open: boolean;
  value: string;
  loading: boolean;
  onChange: (value: string) => void;
  onOk: () => void;
  onCancel: () => void;
}

const CreateFolderModal: React.FC<CreateFolderModalProps> = ({ open, value, loading, onChange, onOk, onCancel }) => {
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
      <Input
        value={value}
        placeholder={intl.formatMessage({ id: 'fileBrowser.createFolder.prompt' })}
        onChange={(event) => onChange(event.target.value)}
        onPressEnter={onOk}
        maxLength={100}
      />
    </Modal>
  );
};

export default CreateFolderModal;
