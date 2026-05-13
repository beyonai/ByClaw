import { QRCode } from 'antd';
// tslint:disable:ordered-imports
import React from 'react';
import { useIntl } from '@umijs/max';
import styles from '../index.module.less';

export default function DDForm({ isAgreed }: { isAgreed: boolean }) {
  const intl = useIntl();

  return (
    <div className={styles.qrcodeContainer}>
      <div className={styles.qrcodeWrapper}>
        <QRCode value="https://example.com/dingtalk-login" status="active" size={232} bordered={false} />
        <p className={styles.qrcodeText}>
          {intl.formatMessage({
            id: 'login.scanWithDingtalk.prefix',
          })}
          <span className={styles.bold}>{intl.formatMessage({ id: 'login.dingtalk' })}</span>
          {intl.formatMessage({
            id: 'login.scanWithDingtalk.suffix',
          })}
        </p>
        {!isAgreed && (
          <div className={styles.qrcodeOverlay}>
            <span>
              {intl.formatMessage({
                id: 'login.agreementRequiredPrefix',
              })}
            </span>
            <span>
              {intl.formatMessage({
                id: 'login.agreementRequiredSuffix',
              })}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
