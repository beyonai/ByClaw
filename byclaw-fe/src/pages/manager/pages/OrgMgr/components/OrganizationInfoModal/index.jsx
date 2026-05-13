import React, { useEffect, useState } from 'react';
import { connect } from 'dva';
import { Form, Input, message, TreeSelect, Modal, InputNumber } from 'antd';
import { useIntl } from '@umijs/max';
import pinyin from 'pinyin';

const OrganizationInfoModal = ({ visible, onCancel, type, record, dispatch, onOk }) => {
  const [form] = Form.useForm();
  const intl = useIntl();

  const [confirmLoading, setConfirmLoading] = useState(false);
  const [treeData, setTreeData] = useState([]);
  // 记录是否手动修改过组织编码
  const [isCodeModified, setIsCodeModified] = useState(false);

  useEffect(() => {
    dispatch({
      type: 'orgMgr/getOrgTree',
      payload: {},
      success: (res) => {
        const { data } = res;

        setTreeData([
          ...data,
          {
            orgId: -1,
            orgName: '',
            parentOrgId: '',
            pathCode: '',
          },
        ]);
      },
      fail: (res) => {
        message.warning(res.msg);
      },
    });
  }, []);

  useEffect(() => {
    if (record) {
      form.setFieldsValue({
        ...record,
        // parentOrgId: record.parentOrgId === -1 ? null : record.parentOrgId,
      });
      // 编辑模式时认为组织编码已被修改过
      if (type === 'edit') {
        setIsCodeModified(true);
      }
    }
  }, [record]);

  // 将汉字转换为拼音
  const handleNameChange = (e) => {
    const nameValue = e.target.value;
    // 只有当组织编码没有被手动修改过时，才自动设置组织编码
    if (!isCodeModified) {
      const pinyinResult = pinyin(nameValue, {
        style: pinyin.STYLE_NORMAL, // 设置拼音风格
        heteronym: false, // 不启用多音字模式
      })
        .flat()
        .join('');

      form.setFieldsValue({
        orgCode: pinyinResult,
      });
    }
  };

  return (
    <Modal
      title={
        type === 'add'
          ? intl.formatMessage({ id: 'orgMgr.modal.addOrg' })
          : intl.formatMessage({ id: 'orgMgr.modal.editOrg' })
      }
      open={visible}
      onCancel={onCancel}
      width={480}
      footer={type === 'detail' ? null : undefined}
      confirmLoading={confirmLoading}
      onOk={() => {
        form.validateFields().then((vals) => {
          setConfirmLoading(true);
          const url = type === 'add' ? 'orgMgr/addOrg' : 'orgMgr/updateOrg';

          dispatch({
            type: url,
            payload: {
              ...vals,
              orgId: record.orgId,
            },
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
    >
      <Form form={form} labelCol={{ span: 5 }} wrapperCol={{ span: 19 }} disabled={type === 'detail'}>
        <Form.Item
          label={intl.formatMessage({ id: 'orgMgr.modal.orgName' })}
          name="orgName"
          rules={[
            {
              validator: (_, value) => {
                if (value) {
                  if (value.length > 50) {
                    return Promise.reject(new Error(intl.formatMessage({ id: 'orgMgr.modal.orgNameRule1' })));
                  }
                  if (/[^\u4e00-\u9fa5a-zA-Z0-9_]/.test(value)) {
                    return Promise.reject(new Error(intl.formatMessage({ id: 'orgMgr.modal.orgNameRule2' })));
                  }
                  return Promise.resolve();
                }
                return Promise.reject(
                  new Error(
                    intl.formatMessage({
                      id: 'orgMgr.modal.orgNamePlaceholder',
                    })
                  )
                );
              },
            },
          ]}
        >
          <Input
            placeholder={intl.formatMessage({
              id: 'orgMgr.modal.orgNamePlaceholder',
            })}
            showCount
            maxLength={50}
            onChange={handleNameChange}
          />
        </Form.Item>
        <Form.Item
          label={intl.formatMessage({ id: 'orgMgr.modal.orgCode' })}
          name="orgCode"
          rules={[
            {
              validator: (_, value) => {
                if (value) {
                  if (/[^a-zA-Z0-9_]/.test(value)) {
                    return Promise.reject(new Error(intl.formatMessage({ id: 'orgMgr.modal.orgCodeRule' })));
                  }
                  return Promise.resolve();
                }
                return Promise.reject(
                  new Error(
                    intl.formatMessage({
                      id: 'orgMgr.modal.orgCodePlaceholder',
                    })
                  )
                );
              },
            },
          ]}
        >
          <Input
            placeholder={intl.formatMessage({
              id: 'orgMgr.modal.orgCodePlaceholder',
            })}
            showCount
            maxLength={50}
            onChange={() => setIsCodeModified(true)}
          />
        </Form.Item>
        <Form.Item
          label={intl.formatMessage({ id: 'orgMgr.modal.parentOrg' })}
          name="parentOrgId"
          // rules={[{ required: true, message: '请选择上级组织' }]}
        >
          {/* <Select placeholder="请选择上级组织">
            <Select.Option value="数智研发中心">数智研发中心</Select.Option>
            <Select.Option value="数据研发事业部">数据研发事业部</Select.Option>
          </Select> */}
          <TreeSelect
            disabled={type === 'detail' || type === 'edit' || (type === 'add' && record?.parentOrgId)}
            treeData={treeData}
            placeholder={
              record?.parentOrgId === -1
                ? ''
                : intl.formatMessage({
                  id: 'orgMgr.modal.parentOrgPlaceholder',
                })
            }
            dropdownStyle={{ maxHeight: 200, overflow: 'auto' }}
            treeDataSimpleMode={{
              id: 'orgId',
              pId: 'parentOrgId',
            }}
            fieldNames={{
              label: 'orgName',
              value: 'orgId',
            }}
          />
        </Form.Item>
        <Form.Item
          label={intl.formatMessage({ id: 'orgMgr.modal.orgIndex' })}
          name="orgIndex"
          // rules={[{ required: true, message: '请输入排序号' }]}
        >
          <InputNumber
            placeholder={intl.formatMessage({
              id: 'orgMgr.modal.orgIndexPlaceholder',
            })}
            // 手动输入的小数，保留小数点后的
            parser={(value) => Number(value.replace(/.*\./g, ''))}
            style={{ width: '100%' }}
          />
        </Form.Item>
        <Form.Item label={intl.formatMessage({ id: 'orgMgr.modal.orgDesc' })} name="orgDesc">
          <Input.TextArea
            rows={4}
            placeholder={intl.formatMessage({
              id: 'orgMgr.modal.orgDescPlaceholder',
            })}
            maxLength={500}
            showCount
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default connect()(OrganizationInfoModal);
