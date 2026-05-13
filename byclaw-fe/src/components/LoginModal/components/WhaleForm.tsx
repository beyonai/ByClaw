// tslint:disable:ordered-imports
import React from 'react';
import { Form, Input } from 'antd';
import { EyeInvisibleOutlined, EyeOutlined } from '@ant-design/icons';
// @ts-ignore
import { useIntl } from '@umijs/max';
import AntdIcon from '@/components/AntdIcon';
import type { FormInstance } from 'antd';
import styles from '../index.module.less';

function WhaleForm({ form }: { form: FormInstance }) {
  const intl = useIntl();

  return (
    <Form form={form} name="login_whale" layout="vertical">
      <Form.Item
        name="accountCode"
        rules={[
          {
            required: true,
            message: intl.formatMessage(
              { id: 'form.inputPlaceholder' },
              {
                content: intl.formatMessage({
                  id: 'login.employeeId',
                }),
              }
            ),
          },
        ]}
      >
        <Input
          size="large"
          placeholder={intl.formatMessage(
            { id: 'form.inputPlaceholder' },
            {
              content: intl.formatMessage({
                id: 'login.employeeId',
              }),
            }
          )}
          prefix={<AntdIcon type="icon-a-Useryonghu" className={styles.inputIcon} />}
        />
      </Form.Item>

      <Form.Item
        name="accountPwd"
        rules={[
          {
            required: true,
            message: intl.formatMessage(
              { id: 'form.inputPlaceholder' },
              {
                content: intl.formatMessage({
                  id: 'login.token',
                }),
              }
            ),
          },
        ]}
      >
        <Input.Password
          size="large"
          placeholder={intl.formatMessage(
            { id: 'form.inputPlaceholder' },
            {
              content: intl.formatMessage({
                id: 'login.token',
              }),
            }
          )}
          prefix={<AntdIcon type="icon-a-Unlockjiesuo" className={styles.inputIcon} />}
          iconRender={(visible) => (visible ? <EyeOutlined /> : <EyeInvisibleOutlined />)}
        />
      </Form.Item>
    </Form>
  );
}

export default WhaleForm;
