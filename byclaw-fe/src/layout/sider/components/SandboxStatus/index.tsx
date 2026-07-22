import React, { useState } from 'react';
import { Dropdown, Tooltip, message, Modal } from 'antd';
import type { MenuProps } from 'antd';
import { useIntl } from '@umijs/max';
import classNames from 'classnames';
import useSandboxStatus from './useSandboxStatus';
import styles from './styles.module.less';

interface SandboxStatusIndicatorProps {
  userCode: string;
  className?: string;
  style?: React.CSSProperties;
}

const SandboxStatusIndicator: React.FC<SandboxStatusIndicatorProps> = ({ userCode, className, style }) => {
  const intl = useIntl();
  const { status, refetch, restartSandbox } = useSandboxStatus(userCode);
  const [isRestarting, setIsRestarting] = useState(false);
  const [confirmModalVisible, setConfirmModalVisible] = useState(false);

  const handleRestartConfirm = async () => {
    setIsRestarting(true);
    try {
      await restartSandbox();
      message.success(intl.formatMessage({ id: 'sandbox.restart.success' }));
      setConfirmModalVisible(false);
      refetch();
    } catch (error) {
      message.error(intl.formatMessage({ id: 'sandbox.restart.failed' }));
    } finally {
      setIsRestarting(false);
    }
  };

  const handleRestart = () => {
    setConfirmModalVisible(true);
  };

  const menuItems: MenuProps['items'] = [
    {
      key: 'restart',
      label: intl.formatMessage({ id: 'sandbox.action.restart' }),
      onClick: handleRestart,
      disabled: isRestarting,
    },
  ];

  const getStatusText = () => {
    switch (status) {
      case 'running':
        return intl.formatMessage({ id: 'sandbox.status.running' });
      case 'transitioning':
        return intl.formatMessage({ id: 'sandbox.status.transitioning' });
      case 'stopped':
        return intl.formatMessage({ id: 'sandbox.status.stopped' });
      default:
        return '';
    }
  };

  const statusDotClass = classNames(styles.statusDot, {
    [styles.running]: status === 'running',
    [styles.transitioning]: status === 'transitioning',
    [styles.stopped]: status === 'stopped',
  });

  return (
    <>
      <Dropdown menu={{ items: menuItems }} placement="topRight" trigger={['click']}>
        <Tooltip placement="right" title={getStatusText()}>
          <div className={classNames(styles.sandboxStatusWrap, className)} style={style}>
            <div className={statusDotClass} />
          </div>
        </Tooltip>
      </Dropdown>
      <Modal
        title={intl.formatMessage({ id: 'sandbox.restart.confirm.title' })}
        open={confirmModalVisible}
        onOk={handleRestartConfirm}
        onCancel={() => setConfirmModalVisible(false)}
        okText={intl.formatMessage({ id: 'sandbox.restart.confirm.ok' })}
        cancelText={intl.formatMessage({ id: 'sandbox.restart.confirm.cancel' })}
        confirmLoading={isRestarting}
        cancelButtonProps={{ disabled: isRestarting }}
        maskClosable={!isRestarting}
        closable={!isRestarting}
      >
        {intl.formatMessage({ id: 'sandbox.restart.confirm.content' })}
      </Modal>
    </>
  );
};

export default SandboxStatusIndicator;
