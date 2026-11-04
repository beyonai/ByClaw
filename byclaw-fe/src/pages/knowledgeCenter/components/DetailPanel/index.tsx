import { publicationErrorMessage } from '@/utils/publicationError';
import { nanoid } from 'nanoid';
import { queryKnowledgeCapability, type KnowledgeCapability } from '@/service/knowledgeCenter';
import ScopeSelector from '@/components/ResourcePublication/ScopeSelector';
import { validPublishScope } from '@/service/resourcePublication';
import React, { useCallback, useEffect, useState, useRef } from 'react';

import { Form, Input, message, Modal, Select, TreeSelect } from 'antd';
// @ts-ignore
import { useIntl } from '@umijs/max';

import AntdIcon from '@/components/AntdIcon';
import { createAndShelf, queryResourceDetail, updateResource } from '@/service/knowledgeCenter';
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
  const creationKey = useRef(nanoid());
  const [capability, setCapability] = useState<KnowledgeCapability>();
  useEffect(() => {
    if (mode === 'create')
      queryKnowledgeCapability()
        .then(setCapability)
        .catch(() => setCapability(undefined));
  }, [mode]);

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

      const { resourceName, resourceDesc, catalogId: selectedCatalogId } = values;
      try {
        const commonPayload = {
          systemCode: 'BYAI',
          resourceBizType: ResourceTypeMap.knowledgeBase,
          resourceDesc,
          resourceName,
          avatar: detailInfo?.avatar || info?.avatar,
          datasetLogoId: detailInfo?.datasetLogoId || info?.datasetLogoId,
          type: 'dataset',
          catalogId: selectedCatalogId || undefined,
        };
        if (mode === 'edit') {
          await updateResource({
            ...commonPayload,
            resourceId: info?.resourceId,
          });
        } else {
          const created = await createAndShelf({
            ...commonPayload,
            ownerType,
            providerId: values.providerId,
            idempotencyKey: creationKey.current,
            publishScope: ownerType === 'enterprise' ? values.publishScope : undefined,
          });
          if (created?.publicationError) message.warning(intl.formatMessage({ id: 'rp.publicationFailed' }));
        }
        onOk(resourceName);
        message.success(intl.formatMessage({ id: 'common.saveSuccess' }));
      } catch (error) {
        console.error(error);
        message.error(publicationErrorMessage(error, intl.formatMessage({ id: 'rp.failed' })));
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
          publishScope: { mode: 'COMPANY' },
          type: info?.type || (createType === 'import' ? 'external' : 'dataset'),
          catalogId: info?.catalogId ?? catalogId,
        }}
      >
        {mode === 'create' && capability?.knowledgeMode === 'THIRD_PARTY' && (
          <Form.Item name="providerId" label={intl.formatMessage({ id: 'rp.provider' })} rules={[{ required: true }]}>
            <Select
              options={capability.creationProviders?.map((p) => ({ value: p.providerId, label: p.providerName }))}
            />
          </Form.Item>
        )}
        <div className="ub">
          <div className={styles.pagePhotoWrap}>
            <AntdIcon type="icon-chuangjianfangshi-wendangku" className={styles.knowledgeLogoIcon} />
          </div>
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
        {mode === 'create' && ownerType === 'enterprise' && (
          <Form.Item
            name="publishScope"
            label={intl.formatMessage({ id: 'rp.scope' })}
            rules={[
              {
                validator: (_, value) =>
                  validPublishScope(value)
                    ? Promise.resolve()
                    : Promise.reject(new Error(intl.formatMessage({ id: 'rp.organizations' }))),
              },
            ]}
          >
            <ScopeSelector />
          </Form.Item>
        )}
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
