import { useCallback, useEffect, useRef, useState } from 'react';

import { CheckCircleFilled } from '@ant-design/icons';
import { Button, Form, Input, message } from 'antd';
// @ts-ignore
import { useIntl } from '@umijs/max';
import Clipboard from 'clipboard';

import AntdIcon from '@/components/AntdIcon';
import ModalDrawer from '@/components/ModalDrawer';
import { createAccessToken } from '@/service/auth';
import styles from './index.module.less';

const AddTokenModal = (props: any) => {
  const { onCancel } = props;

  const intl = useIntl();

  const [isLoading, setLoading] = useState(false);
  const [accessToken, setAccessToken] = useState('');

  const [form] = Form.useForm();
  const copyButtonRef = useRef<HTMLSpanElement>(null);
  const clipboardRef = useRef<Clipboard | null>(null);

  // 生成令牌
  const handleCreateToken = useCallback(
    (params: Record<string, any>) => {
      setLoading(true);
      createAccessToken(params)
        .then((data) => {
          setAccessToken(data || '');
          message.success(intl.formatMessage({ id: 'accessToken.generateSuccess' }));
        })
        .catch((error) => {
          console.error(error);
        })
        .finally(() => {
          setLoading(false);
        });
    },
    [intl]
  );

  // 初始化 clipboard 实例
  useEffect(() => {
    if (copyButtonRef.current && accessToken) {
      // 销毁之前的 clipboard 实例
      if (clipboardRef.current) {
        clipboardRef.current.destroy();
      }

      // 创建新的 clipboard 实例，绑定到复制按钮
      clipboardRef.current = new Clipboard(copyButtonRef.current, {
        text: () => accessToken,
      });

      // 监听成功事件
      clipboardRef.current.on('success', () => {
        message.success(intl.formatMessage({ id: 'common.copySuccess' }));
      });

      // 监听错误事件
      clipboardRef.current.on('error', (err) => {
        console.error(err);
        message.error(intl.formatMessage({ id: 'common.copyFail' }));
      });
    }

    // 清理函数
    return () => {
      if (clipboardRef.current) {
        clipboardRef.current.destroy();
        clipboardRef.current = null;
      }
    };
  }, [accessToken, intl]);

  return (
    <ModalDrawer
      title={intl.formatMessage({ id: 'accessToken.generateAccessToken' })}
      open
      type="modal"
      showFoot={false}
      width={618}
      height={accessToken ? 400 : 338}
      onCancel={onCancel}
      onOk={onCancel}
      okButtonProps={{
        disabled: !accessToken,
      }}
      styles={{
        header: { border: 'none' },
        body: { padding: 0, height: 242 },
        footer: { border: 'none' },
      }}
    >
      <Form form={form} layout="vertical">
        <Form.Item
          label={intl.formatMessage({ id: 'accessToken.tokenName' })}
          name="accessTokenName"
          rules={[
            {
              required: true,
              message: intl.formatMessage(
                {
                  id: 'form.inputPlaceholder',
                },
                {
                  content: intl.formatMessage({
                    id: 'form.name',
                  }),
                }
              ),
            },
          ]}
        >
          <Input
            placeholder={intl.formatMessage(
              {
                id: 'form.inputPlaceholder',
              },
              {
                content: intl.formatMessage({
                  id: 'form.name',
                }),
              }
            )}
            allowClear
          />
        </Form.Item>
      </Form>

      {!accessToken ? (
        <Button
          type="primary"
          loading={isLoading}
          onClick={() => {
            form.validateFields().then((values) => {
              handleCreateToken(values);
            });
          }}
        >
          {intl.formatMessage({ id: 'accessToken.clickToGenerate' })}
        </Button>
      ) : (
        <div className={styles.successContainer}>
          <span>
            <CheckCircleFilled className={styles.successIcon} />
            {intl.formatMessage({ id: 'accessToken.newTokenSuccess' })}
          </span>
          <div className={styles.tokenContainer}>
            <span className={styles.tokenText}>{accessToken}</span>
            <span ref={copyButtonRef} className={styles.copyButton}>
              <AntdIcon type="icon-a-Copyfuzhi1" style={{ marginRight: 4 }} />
              {intl.formatMessage({ id: 'common.copy' })}
            </span>
          </div>
        </div>
      )}
    </ModalDrawer>
  );
};

export default AddTokenModal;
