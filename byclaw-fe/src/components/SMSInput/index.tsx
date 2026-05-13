import React from 'react';
import classNames from 'classnames';
// @ts-ignore
import { useIntl } from '@umijs/max';

import { sendSMS } from '@/service/user';
import { encryptByAES } from '@/utils/encrypt/aes';

import styles from './index.module.less';
import { message, Spin } from 'antd';

const COUNT_NUM = 60;

function SmsInput(props: {
  checkCaptchaInput: () => Promise<boolean>;
  checkPhoneInput: () => Promise<string>;
  bizType: '1' | '2'; // // 2表示注册, 1 表示登录
}) {
  const intl = useIntl();
  const { checkCaptchaInput, checkPhoneInput, bizType } = props;

  const [countDown, setCountDown] = React.useState(COUNT_NUM);
  const [isCounting, setIsCounting] = React.useState(false);

  const [loading, setLoading] = React.useState(false);

  const timerRef = React.useRef<any>(0);

  const startCountDown = React.useCallback(() => {
    setIsCounting(true);
    timerRef.current = setInterval(() => {
      setCountDown((prev) => {
        const num = prev - 1;

        if (num === -1) {
          setIsCounting(false);
          return COUNT_NUM;
        }

        return num;
      });
    }, 1000);
  }, []);

  const getSMS = React.useCallback(async () => {
    Promise.all([checkCaptchaInput(), checkPhoneInput()]).then(([captchaRes, phoneRes]) => {
      if (captchaRes && phoneRes) {
        setLoading(true);
        sendSMS({
          bizType,
          phone: encryptByAES(phoneRes),
          captcha: captchaRes,
        })
          .then((res) => {
            if (`${res.code}` === '0') {
              startCountDown();
            } else {
              message.error(res.msg);
            }
          })
          .finally(() => {
            setLoading(false);
          });
      }
    });
  }, [bizType]);

  React.useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  return (
    <>
      {!isCounting && loading && (
        <div style={{ width: 85 }}>
          <Spin spinning />
        </div>
      )}
      {!isCounting && !loading && (
        <div className={classNames(styles.getSMSCodeTxt, 'pointer')} onClick={getSMS}>
          {intl.formatMessage({ id: 'common.getVerificationCode' })}
        </div>
      )}
      {isCounting && <div className={classNames(styles.getSMSCodeTxt)}>{countDown}s</div>}
    </>
  );
}

export default SmsInput;
