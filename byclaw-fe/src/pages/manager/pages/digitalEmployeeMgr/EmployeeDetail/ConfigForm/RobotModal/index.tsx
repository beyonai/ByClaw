import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  appId?: string;
  appSecret?: string;
  verificationToken?: string;
  encryptKey?: string;
};

type IProps = {
  open: boolean;
  setOpen: (open: boolean) => void;
  onOk: (item: RobotConfig) => void;

  robotChannelLabelMap: Record<string, string>;
  item: RobotConfig;
  isReadOnly: boolean;
};

const normalizeRobotChannelValue = (channel = '') => `${channel || ''}`.trim().toLowerCase();

function RobotModal(props: IProps) {
  const { open, setOpen, onOk, robotChannelLabelMap, item, isReadOnly } = props;
  const intl = useIntl();
  const hasIdentity = Boolean(item.clientId || item.appId);
  const [form] = Form.useForm<RobotConfig>();
  const channelTabs = useMemo(() => {
    return Object.entries(robotChannelLabelMap).map(([key, label]) => ({
      key,
      label,
    }));
  }, [robotChannelLabelMap]);
  const [activeChannel, setActiveChannel] = useState(item.channel || '');
  const [channelFormCache, setChannelFormCache] = useState<Record<string, Partial<RobotConfig>>>({});

  const resolveChannelKey = useCallback(
    (channel?: string) => {
      const matchedTab = channelTabs.find(
        (tab) => normalizeRobotChannelValue(tab.key) === normalizeRobotChannelValue(channel)
      );
      return matchedTab?.key || channel || channelTabs[0]?.key || '';
    },
    [channelTabs]
  );

  useEffect(() => {
    if (!open) return;

    const nextChannel = resolveChannelKey(item.channel);
    setActiveChannel(nextChannel);
    setChannelFormCache({
      [nextChannel]: {
        channel: nextChannel,
        clientId: item.clientId,
        clientSecret: item.clientSecret,
        robotCode: item.robotCode,
        AICardId: item.AICardId,
        appId: item.appId,
        appSecret: item.appSecret,
        verificationToken: item.verificationToken,
        encryptKey: item.encryptKey,
      },
    });

    form.setFieldsValue({
      channel: nextChannel,
      clientId: item.clientId,
      clientSecret: item.clientSecret,
      robotCode: item.robotCode,
      AICardId: item.AICardId,
      appId: item.appId,
      appSecret: item.appSecret,
      verificationToken: item.verificationToken,
      encryptKey: item.encryptKey,
    });
  }, [form, item, open, resolveChannelKey]);

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
      appId: nextValues.appId || '',
      appSecret: nextValues.appSecret || '',
      verificationToken: nextValues.verificationToken || '',
      encryptKey: nextValues.encryptKey || '',
    });
  };

  const normalizedActiveChannel = normalizeRobotChannelValue(activeChannel);
  const isFeishuChannel = normalizedActiveChannel === 'feishu';

  const handleOk = async () => {
    const values = await form.validateFields();

    if (isFeishuChannel) {
      onOk({
        channel: activeChannel,
        appId: values.appId,
        appSecret: values.appSecret,
        verificationToken: values.verificationToken,
        encryptKey: values.encryptKey,
      });
      return;
    }

    onOk({
      channel: activeChannel,
      clientId: values.clientId,
      clientSecret: values.clientSecret,
      robotCode: values.robotCode,
      AICardId: values.AICardId,
    });
  };

  const renderDingtalkFields = () => (
    <>
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
    </>
  );

  const renderFeishuFields = () => (
    <>
      <Form.Item
        label={
          <LabelWithTooltip
            label={intl.formatMessage({ id: 'digitalEmployeeMgr.feishuAppIdLabel' })}
            tooltip={intl.formatMessage({ id: 'digitalEmployeeMgr.feishuAppIdTooltip' })}
          />
        }
        name="appId"
        rules={[{ required: true, message: intl.formatMessage({ id: 'digitalEmployeeMgr.feishuAppIdRequired' }) }]}
      >
        <Input
          className={styles.robotFieldControl}
          placeholder={intl.formatMessage({ id: 'digitalEmployeeMgr.feishuAppIdTooltip' })}
        />
      </Form.Item>
      <Form.Item
        label={
          <LabelWithTooltip
            label={intl.formatMessage({ id: 'digitalEmployeeMgr.feishuAppSecretLabel' })}
            tooltip={intl.formatMessage({ id: 'digitalEmployeeMgr.feishuAppSecretTooltip' })}
          />
        }
        name="appSecret"
        rules={[{ required: true, message: intl.formatMessage({ id: 'digitalEmployeeMgr.feishuAppSecretRequired' }) }]}
      >
        <Input
          className={styles.robotFieldControl}
          placeholder={intl.formatMessage({ id: 'digitalEmployeeMgr.feishuAppSecretTooltip' })}
        />
      </Form.Item>
      <Form.Item
        label={
          <LabelWithTooltip
            label={intl.formatMessage({ id: 'digitalEmployeeMgr.feishuEncryptKeyLabel' })}
            tooltip={intl.formatMessage({ id: 'digitalEmployeeMgr.feishuEncryptKeyTooltip' })}
          />
        }
        name="encryptKey"
        rules={[{ required: true, message: intl.formatMessage({ id: 'digitalEmployeeMgr.feishuEncryptKeyRequired' }) }]}
      >
        <Input
          className={styles.robotFieldControl}
          placeholder={intl.formatMessage({ id: 'digitalEmployeeMgr.feishuEncryptKeyTooltip' })}
        />
      </Form.Item>
      <Form.Item
        label={
          <LabelWithTooltip
            label={intl.formatMessage({ id: 'digitalEmployeeMgr.feishuVerificationTokenLabel' })}
            tooltip={intl.formatMessage({ id: 'digitalEmployeeMgr.feishuVerificationTokenTooltip' })}
          />
        }
        name="verificationToken"
        rules={[
          { required: true, message: intl.formatMessage({ id: 'digitalEmployeeMgr.feishuVerificationTokenRequired' }) },
        ]}
      >
        <Input
          className={styles.robotFieldControl}
          placeholder={intl.formatMessage({ id: 'digitalEmployeeMgr.feishuVerificationTokenTooltip' })}
        />
      </Form.Item>
    </>
  );

  const renderChannelFields = () => {
    if (isFeishuChannel) {
      return renderFeishuFields();
    }

    return renderDingtalkFields();
  };

  return (
    <div>
      <Modal
        title={
          hasIdentity
            ? intl.formatMessage({ id: 'digitalEmployeeMgr.editRobot' })
            : intl.formatMessage({ id: 'digitalEmployeeMgr.addRobot' })
        }
        open={open}
        onOk={handleOk}
        onCancel={() => setOpen(false)}
        okButtonProps={{ disabled: isReadOnly }}
        destroyOnHidden
        maskClosable={false}
        className={styles.robotModal}
      >
        {!isReadOnly && !hasIdentity && channelTabs.length > 0 && (
          <Tabs
            size="small"
            // className={styles.robotCardHeader}
            activeKey={activeChannel}
            items={channelTabs}
            onChange={handleTabChange}
          />
        )}
        <Form form={form} layout="vertical" disabled={isReadOnly} preserve={false} className={styles.robotCardBody}>
          {renderChannelFields()}
        </Form>
      </Modal>
    </div>
  );
}

export default RobotModal;
