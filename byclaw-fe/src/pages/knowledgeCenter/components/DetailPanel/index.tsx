import React, { useCallback, useEffect, useState } from 'react';

import { Form, Input, message, Modal, TreeSelect } from 'antd';
// @ts-ignore
import { useIntl } from '@umijs/max';

import PagePhoto from '@/components/PagePhoto';
import { createAndShelf, queryResourceDetail, updateResource } from '@/service/knowledgeCenter';
import { getPublicPath } from '@/utils';
import { compressImgFileAndUpload } from '@/utils/file';
import styles from './index.module.less';
import { ResourceTypeMap } from '@/constants/resource';

interface DetailPanelProps {
  onCancel: () => void;
  onOk: (resourceName?: string) => void;
  ownerType?: 'enterprise' | 'personal';
  mode?: 'create' | 'edit';
  info?: any;
  createType?: 'create' | 'import';
  catalogId?: string | number;
  catalogList?: Array<{ catalogId: string | number; catalogName: string; pcatalogId?: string | number }>;
}

const DetailPanel: React.FC<DetailPanelProps> = ({
  onCancel,
  onOk,
  ownerType = 'personal',
  mode = 'create',
  info,
  createType = 'create',
  catalogId,
  catalogList = [],
}) => {
  const intl = useIntl();
  const [form] = Form.useForm();

  const [isLoading, setIsLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailInfo, setDetailInfo] = useState<any>(info || {});

  useEffect(() => {
    let mounted = true;

    const fetchDetail = async () => {
      if (mode !== 'edit' || !info?.resourceId) {
        setDetailInfo(info || {});
        return;
      }
      setDetailLoading(true);
      try {
        const data = (await queryResourceDetail({ resourceId: info.resourceId })) || {};
        if (!mounted) return;
        setDetailInfo(data);
        form.setFieldsValue({
          resourceName: data?.resourceName,
          resourceDesc: data?.resourceDesc,
          type: data?.type || info?.type || 'dataset',
          catalogId: data?.catalogId ?? catalogId,
        });
      } catch (error) {
        if (mounted) {
          setDetailInfo(info || {});
          form.setFieldsValue({
            resourceName: info?.resourceName,
            resourceDesc: info?.resourceDesc,
            type: info?.type || 'dataset',
            catalogId: info?.catalogId ?? catalogId,
          });
        }
      } finally {
        if (mounted) {
          setDetailLoading(false);
        }
      }
    };

    fetchDetail();
    return () => {
      mounted = false;
    };
  }, [catalogId, form, info, mode]);

  const handleOk = useCallback(
    async (values: any) => {
      setIsLoading(true);

      const { resourceName, resourceDesc, logo, catalogId: selectedCatalogId } = values;
      try {
        if (logo && logo instanceof File) {
          const imgRes = await compressImgFileAndUpload({ file: logo });
          // 入参少个s
          values.datasetLogoId = imgRes?.datasetLogosId;
          values.resourceLogoUrl = imgRes?.datasetLogosUrl;
        }
        delete values.logo;

        const commonPayload = {
          systemCode: 'BYAI',
          resourceBizType: ResourceTypeMap.knowledgeBase,
          resourceDesc,
          resourceName,
          avatar: values.resourceLogoUrl || detailInfo?.avatar || info?.avatar,
          datasetLogoId: values.datasetLogoId || detailInfo?.datasetLogoId || info?.datasetLogoId,
          type: 'dataset',
          catalogId: selectedCatalogId || undefined,
        };
        if (mode === 'edit') {
          await updateResource({
            ...commonPayload,
            resourceId: info?.resourceId,
          });
        } else {
          await createAndShelf({
            ...commonPayload,
            ownerType,
          });
        }
        onOk(resourceName);
        message.success(intl.formatMessage({ id: 'common.saveSuccess' }));
      } catch (error) {
        console.error(error);
        message.error(error as string);
      } finally {
        setIsLoading(false);
      }
    },
    [
      detailInfo?.avatar,
      detailInfo?.datasetLogoId,
      info?.avatar,
      info?.datasetLogoId,
      info?.resourceId,
      intl,
      mode,
      onOk,
      ownerType,
    ]
  );

  const modalTitle = '知识库信息';

  return (
    <Modal
      title={modalTitle}
      open
      onCancel={onCancel}
      onOk={() => {
        form.validateFields().then((values) => {
          handleOk(values);
        });
      }}
      className={styles.addWrap}
      width={560}
      confirmLoading={isLoading || detailLoading}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          resourceName: info?.resourceName,
          resourceDesc: info?.resourceDesc,
          type: info?.type || (createType === 'import' ? 'external' : 'dataset'),
          catalogId: info?.catalogId ?? catalogId,
        }}
      >
        <div className="ub">
          <Form.Item name="logo">
            <PagePhoto
              defaultImage={`${getPublicPath()}imgs/knowledgeCenter/defKnowledgeIcon.png`}
              uploadProps={{
                className: styles.pagePhotoWrap,
              }}
            />
          </Form.Item>
          <div className="ub-f1 ub ub-ver">
            <Form.Item
              name="resourceName"
              label={intl.formatMessage({
                id: 'knowledgeCenter.knowledgeBaseName',
              })}
              rules={[
                {
                  required: true,
                  message: intl.formatMessage(
                    { id: 'form.inputPlaceholder' },
                    {
                      content: intl.formatMessage({
                        id: 'knowledgeCenter.knowledgeBaseName',
                      }),
                    }
                  ),
                },
              ]}
            >
              <Input
                placeholder={intl.formatMessage(
                  { id: 'form.inputPlaceholder' },
                  {
                    content: intl.formatMessage({
                      id: 'knowledgeCenter.knowledgeBaseName',
                    }),
                  }
                )}
              />
            </Form.Item>
          </div>
        </div>
        <Form.Item
          name="resourceDesc"
          label={intl.formatMessage({ id: 'addModal.intro' })}
          rules={[{ required: true, message: intl.formatMessage({ id: 'addModal.intro' }) }]}
        >
          <Input.TextArea
            placeholder={intl.formatMessage(
              { id: 'form.inputPlaceholder' },
              { content: intl.formatMessage({ id: 'addModal.intro' }) }
            )}
            rows={3}
          />
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

export default DetailPanel;
