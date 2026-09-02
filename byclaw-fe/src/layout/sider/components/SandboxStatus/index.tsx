import React, { useState } from 'react';
import { Dropdown, Tooltip, message, Modal } from 'antd';
import type { MenuProps } from 'antd';
import { useIntl } from '@umijs/max';
import classNames from 'classnames';
import type { SandboxInfo } from '@/service/sandbox';
import useSandboxStatus from './useSandboxStatus';
import {
  getSandboxItemStatus,
  getWorkerLivenessStatus,
  summarizeSandboxes,
  type SandboxAggregateStatus,
} from './statusUtils';
import styles from './styles.module.less';

interface SandboxStatusIndicatorProps {
  userCode: string;
  className?: string;
  style?: React.CSSProperties;
}

const SandboxStatusIndicator: React.FC<SandboxStatusIndicatorProps> = ({ userCode, className, style }) => {
  const intl = useIntl();
  const { status, sandboxes, refetch, restartSandbox } = useSandboxStatus(userCode);
  const [isRestarting, setIsRestarting] = useState(false);
  const [restartTarget, setRestartTarget] = useState<SandboxInfo | null>(null);
  const summary = summarizeSandboxes(sandboxes);

  const handleRestartConfirm = async () => {
    if (!restartTarget) return;
    setIsRestarting(true);
    try {
      await restartSandbox(restartTarget);
      message.success(intl.formatMessage({ id: 'sandbox.restart.success' }));
      setRestartTarget(null);
      refetch();
    } catch (error) {
      message.error(intl.formatMessage({ id: 'sandbox.restart.failed' }));
    } finally {
      setIsRestarting(false);
    }
  };

  const handleRestart = (sandbox: SandboxInfo) => {
    setRestartTarget(sandbox);
  };

  const getItemStatusText = (itemStatus: SandboxAggregateStatus) =>
    intl.formatMessage({ id: `sandbox.status.${itemStatus}` });

  let menuItems: MenuProps['items'];
  if (sandboxes.length) {
    menuItems = sandboxes.map((sandbox) => {
      const itemStatus = getSandboxItemStatus(sandbox);
      const workerStatus = getWorkerLivenessStatus(sandbox);
      return {
        key: `${sandbox.sandboxType}-${sandbox.sandboxId}`,
        label: (
          <div className={styles.serviceItem}>
            <span
              className={classNames(styles.serviceStatusDot, {
                [styles.running]: itemStatus === 'running',
                [styles.transitioning]: itemStatus === 'transitioning',
                [styles.stopped]: itemStatus === 'stopped',
              })}
            />
            <span className={styles.serviceName}>{sandbox.sandboxType}</span>
            <span className={styles.serviceState}>{getItemStatusText(itemStatus)}</span>
            <span className={styles.workerState}>{intl.formatMessage({ id: `sandbox.worker.${workerStatus}` })}</span>
            <span className={styles.serviceAction}>{intl.formatMessage({ id: 'sandbox.action.restart' })}</span>
          </div>
        ),
        onClick: () => handleRestart(sandbox),
        disabled: isRestarting || itemStatus === 'transitioning',
      };
    });
  } else {
    menuItems = [
      {
        key: 'empty',
        label: intl.formatMessage({ id: 'sandbox.status.noServices' }),
        disabled: true,
      },
    ];
  }

  const getStatusText = () => {
    if (summary.total > 1) {
      return intl.formatMessage(
        { id: 'sandbox.status.summary' },
        { running: summary.running, transitioning: summary.transitioning, total: summary.total }
      );
    }
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
        open={!!restartTarget}
        onOk={handleRestartConfirm}
        onCancel={() => setRestartTarget(null)}
        okText={intl.formatMessage({ id: 'sandbox.restart.confirm.ok' })}
        cancelText={intl.formatMessage({ id: 'sandbox.restart.confirm.cancel' })}
        confirmLoading={isRestarting}
        cancelButtonProps={{ disabled: isRestarting }}
        maskClosable={!isRestarting}
        closable={!isRestarting}
      >
        {intl.formatMessage(
          { id: 'sandbox.restart.confirm.content' },
          { sandboxType: restartTarget?.sandboxType || '' }
        )}
      </Modal>
    </>
  );
};

export default SandboxStatusIndicator;
