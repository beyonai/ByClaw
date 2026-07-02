import React, { useState } from 'react';
import { Input, Modal } from 'antd';
// @ts-ignore
import { useIntl } from '@umijs/max';

interface RenameModalProps {
  open: boolean;
  currentName: string;
  onOk: (newName: string) => void;
  onCancel: () => void;
  loading?: boolean;
}

const RenameModal: React.FC<RenameModalProps> = ({ open, currentName, onOk, onCancel, loading }) => {
  const intl = useIntl();
  const [name, setName] = useState(currentName);

  React.useEffect(() => {
    if (open) setName(currentName);
  }, [open, currentName]);

  return (
    <Modal
      title={intl.formatMessage({ id: 'fileBrowser.rename.title' })}
      open={open}
      onOk={() => onOk(name.trim())}
      onCancel={onCancel}
      confirmLoading={loading}
      okButtonProps={{ disabled: !name.trim() || name.trim() === currentName }}
      destroyOnClose
    >
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={intl.formatMessage({ id: 'fileBrowser.rename.placeholder' })}
        onPressEnter={() => {
          if (name.trim() && name.trim() !== currentName) onOk(name.trim());
        }}
        autoFocus
      />
    </Modal>
  );
};

export default RenameModal;
