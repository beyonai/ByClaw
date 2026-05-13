// tslint:disable:ordered-imports
import React, { useEffect } from 'react';
import { Spin, message } from 'antd';
// @ts-ignore
import { useIntl } from '@umijs/max';

import { getSSOUrl } from '@/service/auth';

import styles from '../index.module.less';

function LoginByCode() {
  const intl = useIntl();

  useEffect(() => {
    getSSOUrl('feiLian')
      .then((res) => {
        if (`${res.code}` === '0') {
          window.location.href = res.data;
        } else {
          message.error(res.msg);
        }
      })
      .catch(() => {
        message.error(intl.formatMessage({ id: 'login.feiLian.ssoUrlFailed' }));
      });
  }, [intl]);

  return <Spin spinning className={styles.spinComp} />;
}

export default LoginByCode;
