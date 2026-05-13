import React, { useCallback, useState } from 'react';

// @ts-ignore
import { useIntl } from '@umijs/max';
import { Button, message } from 'antd';

import ModalDrawer from '@/components/ModalDrawer';
import useGlobal from '@/hooks/useGlobal';
import { applyResourceUse } from '@/pages/manager/service/resources';

export interface ApplyForModalProps {
  id: string;
  visible: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

const ApplyForModal: React.FC<ApplyForModalProps> = ({ id, visible, onClose, onSuccess }) => {
  const intl = useIntl();
  const [confirmLoading, setConfirmLoading] = useState(false);

  const { EventEmitter } = useGlobal();

  const handleSubmit = useCallback(async () => {
    setConfirmLoading(true);
    try {
      await applyResourceUse({ resourceId: id });
      message.success(intl.formatMessage({ id: 'digitalEmployees.applySuccess' }));

      EventEmitter.emit('beyond-update-employee', {
        ApplyList: [`${id}`],
      });

      onClose();
      onSuccess?.();
    } catch (error: any) {
      // error already handled by request interceptor
    } finally {
      setConfirmLoading(false);
    }
  }, [id, intl, EventEmitter, onClose, onSuccess]);

  return (
    <ModalDrawer
      destroyOnHidden
      maskClosable={false}
      closable={false}
      type="modal"
      title={intl.formatMessage({ id: 'digitalEmployees.applyFor' })}
      open={visible}
      showFoot={false}
      footer={
        <div className="full-width gap8 ub ub-ac ub-pe">
          <Button
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onClose();
            }}
          >
            {intl.formatMessage({ id: 'common.cancel' })}
          </Button>
          <Button
            size="small"
            type="primary"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              handleSubmit();
            }}
            loading={confirmLoading}
          >
            {intl.formatMessage({ id: 'common.confirm' })}
          </Button>
        </div>
      }
      confirmLoading={confirmLoading}
      width={520}
    >
      <div style={{ padding: '16px 0' }}>{intl.formatMessage({ id: 'digitalEmployees.applyConfirm' })}</div>
    </ModalDrawer>
  );
};

export default ApplyForModal;
