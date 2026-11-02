import { QuestionCircleOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import { Form, Input, Modal, Tabs, Tooltip, Typography } from 'antd';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';

import {
  getReusableRobotConfigValues,
  getRobotConfigIdentityValue,
  isWeComChannel,
  normalizeRobotConfig,
  RobotConfig,
} from '../robotConfig';
import styles from './index.module.less';

const LabelWithTooltip = ({ label, tooltip }: { label: string; tooltip: string }) => (
  <span>
    {label}
    <Tooltip title={tooltip}>
      <QuestionCircleOutlined className={styles.tooltipIcon} />
    </Tooltip>
  </span>
);

type IProps = {
  open: boolean;
  setOpen: (open: boolean) => void;
  onOk: (item: RobotConfig) => void;

  robotChannelLabelMap: Record<string, string>;
  item: RobotConfig;
  isReadOnly: boolean;
};

const normalizeRobotChannelValue = (channel = '') => `${channel || ''}`.replace(/[\s_-]/g, '').toLowerCase();

function RobotModal(props: IProps) {
  const { open, setOpen, onOk, robotChannelLabelMap, item, isReadOnly } = props;
  const intl = useIntl();

  // 输入编码时也向读屏用户说明绑定限制，每个弹窗使用独立的描述 ID。
  const robotCodeHintId = `robot-code-hint-${useId().replace(/:/g, '')}`;
  const hasIdentity = Boolean(getRobotConfigIdentityValue(item) || item.appId);
  const [form] = Form.useForm<RobotConfig>();
  const channelTabs = useMemo(() => {
    return Object.entries(robotChannelLabelMap).map(([key, label]) => ({
      key,
      label,
    }));
  }, [robotChannelLabelMap]);
  const [activeChannel, setActiveChannel] = useState(item.channel || '');
  const [channelFormCache, setChannelFormCache] = useState<Record<string, Partial<RobotConfig>>>({});
  const isWeCom = isWeComChannel(activeChannel);

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
    const nextValues = getReusableRobotConfigValues({
      ...item,
      channel: nextChannel,
    });
    setActiveChannel(nextChannel);
    setChannelFormCache({
      [nextChannel]: nextValues,
    });

    form.setFieldsValue(nextValues);
  }, [form, item, open, resolveChannelKey]);

  const handleTabChange = (nextChannel: string) => {
    const currentValues = form.getFieldsValue();
    const nextCache = {
      ...channelFormCache,
      [activeChannel]: {
        channel: activeChannel,
        ...channelFormCache[activeChannel],
        ...currentValues,
      },
    };

    setChannelFormCache(nextCache);

    const nextValues = getReusableRobotConfigValues({
      ...currentValues,
      ...nextCache[nextChannel],
      channel: nextChannel,
    });
    setActiveChannel(nextChannel);
    form.setFieldsValue(nextValues);
  };

  const normalizedActiveChannel = normalizeRobotChannelValue(activeChannel);
  const isFeishuChannel = normalizedActiveChannel === 'feishu';

  const handleOk = async () => {
    const values = await form.validateFields();

    if (isFeishuChannel) {
      onOk(
        normalizeRobotConfig({
          channel: activeChannel,
          appId: values.appId,
          appSecret: values.appSecret,
          verificationToken: values.verificationToken,
          encryptKey: values.encryptKey,
        })
      );
      return;
    }

    if (isWeCom) {
      onOk(
        normalizeRobotConfig({
          channel: activeChannel,
          botId: values.botId,
          secret: values.secret,
          agentId: values.agentId,
          corpId: values.corpId,
          corpSecret: values.corpSecret,
        })
      );
      return;
    }

    onOk(
      normalizeRobotConfig({
        channel: activeChannel,
        clientId: values.clientId,
        clientSecret: values.clientSecret,
        robotCode: values.robotCode,
        AICardId: values.AICardId,
      })
    );
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
          <span className={styles.robotCodeLabel}>
            <LabelWithTooltip
              label={intl.formatMessage({ id: 'digitalEmployeeMgr.robotCodeLabel' })}
              tooltip={intl.formatMessage({ id: 'digitalEmployeeMgr.robotCodeTooltip' })}
            />
            <Typography.Text id={robotCodeHintId} className={styles.robotCodeHint} type="secondary">
              {intl.formatMessage({ id: 'digitalEmployeeMgr.robotCodeBindingHint' })}
            </Typography.Text>
          </span>
        }
        name="robotCode"
        rules={[{ required: true, message: intl.formatMessage({ id: 'digitalEmployeeMgr.robotCodeRequired' }) }]}
      >
        <Input aria-describedby={robotCodeHintId} className={styles.robotFieldControl} placeholder="" />
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
      >
        <Input
          className={styles.robotFieldControl}
          placeholder={intl.formatMessage({ id: 'digitalEmployeeMgr.feishuVerificationTokenTooltip' })}
        />
      </Form.Item>
    </>
  );

  const renderWeComFields = () => (
    <>
      <Form.Item
        label={
          <LabelWithTooltip
            label={intl.formatMessage({ id: 'digitalEmployeeMgr.wecomBotIdLabel' })}
            tooltip={intl.formatMessage({ id: 'digitalEmployeeMgr.wecomBotIdTooltip' })}
          />
        }
        name="botId"
        rules={[{ required: true, message: intl.formatMessage({ id: 'digitalEmployeeMgr.wecomBotIdRequired' }) }]}
      >
        <Input className={styles.robotFieldControl} placeholder="" />
      </Form.Item>
      <Form.Item
        label={
          <LabelWithTooltip
            label={intl.formatMessage({ id: 'digitalEmployeeMgr.wecomSecretLabel' })}
            tooltip={intl.formatMessage({ id: 'digitalEmployeeMgr.wecomSecretTooltip' })}
          />
        }
        name="secret"
        rules={[{ required: true, message: intl.formatMessage({ id: 'digitalEmployeeMgr.wecomSecretRequired' }) }]}
      >
        <Input.TextArea className={styles.robotFieldControl} rows={2} placeholder="" />
      </Form.Item>
      <Form.Item
        label={
          <LabelWithTooltip
            label={intl.formatMessage({ id: 'digitalEmployeeMgr.wecomAgentIdLabel' })}
            tooltip={intl.formatMessage({ id: 'digitalEmployeeMgr.wecomAgentIdTooltip' })}
          />
        }
        name="agentId"
        rules={[{ required: true, message: intl.formatMessage({ id: 'digitalEmployeeMgr.wecomAgentIdRequired' }) }]}
      >
        <Input className={styles.robotFieldControl} placeholder="" />
      </Form.Item>
      <Form.Item
        label={
          <LabelWithTooltip
            label={intl.formatMessage({ id: 'digitalEmployeeMgr.wecomCorpIdLabel' })}
            tooltip={intl.formatMessage({ id: 'digitalEmployeeMgr.wecomCorpIdTooltip' })}
          />
        }
        name="corpId"
        rules={[{ required: true, message: intl.formatMessage({ id: 'digitalEmployeeMgr.wecomCorpIdRequired' }) }]}
      >
        <Input className={styles.robotFieldControl} placeholder="" />
      </Form.Item>
      <Form.Item
        label={
          <LabelWithTooltip
            label={intl.formatMessage({ id: 'digitalEmployeeMgr.wecomCorpSecretLabel' })}
            tooltip={intl.formatMessage({ id: 'digitalEmployeeMgr.wecomCorpSecretTooltip' })}
          />
        }
        name="corpSecret"
        rules={[
          {
            required: true,
            message: intl.formatMessage({ id: 'digitalEmployeeMgr.wecomCorpSecretRequired' }),
          },
        ]}
      >
        <Input.TextArea className={styles.robotFieldControl} rows={2} placeholder="" />
      </Form.Item>
    </>
  );

  const renderChannelFields = () => {
    if (isWeCom) {
      return renderWeComFields();
    }

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
