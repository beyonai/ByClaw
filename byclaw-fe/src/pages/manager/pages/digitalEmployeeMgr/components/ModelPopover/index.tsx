// @ts-nocheck
import React, { useCallback, useEffect, useState } from 'react';
import { Button, Form, Input, Radio, Spin, Tabs } from 'antd';
import { merge } from 'lodash';
import { useIntl } from '@umijs/max';
import { POST } from '@/service/common/request';
import styles from './index.module.less';

const ModelPopover = (props) => {
  const { modelList, prologueRef, update, setModelName, onClose } = props;
  const intl = useIntl();

  const prologue = prologueRef.current;
  const [form] = Form.useForm();
  const [activeTab, setActiveTab] = useState('public');
  const [personalModels, setPersonalModels] = useState([]);
  const [publicModels, setPublicModels] = useState(modelList || []);
  const [loading, setLoading] = useState(false);

  const fetchModels = useCallback(async (ownerType: string) => {
    setLoading(true);
    try {
      if (ownerType === 'PERSONAL') {
        const res: any = await POST('/byaiService/personal/model/list', {
          status: 'ENABLED',
          pageNum: 1,
          pageSize: 200,
        });
        const rows = res?.rows || res?.data?.rows || [];
        return rows.map((item: any) => ({
          modelId: item.id,
          modelName: item.displayName,
          modelNo: item.modelCode,
        }));
      }
      const res: any = await POST('/byaiService/new/model/listModel', {
        tagId: '3',
        status: 'OOA',
        ownerType: 'PUBLIC',
      });
      return res?.data || res || [];
    } catch {
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchModels('PUBLIC').then(setPublicModels);
    fetchModels('PERSONAL').then(setPersonalModels);
  }, []);

  useEffect(() => {
    if (prologue) {
      form.setFieldsValue({ prologue });
    }
  }, []);

  const currentList = activeTab === 'mine' ? personalModels : publicModels;

  const handleSelect = (modelId: number) => {
    const allModels = [...personalModels, ...publicModels];
    const selected = allModels.find((m) => m.modelId === modelId);
    if (!selected) return;

    form.setFieldValue(['prologue', 'modelInfo', 'modelId'], modelId);
    form.setFieldValue(['prologue', 'modelInfo', 'model'], selected.modelName);
    setModelName(selected.modelName);

    prologueRef.current = merge({}, prologueRef.current, {
      modelInfo: {
        model: selected.modelName,
        modelId: selected.modelId,
      },
    });
    update?.();
  };

  const selectedModelId = form.getFieldValue(['prologue', 'modelInfo', 'modelId']);

  return (
    <div className={styles.popoverConfig}>
      <Form form={form}>
        <div style={{ display: 'none' }}>
          <Form.Item name={['prologue', 'modelInfo', 'model']}>
            <Input />
          </Form.Item>
          <Form.Item name={['prologue', 'modelInfo', 'modelId']}>
            <Input />
          </Form.Item>
        </div>
      </Form>
      <div className={styles.headerTitle}>{intl.formatMessage({ id: 'modelPopover.QALargeModelConfiguration' })}</div>
      <Tabs
        activeKey={activeTab}
        className={styles.scopeTabs}
        onChange={setActiveTab}
        size="small"
        items={[
          { key: 'mine', label: intl.formatMessage({ id: 'modelPopover.mine' }) },
          { key: 'public', label: intl.formatMessage({ id: 'modelPopover.public' }) },
        ]}
      />
      <Spin spinning={loading}>
        <div className={styles.modelList}>
          <Radio.Group value={selectedModelId} onChange={(e) => handleSelect(e.target.value)} style={{ width: '100%' }}>
            {currentList.map((model) => (
              <div key={model.modelId} className={styles.modelItem}>
                <Radio value={model.modelId}>
                  <span className={styles.modelName}>{model.modelName}</span>
                </Radio>
              </div>
            ))}
            {currentList.length === 0 && !loading && (
              <div className={styles.emptyTip}>{intl.formatMessage({ id: 'modelPopover.noModels' })}</div>
            )}
          </Radio.Group>
        </div>
      </Spin>
      <div className={styles.footer}>
        <Button type="primary" size="small" onClick={onClose}>
          {intl.formatMessage({ id: 'modelPopover.confirm' })}
        </Button>
      </div>
    </div>
  );
};

export default ModelPopover;
