/* eslint-disable function-paren-newline */
/* eslint-disable no-nested-ternary */
import React, { useEffect, useState, useMemo } from 'react';
import { connect } from 'dva';
import { Form, Input, message, Select, Modal } from 'antd';
import { useIntl } from '@umijs/max';
import pinyin from 'pinyin';
import styles from './index.module.less';
import { encryptBySM } from '@/pages/manager/utils/encrypt/sm';

const phoneRegex = /^1\d{10}$/;

const OrganizationMembersModal = (props) => {
  const { visible, onCancel, type, record, positionList, dispatch, selectedOrg, onOk, roleList } = props;
  const [form] = Form.useForm();
  const intl = useIntl();

  const [confirmLoading, setConfirmLoading] = useState(false);
  const [initialPhone, setInitialPhone] = useState('');
  // 记录是否手动修改过组织编码
  const [isCodeModified, setIsCodeModified] = useState(false);

  useEffect(() => {
    if (record?.userId) {
      dispatch({
        type: 'memberMgr/searchUser',
        payload: {
          userId: record?.userId,
          orgId: record?.orgId,
        },
        success: (res) => {
          const { data: resData } = res;
          // 处理 userType，如果是字符串则转换为数组，如果已经是数组则保持不变
          const userTypeValue = resData?.userTypes || resData?.userType;
          const userTypeArray = Array.isArray(userTypeValue) ? userTypeValue : userTypeValue ? [userTypeValue] : [];
          form.setFieldsValue({
            ...resData,
            orgName: resData?.orgName,
            orgId: resData?.orgId,
            userType: userTypeArray,
          });
          setInitialPhone(resData?.phone || '');
        },
        fail: (res) => {
          message.warning(res.msg);
          // 接口失败时，使用 record 中的数据，并处理 userType
          const userTypeValue = record?.userTypes || record?.userType;
          const userTypeArray = Array.isArray(userTypeValue) ? userTypeValue : userTypeValue ? [userTypeValue] : [];
          form.setFieldsValue({
            ...record,
            userType: userTypeArray,
          });
          setInitialPhone(record?.phone || '');
        },
      });
    } else {
      form.setFieldsValue({
        orgName: selectedOrg?.orgName,
        orgId: selectedOrg?.orgId,
      });
      setInitialPhone('');
    }
  }, [record]);

  // 将汉字转换为拼音
  const handleNameChange = (e) => {
    const nameValue = e.target.value;
    // 只有当组织编码没有被手动修改过时，才自动设置组织编码
    if (!isCodeModified && type === 'add') {
      const pinyinResult = pinyin(nameValue, {
        style: pinyin.STYLE_NORMAL, // 设置拼音风格
        heteronym: false, // 不启用多音字模式
      })
        .flat()
        .join('');

      form.setFieldsValue({
        userCode: pinyinResult,
      });
    }
  };

  const phoneRules = useMemo(() => {
    const rules = [
      {
        pattern: phoneRegex,
        message: intl.formatMessage({ id: 'orgMgr.modal.phoneRule' }),
      },
    ];
    if (type === 'edit' && record?.phone) {
      rules.pop(); // 因为经过加密，不在表单这里验证格式，否则不能直接点击保存了
      rules.push({ required: true, message: intl.formatMessage({ id: 'orgMgr.modal.phonePlaceholder' }) });
    }
    return rules;
  }, [type, record?.phone, intl]);

  return (
    <Modal
      title={
        type === 'add'
          ? intl.formatMessage({ id: 'orgMgr.modal.addMember' })
          : type === 'edit'
            ? intl.formatMessage({ id: 'orgMgr.modal.editMember' })
            : intl.formatMessage({ id: 'orgMgr.modal.memberDetail' })
      }
      width={500}
      open={visible}
      onCancel={onCancel}
      confirmLoading={confirmLoading}
      onOk={() => {
        form.validateFields().then((vals) => {
          const url = type === 'add' ? 'memberMgr/addUser' : 'memberMgr/updateUser';
          // 处理角色数据：userTypes 为数组，userType 取第一个值（兼容旧接口）
          const userTypes = Array.isArray(vals.userType) ? vals.userType : vals.userType ? [vals.userType] : [];
          const userType = userTypes.length > 0 ? userTypes[0] : vals.userType;
          const payload = {
            ...vals,
            userType,
            userTypes,
          };
          // 如果手机号有填写且与初始展示值不同，则进行加密再提交
          if (vals.phone && vals.phone !== initialPhone) {
            if (!phoneRegex.test(vals.phone)) {
              message.warning(intl.formatMessage({ id: 'orgMgr.modal.phoneRule' }));
              return;
            }
            payload.phone = encryptBySM(vals.phone);
          } else {
            delete payload.phone;
          }
          // 编辑模式下才传递 userId
          if (type === 'edit' && record?.userId) {
            payload.userId = record.userId;
          }
          setConfirmLoading(true);
          dispatch({
            type: url,
            payload,
            success: () => {
              message.success(intl.formatMessage({ id: 'common.success' }));
              onOk();
            },
            fail: (res) => {
              message.warning(res.msg);
            },
          }).finally(() => {
            setConfirmLoading(false);
          });
        });
      }}
      okButtonProps={{
        style: {
          display: type === 'detail' ? 'none' : 'block',
        },
      }}
      className={styles.organizationMembersModal}
    >
      <Form form={form} labelCol={{ span: 5 }} wrapperCol={{ span: 19 }} disabled={type === 'detail'}>
        <Form.Item
          label={intl.formatMessage({ id: 'orgMgr.modal.userName' })}
          name="userName"
          rules={[
            {
              validator: (_, value) => {
                if (value) {
                  if (value.length < 2 || value.length > 20) {
                    return Promise.reject(new Error(intl.formatMessage({ id: 'orgMgr.modal.userNameRule' })));
                  }
                  return Promise.resolve();
                }
                return Promise.reject(
                  new Error(
                    intl.formatMessage({
                      id: 'orgMgr.modal.userNamePlaceholder',
                    })
                  )
                );
              },
            },
          ]}
        >
          <Input
            placeholder={intl.formatMessage({
              id: 'orgMgr.modal.userNamePlaceholder',
            })}
            showCount
            maxLength={20}
            onChange={handleNameChange}
          />
        </Form.Item>
        <Form.Item
          label={intl.formatMessage({ id: 'orgMgr.modal.userCode' })}
          name="userCode"
          rules={[
            {
              required: true,
              message: intl.formatMessage({
                id: 'orgMgr.modal.userCodePlaceholder',
              }),
            },
            {
              min: 3,
              message: intl.formatMessage({ id: 'orgMgr.modal.userCodeRule1' }),
            },
            {
              max: 255,
              message: intl.formatMessage({ id: 'orgMgr.modal.userCodeRule2' }),
            },
          ]}
        >
          <Input
            placeholder={intl.formatMessage({
              id: 'orgMgr.modal.userCodePlaceholder',
            })}
            showCount
            maxLength={255}
            onChange={() => setIsCodeModified(true)}
            disabled={type !== 'add'}
          />
        </Form.Item>

        <Form.Item
          label={intl.formatMessage({ id: 'orgMgr.modal.belongOrgId' })}
          name="orgId"
          style={{ display: 'none' }}
        >
          <Input disabled />
        </Form.Item>

        <Form.Item label={intl.formatMessage({ id: 'orgMgr.modal.belongOrg' })} name="orgName">
          <Input disabled />
        </Form.Item>

        <Form.Item
          label={intl.formatMessage({ id: 'orgMgr.modal.userNumber' })}
          name="userNumber"
          // rules={[{ required: true, message: '请输入工号' }]}
        >
          <Input
            placeholder={intl.formatMessage({
              id: 'orgMgr.modal.userNumberPlaceholder',
            })}
          />
        </Form.Item>

        <Form.Item
          label={intl.formatMessage({ id: 'orgMgr.modal.email' })}
          name="email"
          rules={[
            // { required: true, message: '请输入邮箱' },
            {
              type: 'email',
              message: intl.formatMessage({ id: 'orgMgr.modal.emailRule' }),
            },
          ]}
        >
          <Input
            placeholder={intl.formatMessage({
              id: 'orgMgr.modal.emailPlaceholder',
            })}
          />
        </Form.Item>

        <Form.Item
          label={intl.formatMessage({ id: 'orgMgr.modal.position' })}
          name="positionId"
          rules={[
            {
              required: true,
              message: intl.formatMessage({
                id: 'orgMgr.modal.positionPlaceholder',
              }),
            },
          ]}
        >
          <Select
            allowClear
            showSearch
            options={positionList}
            fieldNames={{
              label: 'positionName',
              value: 'positionId',
            }}
            optionFilterProp="positionName"
            placeholder={intl.formatMessage({
              id: 'orgMgr.modal.positionPlaceholder',
            })}
            filterSort={(optionA, optionB) =>
              (optionA?.label ?? '').toLowerCase().localeCompare((optionB?.label ?? '').toLowerCase())
            }
          />
        </Form.Item>

        <Form.Item label={intl.formatMessage({ id: 'orgMgr.modal.phone' })} name="phone" rules={phoneRules}>
          <Input
            placeholder={intl.formatMessage({
              id: 'orgMgr.modal.phonePlaceholder',
            })}
          />
        </Form.Item>

        <Form.Item
          label={intl.formatMessage({ id: 'orgMgr.modal.role' })}
          name="userType"
          rules={[
            {
              required: true,
              message: intl.formatMessage({
                id: 'orgMgr.modal.rolePlaceholder',
              }),
            },
          ]}
        >
          <Select
            mode="multiple"
            options={roleList}
            fieldNames={{
              label: 'standDisplayValue',
              value: 'standCode',
            }}
            optionFilterProp="standDisplayValue"
            placeholder={intl.formatMessage({
              id: 'orgMgr.modal.rolePlaceholder',
            })}
            allowClear
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default connect()(OrganizationMembersModal);
