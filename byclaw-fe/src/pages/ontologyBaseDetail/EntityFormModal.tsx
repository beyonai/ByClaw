// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { Form, Input, Modal, Select, message } from 'antd';
import { useIntl } from '@umijs/max';
import {
  createOntologyObject,
  createOntologyScene,
  createOntologyView,
  updateOntologyObject,
  updateOntologyScene,
  updateOntologyView,
} from '@/service/ontology';

const { TextArea } = Input;

/**
 * 本体实体新建/编辑弹窗（场景 / 对象 / 视图，仅元信息）。
 * 编辑时编码只读；新建时编码可留空由服务端生成。
 */
const EntityFormModal = ({
  open,
  type,
  mode,
  baseId,
  initial,
  objectOptions = [],
  onCancel,
  onSuccess,
}: {
  open: boolean;
  type: 'scene' | 'object' | 'view';
  mode: 'create' | 'edit';
  baseId: string;
  initial?: any;
  objectOptions?: { label: string; value: string }[];
  onCancel: () => void;
  onSuccess: () => void;
}) => {
  const intl = useIntl();
  const t = (id: string, values?: any) => intl.formatMessage({ id }, values);
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const isEdit = mode === 'edit';

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    if (initial) {
      form.setFieldsValue(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const typeName =
    type === 'scene'
      ? t('employeeDetail.ontology.scene')
      : type === 'object'
        ? t('common.resourceType.object')
        : t('common.resourceType.view');

  const handleOk = async () => {
    const v = await form.validateFields();
    setSubmitting(true);
    try {
      let res: any;
      if (type === 'scene') {
        const payload: any = { sceneName: v.name, sceneDesc: v.desc };
        if (!isEdit && v.code) payload.sceneCode = v.code;
        res = isEdit
          ? await updateOntologyScene({ baseId, sceneId: initial.sceneId, payload })
          : await createOntologyScene({ baseId, payload });
      } else if (type === 'object') {
        const payload: any = {
          objectName: v.name,
          objectDesc: v.desc,
          objectSource: v.source,
          conceptType: v.conceptType,
        };
        if (!isEdit) payload.objectCode = v.code || undefined;
        res = isEdit
          ? await updateOntologyObject({ baseId, objectCode: initial.objectCode, payload })
          : await createOntologyObject({ baseId, payload });
      } else {
        const payload: any = { viewName: v.name, description: v.desc, objectCodes: v.objectCodes };
        if (!isEdit) payload.viewCode = v.code || undefined;
        res = isEdit
          ? await updateOntologyView({ baseId, viewCode: initial.viewCode, payload })
          : await createOntologyView({ baseId, payload });
      }
      if (res && res.code !== undefined && res.code !== 0 && res.code !== 200) {
        message.error(res.msg || res.message || t('common.operationFailed'));
        return;
      }
      message.success(t('common.saveSuccess'));
      form.resetFields();
      onSuccess();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(typeof e === 'string' ? e : e?.message || t('common.operationFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      title={`${t(isEdit ? 'common.edit' : 'common.create')} ${typeName}`}
      okText={t('common.confirm')}
      cancelText={t('common.cancel')}
      confirmLoading={submitting}
      onOk={handleOk}
      onCancel={() => {
        form.resetFields();
        onCancel();
      }}
      destroyOnClose
    >
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item
          name="name"
          label={t('ontologyBaseDetail.form.name')}
          rules={[{ required: true, message: t('ontologyBaseDetail.form.nameRequired') }]}
        >
          <Input maxLength={64} />
        </Form.Item>

        {!isEdit && (
          <Form.Item name="code" label={t('ontologyBaseDetail.form.code')} extra={t('ontologyBaseDetail.form.codeTip')}>
            <Input maxLength={64} />
          </Form.Item>
        )}

        {type === 'object' && (
          <>
            <Form.Item name="source" label={t('ontologyBaseDetail.form.source')}>
              <Select
                allowClear
                options={[
                  { value: 'DB', label: 'DB' },
                  { value: 'DYNAMIC_TABLE', label: 'DYNAMIC_TABLE' },
                  { value: 'KNOWLEDGE_BASE', label: 'KNOWLEDGE_BASE' },
                ]}
              />
            </Form.Item>
            <Form.Item name="conceptType" label={t('ontologyBaseDetail.form.conceptType')}>
              <Select
                allowClear
                options={[
                  { value: '1', label: t('ontologyCenter.detail.conceptEntity') },
                  { value: '2', label: t('ontologyCenter.detail.conceptActivity') },
                ]}
              />
            </Form.Item>
          </>
        )}

        {type === 'view' && (
          <Form.Item name="objectCodes" label={t('ontologyBaseDetail.form.objects')}>
            <Select mode="multiple" allowClear options={objectOptions} optionFilterProp="label" />
          </Form.Item>
        )}

        <Form.Item name="desc" label={t('ontologyBaseDetail.form.desc')}>
          <TextArea autoSize={{ minRows: 2, maxRows: 4 }} maxLength={200} />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default EntityFormModal;
