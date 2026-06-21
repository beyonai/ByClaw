import React from 'react';
import { Modal, Form, Input, Button, TreeSelect, Upload, Image, Space, message } from 'antd';
import type { UploadProps } from 'antd';
import { useIntl } from '@umijs/max';
import { compressImgFileAndUpload, getFileUrl } from '@/utils/file';
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

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number
) {
  const chars = Array.from(text || '');
  let line = '';
  let lineCount = 0;
  chars.forEach((char, index) => {
    const testLine = line + char;
    const isLast = index === chars.length - 1;
    if (ctx.measureText(testLine).width > maxWidth && line) {
      ctx.fillText(line, x, y + lineCount * lineHeight);
      line = char;
      lineCount += 1;
    } else {
      line = testLine;
    }
    if ((isLast || lineCount === maxLines - 1) && lineCount < maxLines) {
      const suffix = !isLast && lineCount === maxLines - 1 ? '...' : '';
      ctx.fillText(`${line}${suffix}`, x, y + lineCount * lineHeight);
      line = '';
      lineCount = maxLines;
    }
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

const createSkillPosterFile = async (name: string, desc: string) => {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas unsupported');
  }

  const gradients = [
    ['#ffe1c6', '#f5efff', '#d7f7e7'],
    ['#dce9ff', '#fff2c6', '#ffd9e2'],
    ['#d8fff3', '#e8efff', '#fff0d5'],
  ];
  const seed = Array.from(name || 'skill').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const colors = gradients[seed % gradients.length];
  const gradient = ctx.createLinearGradient(0, 0, 1024, 1024);
  gradient.addColorStop(0, colors[0]);
  gradient.addColorStop(0.52, colors[1]);
  gradient.addColorStop(1, colors[2]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1024, 1024);

  ctx.globalAlpha = 0.42;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(780, 210, 170, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.28;
  ctx.beginPath();
  ctx.arc(225, 800, 230, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.fillStyle = 'rgba(20,22,26,0.86)';
  ctx.font = '800 82px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.textBaseline = 'top';
  const title = name || 'Skill';
  wrapText(ctx, title, 86, 160, 820, 96, 3);

  ctx.fillStyle = 'rgba(20,22,26,0.58)';
  ctx.font = '500 34px "PingFang SC", "Microsoft YaHei", sans-serif';
  wrapText(ctx, desc || '智能技能资源', 90, 570, 790, 48, 4);

  ctx.fillStyle = 'rgba(20,22,26,0.88)';
  roundRect(ctx, 90, 850, 280, 72, 36);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = '700 30px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText('BYAI SKILL', 132, 870);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('Generate image failed'))), 'image/png');
  });
  return new File([blob], `${name || 'skill'}-poster.png`, { type: 'image/png' });
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
      const file = await createSkillPosterFile(
        values.resourceName || item?.resourceName,
        values.resourceDesc || item?.resourceDesc
      );
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
