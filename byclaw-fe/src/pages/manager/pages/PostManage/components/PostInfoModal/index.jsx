/* eslint-disable no-nested-ternary */
import React, { useEffect, useState } from 'react';
import { connect } from 'dva';
import { Form, Input, message, Modal } from 'antd';
import { useIntl } from '@umijs/max';

const PostInfoModal = ({ visible, onCancel, type, info, dispatch, onOk, setInfoLook }) => {
  const intl = useIntl();
  const labelCol = 5;
  const [form] = Form.useForm();

  const [loading, setloading] = useState(false);

  useEffect(() => {
    if (info) {
      form.setFieldsValue({
        ...info,
      });
    }
  }, [info]);

  // 岗位信息编辑
  const postEdit = (payload) => {
    setloading(true);
    dispatch({
      type: 'postManage/postEdit',
      payload,
      success: () => {
        message.success(intl.formatMessage({ id: 'postInfoModal.operationSuccess' }));
        if (payload.positionId) {
          setInfoLook(payload);
        }
        onOk();
      },
      fail: (res) => {
        message.warning(res.msg);
      },
    }).finally(() => {
      setloading(false);
    });
  };

  return (
    <Modal
      title={
        type === 'add'
          ? intl.formatMessage({ id: 'postInfoModal.addTitle' })
          : type === 'edit'
            ? intl.formatMessage({ id: 'postInfoModal.editTitle' })
            : intl.formatMessage({ id: 'postInfoModal.viewTitle' })
      }
      open={visible}
      onCancel={onCancel}
      width={480}
      confirmLoading={loading}
      onOk={() => {
        form.validateFields().then((vals) => {
          const data = {
            ...vals,
            positionId: info.positionId,
          };
          postEdit(data);
        });
      }}
    >
      <Form form={form} labelCol={{ span: labelCol }} wrapperCol={{ span: 24 - labelCol }} disabled={type === 'look'}>
        <Form.Item
          label={intl.formatMessage({ id: 'postInfoModal.positionName' })}
          name="positionName"
          rules={[
            {
              required: true,
              message: intl.formatMessage({
                id: 'postInfoModal.positionNameRequired',
              }),
            },
            {
              max: 50,
              message: intl.formatMessage({
                id: 'postInfoModal.positionNameLength',
              }),
            },
          ]}
        >
          <Input
            placeholder={intl.formatMessage({
              id: 'form.input',
            })}
            maxLength={50}
          />
        </Form.Item>
        <Form.Item label={intl.formatMessage({ id: 'postInfoModal.positionDesc' })} name="positionDesc">
          <Input.TextArea
            rows={4}
            placeholder={intl.formatMessage({
              id: 'form.input',
            })}
            maxLength={500}
            showCount
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default connect()(PostInfoModal);
