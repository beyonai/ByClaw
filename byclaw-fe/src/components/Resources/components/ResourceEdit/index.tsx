import React from 'react';
import { Modal, Form, Input, Button, TreeSelect } from 'antd';
import { useIntl } from '@umijs/max';

interface IResourceItem {
  resourceName: string;
  description?: string;
  resourceDesc?: string;
  resourceLogoUrl?: string;
  createUserName?: string;
  createTime?: number | string;
  resourceBizType?: string;
  resourceSourcePkId?: string;
  resourceId: string;
  catalogId?: string | number;
}

interface ResourceEditProps {
  visible: boolean;
  item: IResourceItem | null;
  fromDetailPanel?: boolean;
  resourceType: string;
  catalogList: Array<{ catalogId: string | number; catalogName: string; pcatalogId?: string | number }>;
  onCancel: () => void;
  onSave: (values: any) => void;
}

const ResourceEdit: React.FC<ResourceEditProps> = ({ visible, item, resourceType, catalogList, onCancel, onSave }) => {
  const [form] = Form.useForm();
  const intl = useIntl();

  // 当item变化时，设置表单字段的值
  React.useEffect(() => {
    if (item) {
      form.setFieldsValue({
        resourceName: item.resourceName,
        resourceDesc: item.resourceDesc,
        catalogId: item.catalogId === '-1' ? undefined : item.catalogId,
      });
      return;
    }
    form.resetFields();
  }, [item, form, visible]);

  const getTypeName = (type: string) => {
    switch ((type || '').toUpperCase()) {
      case 'TOOL':
        return intl.formatMessage({ id: 'common.tool' });
      case 'OBJECT':
        return intl.formatMessage({ id: 'common.object' });
      case 'VIEW':
        return intl.formatMessage({ id: 'common.viewName' });
      default:
        return intl.formatMessage({ id: 'common.resource' });
    }
  };

  const typeName = getTypeName(resourceType);

  const handleCancel = () => {
    onCancel();
  };

  return (
    <Modal
      title={`${typeName}${intl.formatMessage({ id: 'common.edit' })}`}
      open={visible}
      onCancel={handleCancel}
      width={800}
      destroyOnHidden
      footer={[
        <Button key="cancel" onClick={handleCancel}>
          {intl.formatMessage({ id: 'common.cancel' })}
        </Button>,
        <Button
          key="save"
          type="primary"
          onClick={() => {
            form.validateFields().then((values) => {
              const params = {
                ...values,
                resourceId: item?.resourceId,
              };
              onSave(params);
            });
          }}
        >
          {intl.formatMessage({ id: 'common.save' })}
        </Button>,
      ]}
    >
      <Form form={form} layout="vertical">
        <Form.Item
          label={`${typeName}${intl.formatMessage({ id: 'common.title' })}`}
          name="resourceName"
          rules={[
            {
              required: true,
              message: `${intl.formatMessage({ id: 'form.input' })}`,
            },
          ]}
        >
          <Input />
        </Form.Item>
        <Form.Item
          label={`${typeName}${intl.formatMessage({ id: 'common.description' })}`}
          name="resourceDesc"
          rules={[
            {
              required: true,
              message: `${intl.formatMessage({ id: 'form.input' })}`,
            },
          ]}
        >
          <Input.TextArea rows={3} />
        </Form.Item>
        <Form.Item
          label={intl.formatMessage({ id: 'resource.belongField' })}
          name="catalogId"
          // rules={[
          //   {
          //     required: true,
          //     message: `${intl.formatMessage({ id: 'form.select' })}`,
          //   },
          // ]}
        >
          <TreeSelect
            allowClear
            treeData={catalogList}
            placeholder={intl.formatMessage({ id: 'resource.belongFieldPlaceholder' })}
            treeDataSimpleMode={{
              id: 'catalogId',
              pId: 'pcatalogId',
              rootPId: -1,
            }}
            fieldNames={{
              label: 'catalogName',
              value: 'catalogId',
            }}
            showSearch
            treeNodeFilterProp="catalogName"
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default ResourceEdit;
