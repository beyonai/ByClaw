import React, { useState, useRef, useMemo } from 'react';
import { Modal, Button, Space, InputNumber, Switch, Segmented, message } from 'antd';
import { LinkOutlined } from '@ant-design/icons';
import copy from 'copy-to-clipboard';
// @ts-ignore
import { useIntl } from '@umijs/max';
import classnames from 'classnames';
import { getRuntimeActualUrl } from '@/utils';

import { POST } from '@/service/common/request';

import styles from './index.module.less';

type IProps = {
  open: boolean;
  onClose: () => void;
  getExtraInfo: () => {
    messageIds: string[];
  };
};

function LinkShare(props: IProps) {
  const { open, onClose, getExtraInfo } = props;
  const intl = useIntl();

  // 有效时长选项
  const DURATION_OPTIONS = useMemo(
    () => [
      { label: intl.formatMessage({ id: 'common.duration.1day' }), value: 1 },
      { label: intl.formatMessage({ id: 'common.duration.7days' }), value: 7 },
      { label: intl.formatMessage({ id: 'common.duration.30days' }), value: 30 },
      { label: intl.formatMessage({ id: 'common.duration.1year' }), value: 365 },
      { label: intl.formatMessage({ id: 'common.duration.permanent' }), value: -1 },
      { label: intl.formatMessage({ id: 'common.duration.custom' }), value: 'custom' },
    ],
    [intl]
  );

  // 有效时长，默认1天
  const [duration, setDuration] = useState<number | string>(1);
  // 有效时长：自定义天数
  const [customDurationDays, setCustomDurationDays] = useState<number | null>(null);
  // 最大访问次数：是否不限制
  const [limitedAccess, setUnlimitedAccess] = useState<boolean>(false);
  // 最大访问次数：自定义天数
  const [maxAccessDays, setMaxAccessDays] = useState<number>(1);

  const [isLoading, setIsLoading] = useState(false);

  const cancelToken = useRef<AbortController | null>(null);

  // 处理创建链接
  const handleCreateLink = () => {
    // TODO: 实现创建链接的逻辑
    const finalDuration = duration === 'custom' ? customDurationDays : duration;
    const finalMaxAccessDays = limitedAccess ? maxAccessDays : undefined;

    if (cancelToken.current) {
      cancelToken.current.abort();
      cancelToken.current = null;
    }
    cancelToken.current = new AbortController();

    setIsLoading(true);
    POST(
      '/byaiService/chat/message/share-link',
      {
        expireDays: finalDuration,
        maxAccessCount: finalMaxAccessDays,
        accessPermission: 'PUBLIC', // 访问权限：PUBLIC（免登录）/ AUTHENTICATED（需登录），默认 AUTHENTICATED
        ...getExtraInfo(),
      },
      {
        cancelToken: cancelToken.current,
      }
    )
      .then((code) => {
        if (code) {
          // 创建成功后关闭弹窗
          copy(`${window.location.host}${getRuntimeActualUrl(`/preview?code=${code}`)}`);
          message.success(intl.formatMessage({ id: 'linkShare.createLinkSuccess' }));
          onClose();
        } else {
          message.error(intl.formatMessage({ id: 'linkShare.createLinkFailed' }));
        }
      })
      .catch(() => {
        message.error(intl.formatMessage({ id: 'linkShare.createLinkFailed' }));
      })
      .finally(() => {
        cancelToken.current = null;
        setIsLoading(false);
      });
  };

  // 处理取消
  const handleCancel = () => {
    // 重置状态
    // setDuration(1);
    // setCustomDurationDays(null);
    // setUnlimitedAccess(false);
    // setMaxAccessDays(1);
    onClose();
    if (cancelToken.current) {
      cancelToken.current.abort();
      cancelToken.current = null;
    }
  };

  return (
    <Modal
      title={intl.formatMessage({ id: 'common.shareLink' })}
      open={open}
      onCancel={handleCancel}
      footer={null}
      width={600}
      className={styles.linkShareModal}
      destroyOnHidden
    >
      <div className={styles.content}>
        {/* 有效时长选择 */}
        <div className={classnames(styles.section, 'ub ub-ac ub-ver gap12')}>
          <div className="ub ub-pj full-width">
            <div className={styles.label}>
              {intl.formatMessage({ id: 'common.validDuration' })} <span className={styles.required}>*</span>
            </div>
          </div>
          <Segmented
            block
            disabled={isLoading}
            options={DURATION_OPTIONS}
            value={duration}
            onChange={(value) => {
              setDuration(value);
              if (value === 'custom') {
                // 当选择"自定义"时，设置默认值为1天
                setCustomDurationDays(1);
              } else {
                setCustomDurationDays(null);
              }
            }}
            className="full-width"
          />
          {duration === 'custom' && (
            <div className={classnames(styles.maxAccessContainer, 'ub full-width gap8 ub-pe')}>
              <div className={styles.inputContainer}>
                <InputNumber
                  min={1}
                  value={customDurationDays}
                  onChange={(value) => setCustomDurationDays(value)}
                  placeholder={intl.formatMessage({ id: 'linkShare.pleaseEnterDays' })}
                  className={styles.maxAccessInput}
                  addonAfter={intl.formatMessage({ id: 'common.day' })}
                  disabled={isLoading}
                />
              </div>
            </div>
          )}
        </div>

        {/* 最大访问次数 */}
        <div className={classnames(styles.section, 'ub ub-ac ub-ver gap12')}>
          <div className="ub ub-pj full-width">
            <div className={styles.label}>
              {intl.formatMessage({ id: 'linkShare.maxAccessCount' })} <span className={styles.required}>*</span>
            </div>
            <div className={styles.switchContainer}>
              <Switch
                checked={limitedAccess}
                onChange={(checked) => {
                  setUnlimitedAccess(checked);
                }}
                checkedChildren={intl.formatMessage({ id: 'common.limit' })}
                unCheckedChildren={intl.formatMessage({ id: 'common.unlimited' })}
                disabled={isLoading}
              />
            </div>
          </div>
          <div className={classnames(styles.maxAccessContainer, 'ub full-width gap8 ub-pe')}>
            {limitedAccess && (
              <div className={styles.inputContainer}>
                <InputNumber
                  min={1}
                  max={1000}
                  value={maxAccessDays}
                  onChange={(value) => setMaxAccessDays(value || 1)}
                  placeholder={intl.formatMessage({ id: 'linkShare.pleaseEnterLimitDays' })}
                  className={styles.maxAccessInput}
                  addonAfter={intl.formatMessage({ id: 'common.times' })}
                  disabled={isLoading}
                />
              </div>
            )}
          </div>
        </div>

        {/* 底部按钮 */}
        <div className={styles.footer}>
          <Space>
            <Button onClick={handleCancel}>{intl.formatMessage({ id: 'common.cancel' })}</Button>
            <Button type="primary" icon={<LinkOutlined />} onClick={handleCreateLink} loading={isLoading}>
              {intl.formatMessage({ id: 'linkShare.createLink' })}
            </Button>
          </Space>
        </div>
      </div>
    </Modal>
  );
}

export default LinkShare;
