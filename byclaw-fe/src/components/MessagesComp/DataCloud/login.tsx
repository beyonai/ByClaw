import React, { useMemo, useState } from 'react';
import getWhaleSysCode from '@/utils/datacloud/getWhaleSysCode';
import { IMessage } from '@/typescript/message';
import useGlobal from '@/hooks/useGlobal';
import { cloneDeep, get, set, merge } from 'lodash';
import { useDispatch, useIntl } from '@umijs/max';
import { IMessageState } from '@/constants/message';
import { Button } from 'antd';
import useCheckIsWhaleSSOLogin, { IWHALE_SSO_LOGIN_TYPE } from '@/pages/datacloud/hooks/useCheckIsWhaleSSOLogin';
import CommonLoginModal from './commonLogin';

type IProps = {
  message: IMessage;
  messageListItemContent: any;
};

export default function DataCloudLogin(props: IProps) {
  const { message, messageListItemContent } = props;
  const [loading, setLoading] = useState(false);
  const isWhaleSSOLogin = useCheckIsWhaleSSOLogin();
  const { EventEmitter } = useGlobal();
  const dispatch = useDispatch();
  const intl = useIntl();
  const [isHandled, setIsHandled] = useState(false);
  const [showCommonLoginModal, setShowCommonLoginModal] = useState(false);

  const content = get(messageListItemContent, 'substance');
  const authType = get(content, 'tool_config.auth_config.auth_type', '');
  const authDesc = get(content, 'tool_config.auth_config.auth_desc', '');
  const publicKey = get(content, 'tool_config.auth_config.public_key', '');
  const defaultUsername = get(content, 'tool_config.auth_config.username', '');

  const onOk = () => {
    const authUrl = get(content, 'tool_config.auth_config.login_url', '');
    if (authType === 'whale_plus' && !authUrl) {
      return;
    }
    if (authType === 'whale_plus') {
      setLoading(true);
      getWhaleSysCode(authUrl, {
        displayIframe: !isWhaleSSOLogin,
      })
        .then((ssoCode) => {
          const extParams = cloneDeep(content);
          set(extParams, 'tool_config.auth_config.auth_params.ssoCode', ssoCode);
          const callbackUrl = get(content, 'tool_config.auth_config.call_back_url', '');
          if (!callbackUrl) {
            throw new Error('call_back_url is required');
          }
          return new Promise<void>((resolve, reject) => {
            fetch(callbackUrl, {
              method: 'POST',
              body: JSON.stringify(extParams.tool_config),
            })
              .then((res) => {
                if (!/^2\d{2}$/.test(String(res.status))) {
                  reject();
                  return;
                }
                const payload = {
                  sendProps: {
                    inheritQryMsgId: message.queryMsgId,
                    payload: {
                      extParams,
                    },
                    msgOpt: {
                      answerMsg: {
                        ...message,
                        messageState: IMessageState.Query,
                      },
                    },
                  },
                  sendConf: {
                    onlyQuery: true,
                  },
                };
                EventEmitter.emit('beyond-chat-on-send-msg', payload);
                dispatch({
                  type: 'user/updateUserInfo',
                  payload: {
                    loginType: IWHALE_SSO_LOGIN_TYPE,
                  },
                });
                setIsHandled(true);
                resolve();
              })
              .catch((err) => {
                console.log(err);
                reject(err);
              });
          });
        })
        .catch(() => {})
        .finally(() => {
          setLoading(false);
        });

      dispatch({
        type: 'user/updateUserInfo',
        payload: {
          loginType: IWHALE_SSO_LOGIN_TYPE,
        },
      });
    } else if (authType === 'common_login') {
      setShowCommonLoginModal(true);
    }
  };

  const handleCommonLogin = (params: { username: string; password: string }) => {
    // params.password 已经是RSA加密后的字符串
    // 由CommonLoginModal组件在提交前自动加密
    const extParams = cloneDeep(content);
    merge(extParams, {
      tool_config: {
        auth_config: params,
      },
    });
    const payload = {
      sendProps: {
        inheritQryMsgId: message.queryMsgId,
        payload: {
          extParams,
        },
        msgOpt: {
          answerMsg: {
            ...message,
            messageState: IMessageState.Query,
          },
        },
      },
      sendConf: {
        onlyQuery: true,
      },
    };
    EventEmitter.emit('beyond-chat-on-send-msg', payload);
    setIsHandled(true);
    setShowCommonLoginModal(false);
  };

  const description = useMemo(() => {
    return authDesc || intl.formatMessage({ id: 'dataCloud.login.needLoginInfo' });
  }, [authDesc, intl]);

  if (isHandled) return null;

  return (
    <>
      <div
        style={{
          padding: 10,
          borderRadius: 8,
          display: 'inline-block',
          border: `0.5px solid var(--${PREFIX_NAME}-color-border)`,
        }}
      >
        <div>{description}</div>
        {!message.isHistoryMsg && (
          <div style={{ textAlign: 'right', marginTop: 10 }}>
            <Button size="small" type="primary" loading={loading} onClick={onOk}>
              {intl.formatMessage({ id: 'common.confirm' })}
            </Button>
          </div>
        )}
      </div>

      <CommonLoginModal
        visible={showCommonLoginModal}
        onCancel={() => setShowCommonLoginModal(false)}
        onOk={handleCommonLogin}
        publicKey={publicKey}
        defaultUsername={defaultUsername}
      />
    </>
  );
}
