import React from 'react';
import { Modal, Form, Input, Button, TreeSelect, Upload, Image, Space, message } from 'antd';
import type { UploadProps } from 'antd';
import { useIntl } from '@umijs/max';
import { compressImgFileAndUpload, getFileUrl } from '@/utils/file';
import { generateResourceImage } from '@/pages/manager/service/resources';
import styles from './index.module.less';

interface IResourceItem {
  resourceName: string;
  description?: string;
  resourceDesc?: string;
  resourceLogoUrl?: string;
  avatar?: string;
  createUserName?: string;
  createTime?: number | string;
  resourceBizType?: string;
  resourceSourcePkId?: string;
  resourceId: string;
  catalogId?: string | number;
}

const base64ToFile = (base64: string, mimeType = 'image/png', fileName = 'resource-ai-cover.png') => {
  const pureBase64 = base64.includes(',') ? base64.split(',').pop() || '' : base64;
  const binary = window.atob(pureBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new File([bytes], fileName, { type: mimeType });
};

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
  const avatarValue = Form.useWatch('avatar', form);
  const [avatarUploadLoading, setAvatarUploadLoading] = React.useState(false);
  const [avatarGenerateLoading, setAvatarGenerateLoading] = React.useState(false);

  // 当item变化时，设置表单字段的值
  React.useEffect(() => {
    if (item) {
      form.setFieldsValue({
        resourceName: item.resourceName,
        resourceDesc: item.resourceDesc,
        avatar: item.resourceLogoUrl || item.avatar,
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

  const uploadAvatarFile = async (file: File) => {
    const res: any = await compressImgFileAndUpload({ file });
    const url = res?.datasetLogosUrl || res?.fileUrl;
    if (url) {
      form.setFieldValue('avatar', url);
    }
  };

  const handleUploadBefore: UploadProps['beforeUpload'] = (file) => {
    setAvatarUploadLoading(true);
    uploadAvatarFile(file)
      .then(() => {
        message.success(intl.formatMessage({ id: 'resource.imageUploadSuccess' }));
      })
      .catch((error) => {
        message.error(error?.message || intl.formatMessage({ id: 'resource.imageUploadFailed' }));
      })
      .finally(() => {
        setAvatarUploadLoading(false);
      });
    return false;
  };

  const handleGenerateAvatar = async () => {
    setAvatarGenerateLoading(true);
    try {
      const values = form.getFieldsValue();
      const image = await generateResourceImage({
        resourceName: values.resourceName || item?.resourceName,
        resourceDesc: values.resourceDesc || item?.resourceDesc,
      });
      if (!image?.imageBase64) {
        throw new Error(intl.formatMessage({ id: 'resource.imageGenerateFailed' }));
      }
      const file = base64ToFile(image.imageBase64, image.mimeType, image.fileName);
      await uploadAvatarFile(file);
      message.success(intl.formatMessage({ id: 'resource.imageGenerateSuccess' }));
    } catch (error: any) {
      message.error(error?.message || intl.formatMessage({ id: 'resource.imageGenerateFailed' }));
    } finally {
      setAvatarGenerateLoading(false);
    }
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
        {resourceType === 'SKILL' && (
          <>
            <Form.Item name="avatar" hidden>
              <Input />
            </Form.Item>
            <Form.Item label={intl.formatMessage({ id: 'resource.image' })}>
              <div className={styles.resourceImageEditor}>
                <div className={styles.resourceImagePreview}>
                  {avatarValue ? (
                    <Image src={getFileUrl(avatarValue)} width="100%" height="100%" preview={false} />
                  ) : (
                    <div className={styles.resourceImagePlaceholder}>{intl.formatMessage({ id: 'common.skill' })}</div>
                  )}
                </div>
                <Space>
                  <Upload accept="image/*" showUploadList={false} beforeUpload={handleUploadBefore}>
                    <Button loading={avatarUploadLoading} disabled={avatarGenerateLoading}>
                      {intl.formatMessage({ id: 'common.upload' })}
                    </Button>
                  </Upload>
                  <Button loading={avatarGenerateLoading} disabled={avatarUploadLoading} onClick={handleGenerateAvatar}>
                    {intl.formatMessage({ id: 'resource.imageGenerate' })}
                  </Button>
                </Space>
              </div>
            </Form.Item>
          </>
        )}
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
