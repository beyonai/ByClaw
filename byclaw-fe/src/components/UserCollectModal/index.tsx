import React, { useState } from 'react';
import { useIntl, useDispatch, useSelector } from '@umijs/max';
import { Modal, Form, Input, Select, Button, Spin, ConfigProvider, ModalProps } from 'antd';
import { isNil } from 'lodash';

import useAppStore from '@/models/common/useAppStore';
import { batchAdd } from '@/service/user';

import { globalLogout } from '@/service/common/request';

import styles from './index.module.less';

function UserCollectModal(props: ModalProps) {
  const { isUserCollectModalOpen, setUserCollectModalOpen } = useAppStore();

  const [isLoading, setIsLoading] = useState(false);
  const [islogouting, setIslogouting] = useState(false);

  const [form] = Form.useForm();

  const userInfo = useSelector(({ user }) => user.userInfo);
  const dispatch = useDispatch();
  const intl = useIntl();

  const isRetented = isNil(userInfo?.isRetented) ? true : userInfo?.isRetented;

  const handleSubmit = React.useCallback(async () => {
    await form.validateFields();
    const values = form.getFieldsValue();

    const { username, companyname, industry, question } = values;

    setIsLoading(true);
    batchAdd({
      list: [
        {
          companyName: companyname,
          contactName: username,
          industry,
          // "phone": "13900139000",
          // "wechat": "lisi_wx",
          demand: question,
        },
      ],
    })
      .then(() => {
        dispatch({
          type: 'user/save',
          payload: {
            userInfo: {
              ...userInfo,
              isRetented: true,
              userName: username,
            },
          },
        });
        setUserCollectModalOpen(false);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [userInfo]);

  React.useEffect(() => {
    setUserCollectModalOpen(!isRetented);
  }, [isRetented]);

  return (
    <ConfigProvider prefixCls={PREFIX_NAME}>
      <Modal
        open={isUserCollectModalOpen}
        // open={false}
        // onCancel={() => setUserCollectModalOpen(false)}
        footer={null}
        width={480}
        height={650}
        centered
        destroyOnHidden
        forceRender
        closeIcon={
          <Spin spinning={islogouting} size="small">
            <div
              onClick={() => {
                setIslogouting(true);
                globalLogout()?.finally(() => {
                  setIslogouting(false);
                });
              }}
              style={{ fontSize: 13, fontWeight: 'normal' }}
            >
              {intl.formatMessage({ id: 'contentHeader.logout' })}
            </div>
          </Spin>
        }
        className={styles.modal}
        {...props}
      >
        <div style={{ marginTop: 16 }}>
          <h2 className="ub ub-ac ub-pc">{intl.formatMessage({ id: 'common.businessConsultation' })}</h2>
          <p className="ub ub-ac ub-pc" style={{ marginBottom: 24 }}>
            {intl.formatMessage({ id: 'common.consultantContact' })}
          </p>
          <Form form={form} layout="vertical">
            <Form.Item
              name="username"
              label={intl.formatMessage({ id: 'common.name' })}
              rules={[
                {
                  required: true,
                  message: intl.formatMessage(
                    { id: 'form.inputPlaceholder' },
                    {
                      content: intl.formatMessage({ id: 'common.userName' }),
                    }
                  ),
                },
              ]}
            >
              <Input size="large" />
            </Form.Item>
            <Form.Item
              name="companyname"
              label={intl.formatMessage({ id: 'common.companyName' })}
              rules={[
                {
                  required: true,
                  message: intl.formatMessage(
                    { id: 'form.inputPlaceholder' },
                    {
                      content: intl.formatMessage({ id: 'common.companyName' }),
                    }
                  ),
                },
              ]}
            >
              <Input size="large" />
            </Form.Item>
            <Form.Item
              name="industry"
              label={intl.formatMessage({ id: 'common.industry' })}
              rules={[
                {
                  required: true,
                  message: intl.formatMessage(
                    { id: 'form.selectPlaceholder' },
                    {
                      content: intl.formatMessage({ id: 'common.industry' }),
                    }
                  ),
                },
              ]}
            >
              <Select
                options={[
                  {
                    label: intl.formatMessage({ id: 'common.industry.finance' }),
                    value: intl.formatMessage({ id: 'common.industry.finance' }),
                  },
                  {
                    label: intl.formatMessage({ id: 'common.industry.education' }),
                    value: intl.formatMessage({ id: 'common.industry.education' }),
                  },
                  {
                    label: intl.formatMessage({ id: 'common.industry.shippingPort' }),
                    value: intl.formatMessage({ id: 'common.industry.shippingPort' }),
                  },
                  {
                    label: intl.formatMessage({ id: 'common.industry.medicalSupplyChain' }),
                    value: intl.formatMessage({ id: 'common.industry.medicalSupplyChain' }),
                  },
                  {
                    label: intl.formatMessage({ id: 'common.industry.culturalIndustry' }),
                    value: intl.formatMessage({ id: 'common.industry.culturalIndustry' }),
                  },
                  {
                    label: intl.formatMessage({ id: 'common.industry.construction' }),
                    value: intl.formatMessage({ id: 'common.industry.construction' }),
                  },
                  {
                    label: intl.formatMessage({ id: 'common.industry.publicCulture' }),
                    value: intl.formatMessage({ id: 'common.industry.publicCulture' }),
                  },
                  {
                    label: intl.formatMessage({ id: 'common.industry.government' }),
                    value: intl.formatMessage({ id: 'common.industry.government' }),
                  },
                  {
                    label: intl.formatMessage({ id: 'common.industry.tobacco' }),
                    value: intl.formatMessage({ id: 'common.industry.tobacco' }),
                  },
                  {
                    label: intl.formatMessage({ id: 'common.industry.media' }),
                    value: intl.formatMessage({ id: 'common.industry.media' }),
                  },
                  {
                    label: intl.formatMessage({ id: 'common.industry.partner' }),
                    value: intl.formatMessage({ id: 'common.industry.partner' }),
                  },
                ]}
                size="large"
              />
            </Form.Item>
            <Form.Item name="question" label={intl.formatMessage({ id: 'common.consultationQuestion' })}>
              <Input.TextArea rows={4} style={{ resize: 'none' }} />
            </Form.Item>
          </Form>
          <Button
            size="large"
            type="primary"
            block
            style={{ marginTop: '32px' }}
            onClick={handleSubmit}
            loading={isLoading}
          >
            {intl.formatMessage({ id: 'common.confirmSubmit' })}
          </Button>
        </div>
      </Modal>
    </ConfigProvider>
  );
}
export default UserCollectModal;
