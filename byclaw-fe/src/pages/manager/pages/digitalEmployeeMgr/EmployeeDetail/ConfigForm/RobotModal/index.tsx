import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Input, Form, Tabs, Tooltip } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';

import styles from './index.module.less';

const LabelWithTooltip = ({ label, tooltip }: { label: string; tooltip: string }) => (
  <span>
    {label}
    <Tooltip title={tooltip}>
      <QuestionCircleOutlined className={styles.tooltipIcon} />
    </Tooltip>
  </span>
);

type RobotConfig = {
  channel?: string;
  clientId?: string;
  clientSecret?: string;
  robotCode?: string;
  AICardId?: string;
};

type IProps = {
  open: boolean;
  setOpen: (open: boolean) => void;
  onOk: (item: RobotConfig) => void;

  robotChannelLabelMap: Record<string, string>;
  item: RobotConfig;
  isReadOnly: boolean;
};

function RobotModal(props: IProps) {
  const { open, setOpen, onOk, robotChannelLabelMap, item, isReadOnly } = props;
  const intl = useIntl();
  const { clientId } = item;
  const [form] = Form.useForm<RobotConfig>();
  const channelTabs = useMemo(() => {
    return Object.entries(robotChannelLabelMap).map(([key, label]) => ({
      key,
      label,
    }));
  }, [robotChannelLabelMap]);
  const [activeChannel, setActiveChannel] = useState(item.channel || '');
  const [channelFormCache, setChannelFormCache] = useState<Record<string, Partial<RobotConfig>>>({});

  useEffect(() => {
    if (!open) return;

    const nextChannel = item.channel || channelTabs[0]?.key || '';
    setActiveChannel(nextChannel);
    setChannelFormCache({
      [nextChannel]: {
        channel: nextChannel,
        clientId: item.clientId,
        clientSecret: item.clientSecret,
        robotCode: item.robotCode,
        AICardId: item.AICardId,
      },
    });

    form.setFieldsValue({
      channel: nextChannel,
      clientId: item.clientId,
      clientSecret: item.clientSecret,
      robotCode: item.robotCode,
      AICardId: item.AICardId,
    });
  }, [channelTabs, form, item, open]);

  const handleTabChange = (nextChannel: string) => {
    const currentValues = form.getFieldsValue();

    setChannelFormCache((prev) => {
      return {
        ...prev,
        [activeChannel]: {
          channel: activeChannel,
          ...prev[activeChannel],
          ...currentValues,
        },
      };
    });

    const nextValues = channelFormCache[nextChannel] || {};
    setActiveChannel(nextChannel);
    form.setFieldsValue({
      channel: nextChannel,
      clientId: nextValues.clientId || '',
      clientSecret: nextValues.clientSecret || '',
      robotCode: nextValues.robotCode || '',
      AICardId: nextValues.AICardId || '',
    });
  };

  const handleOk = async () => {
    const values = await form.validateFields();
    onOk({
      ...item,
      ...values,
      channel: activeChannel,
    });
  };

  return (
    <div>
      <Modal
        title={
          clientId
            ? intl.formatMessage({ id: 'digitalEmployeeMgr.editRobot' })
            : intl.formatMessage({ id: 'digitalEmployeeMgr.addRobot' })
        }
        open={open}
        onOk={handleOk}
        onCancel={() => setOpen(false)}
        okButtonProps={{ disabled: isReadOnly }}
        destroyOnHidden
        maskClosable={false}
      >
        {!isReadOnly && !clientId && channelTabs.length > 0 && (
          <Tabs
            size="small"
            // className={styles.robotCardHeader}
            activeKey={activeChannel}
            items={channelTabs}
            onChange={handleTabChange}
          />
        )}
        <Form form={form} layout="vertical" disabled={isReadOnly} preserve={false} className={styles.robotCardBody}>
          <Form.Item
            label={
              <LabelWithTooltip
                label={intl.formatMessage({ id: 'digitalEmployeeMgr.clientIdLabel' })}
                tooltip={intl.formatMessage({ id: 'digitalEmployeeMgr.clientIdTooltip' })}
              />
            }
            name="clientId"
            rules={[{ required: true, message: intl.formatMessage({ id: 'digitalEmployeeMgr.clientIdRequired' }) }]}
          >
            <Input className={styles.robotFieldControl} placeholder="" />
          </Form.Item>
          <Form.Item
            label={
              <LabelWithTooltip
                label={intl.formatMessage({ id: 'digitalEmployeeMgr.clientSecretLabel' })}
                tooltip={intl.formatMessage({ id: 'digitalEmployeeMgr.clientSecretTooltip' })}
              />
            }
            name="clientSecret"
            rules={[{ required: true, message: intl.formatMessage({ id: 'digitalEmployeeMgr.clientSecretRequired' }) }]}
          >
            <Input.TextArea className={styles.robotFieldControl} rows={2} placeholder="" />
          </Form.Item>
          <Form.Item
            label={
              <LabelWithTooltip
                label={intl.formatMessage({ id: 'digitalEmployeeMgr.robotCodeLabel' })}
                tooltip={intl.formatMessage({ id: 'digitalEmployeeMgr.robotCodeTooltip' })}
              />
            }
            name="robotCode"
            rules={[{ required: true, message: intl.formatMessage({ id: 'digitalEmployeeMgr.robotCodeRequired' }) }]}
          >
            <Input className={styles.robotFieldControl} placeholder="" />
          </Form.Item>
          <Form.Item
            label={
              <LabelWithTooltip
                label={intl.formatMessage({ id: 'digitalEmployeeMgr.aiCardIdLabel' })}
                tooltip={intl.formatMessage({ id: 'digitalEmployeeMgr.aiCardIdTooltip' })}
              />
            }
            name="AICardId"
          >
            <Input className={styles.robotFieldControl} placeholder="" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

export default RobotModal;
