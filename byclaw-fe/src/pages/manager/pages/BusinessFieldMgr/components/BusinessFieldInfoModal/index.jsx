import React, { useEffect, useState } from 'react';
import { connect } from 'dva';
import { Form, Input, message, TreeSelect, Modal, InputNumber } from 'antd';
import { useIntl } from '@umijs/max';

const BusinessFieldInfoModal = ({ visible, onCancel, type, record, dispatch, onOk }) => {
  const [form] = Form.useForm();
  const intl = useIntl();
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [treeData, setTreeData] = useState([]);

  useEffect(() => {
    if (visible) {
      dispatch({
        type: 'businessFieldMgr/getFieldTree',
        payload: {},
        success: (res) => {
          const { data } = res;
          // 将接口返回的字段映射为组件使用的字段
          const mappedData = (data || []).map((item) => ({
            ...item,
            fieldId: item.catalogId,
            fieldName: item.catalogName,
            fieldDesc: item.catalogDesc || item.remark,
            parentFieldId: item.pCatalogId || item.parentCatalogId || item.pcatalogId,
            // 排序字段统一使用后端的 orderIndex
            fieldIndex: item.orderIndex,
          }));
          setTreeData([
            ...mappedData,
            {
              fieldId: -1,
              fieldName: intl.formatMessage({ id: 'businessField.rootNode' }),
              parentFieldId: '',
            },
          ]);
        },
        fail: (res) => {
          message.warning(res.msg || intl.formatMessage({ id: 'businessField.getTreeFail' }));
        },
      });
    }
  }, [visible]);

  useEffect(() => {
    if (record && visible) {
      form.setFieldsValue({
        ...record,
        // 兼容：如果没有 orderIndex，则兜底用 fieldIndex
        orderIndex: record?.orderIndex !== undefined ? record.orderIndex : record?.fieldIndex,
      });
    }
  }, [record, visible]);

  const handleOk = () => {
    form.validateFields().then((vals) => {
      setConfirmLoading(true);

      if (type === 'add') {
        // 新增：将表单字段映射为接口需要的字段格式
        const payload = {
          catalogName: vals.fieldName,
          catalogDesc: vals.fieldDesc || '',
          catalogType: 6,
          pCatalogId: vals.parentFieldId || null,
          // 排序号：前端字段 orderIndex 与后端字段保持同名
          orderIndex: vals.orderIndex ?? null,
        };

        dispatch({
          type: 'businessFieldMgr/addField',
          payload,
          success: () => {
            message.success(intl.formatMessage({ id: 'common.success' }));
            form.resetFields();
            setConfirmLoading(false);
            onOk();
          },
          fail: (res) => {
            message.warning(res.msg || intl.formatMessage({ id: 'common.fail' }));
            setConfirmLoading(false);
          },
        });
      } else {
        // 编辑：将表单字段映射为接口需要的字段格式
        const selfId = record?.fieldId || record?.catalogId;
        // 安全兜底：不允许选择自己作为父级
        if (vals.parentFieldId && vals.parentFieldId === selfId) {
          message.warning(intl.formatMessage({ id: 'businessField.parentFieldSelfError' }));
          setConfirmLoading(false);
          return;
        }

        const payload = {
          catalogId: selfId,
          catalogName: vals.fieldName,
          catalogDesc: vals.fieldDesc || '',
          catalogType: 6,
          // 编辑时允许修改父级
          pCatalogId: vals.parentFieldId || null,
          orderIndex: vals.orderIndex ?? null,
        };

        dispatch({
          type: 'businessFieldMgr/updateField',
          payload,
          success: () => {
            message.success(intl.formatMessage({ id: 'common.success' }));
            form.resetFields();
            setConfirmLoading(false);
            onOk();
          },
          fail: (res) => {
            message.warning(res.msg || intl.formatMessage({ id: 'common.fail' }));
            setConfirmLoading(false);
          },
        });
      }
    });
  };

  return (
    <Modal
      title={
        type === 'add'
          ? intl.formatMessage({ id: 'businessField.addTitle' })
          : intl.formatMessage({ id: 'businessField.editTitle' })
      }
      open={visible}
      onCancel={onCancel}
      width={480}
      confirmLoading={confirmLoading}
      onOk={handleOk}
    >
      <Form form={form} layout="vertical">
        <Form.Item
          label={intl.formatMessage({ id: 'businessField.fieldName' })}
          name="fieldName"
          rules={[
            { required: true, message: intl.formatMessage({ id: 'businessField.fieldNameRequired' }) },
            { max: 50, message: intl.formatMessage({ id: 'businessField.fieldNameMaxLength' }) },
          ]}
        >
          <Input
            placeholder={intl.formatMessage({ id: 'businessField.fieldNamePlaceholder' })}
            maxLength={50}
            showCount
          />
        </Form.Item>
        <Form.Item label={intl.formatMessage({ id: 'businessField.fieldDesc' })} name="fieldDesc">
          <Input.TextArea
            rows={4}
            placeholder={intl.formatMessage({ id: 'businessField.fieldDescPlaceholder' })}
            maxLength={500}
            showCount
          />
        </Form.Item>
        <Form.Item label={intl.formatMessage({ id: 'businessField.orderIndex' })} name="orderIndex">
          <InputNumber
            placeholder={intl.formatMessage({ id: 'businessField.orderIndexPlaceholder' })}
            style={{ width: '100%' }}
            min={0}
          />
        </Form.Item>
        <Form.Item label={intl.formatMessage({ id: 'businessField.parentField' })} name="parentFieldId">
          <TreeSelect
            treeData={(treeData || []).map((item) => {
              const selfId = record?.fieldId || record?.catalogId;
              return {
                ...item,
                // 编辑时，禁用当前节点，防止选择自身作为父级
                disabled: type === 'edit' && (item.fieldId === selfId || item.catalogId === selfId),
              };
            })}
            placeholder={intl.formatMessage({ id: 'businessField.parentFieldPlaceholder' })}
            dropdownStyle={{ maxHeight: 200, overflow: 'auto' }}
            treeDataSimpleMode={{
              id: 'fieldId',
              pId: 'parentFieldId',
            }}
            fieldNames={{
              label: 'fieldName',
              value: 'fieldId',
            }}
            showSearch
            treeNodeFilterProp="fieldName"
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default connect()(BusinessFieldInfoModal);
