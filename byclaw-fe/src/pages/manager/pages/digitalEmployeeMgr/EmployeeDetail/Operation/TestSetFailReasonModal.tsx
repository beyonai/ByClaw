// @ts-nocheck
import React from 'react';
import { Modal } from 'antd';
import { useIntl } from '@umijs/max';
import { ExclamationCircleOutlined } from '@ant-design/icons';
import styles from './TestSetFailReasonModal.module.less';

interface TestSetFailReasonModalProps {
  visible: boolean;
  onCancel: () => void;
  failReason?: string | null;
}

/**
 * 测试集失败原因弹窗
 */
const TestSetFailReasonModal: React.FC<TestSetFailReasonModalProps> = ({ visible, onCancel, failReason }) => {
  const intl = useIntl();

  return (
    <Modal
      title={null}
      open={visible}
      onCancel={onCancel}
      footer={null}
      width={480}
      className={styles.failReasonModal}
      destroyOnHidden
      centered
    >
      <div className={styles.failReasonContent}>
        <div className={styles.failReasonIcon}>
          <ExclamationCircleOutlined style={{ fontSize: 48, color: '#FF7D00' }} />
        </div>
        <div className={styles.failReasonTitle}>{intl.formatMessage({ id: 'operation.testSetFailReason.title' })}</div>
        <div className={styles.failReasonText}>
          {failReason || intl.formatMessage({ id: 'operation.testSetFailReason.noReason' })}
        </div>
      </div>
    </Modal>
  );
};

export default TestSetFailReasonModal;
