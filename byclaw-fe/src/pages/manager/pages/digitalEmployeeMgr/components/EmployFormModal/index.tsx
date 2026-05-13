// @ts-nocheck
import React, { useCallback, useEffect, useState } from 'react';
import { Form, Input, Radio, Space, Select } from 'antd';
import { connect, history, useDispatch, useIntl, getLocale } from '@umijs/max';
import { get } from 'lodash';
import CardRadio from '@/pages/manager/components/CardRadio';
import ModalDrawer from '@/pages/manager/components/ModalDrawer';
import { getSourceOption, getDcSystemConfigListByStandType } from '@/pages/manager/service/DigitalEmployeeMgr';
import { useDigitalTypeOptions } from './useDigitalTypeOptions';
import SandboxCardRadio from './SandboxCardRadio';
import { DEFAULT_AGENT_TYPE_OPTIONS, AGENT_TYPE_STAND_TYPE } from '../../constants';
import styles from './index.module.less';

const { TextArea } = Input;

const EmployFormModal = (props) => {
  const { open, type, data, onCancel, reload, creating = false, catalogId } = props;
  const intl = useIntl();
  const dispatch = useDispatch();

  const { digitalTypeOpts } = useDigitalTypeOptions();

  const [sourceOptions, setSourceOptions] = useState([]);
  const [agentTypeOptions, setAgentTypeOptions] = useState([]);
  const [form] = Form.useForm();

  const local = getLocale();
  const isEN = local.includes('en');

  const defaultAgentTypeOptionsWithLabels = React.useMemo(
    () =>
      DEFAULT_AGENT_TYPE_OPTIONS.map((item) => ({
        value: item.paramValue,
        label: isEN ? item.paramEnName : item.paramName,
      })),
    [intl, local, isEN]
  );

  const digitalType = Form.useWatch('digitalType', form);

  useEffect(() => {
    if (data) {
      form.setFieldsValue({
        resourceName: data.name,
        resourceDesc: data.intro,
        digitalType: data.digitalType,
        systemCode: data.systemCode,
        agentDevType: data.agentDevType,
      });
    }
  }, [data, form]);

  const fetchAgentTypeOptions = useCallback(async () => {
    try {
      const response = await getDcSystemConfigListByStandType({
        standType: AGENT_TYPE_STAND_TYPE,
      });

      let options = response?.data;
      if (!Array.isArray(options) || options.length === 0) {
        options = defaultAgentTypeOptionsWithLabels;
      } else {
        options = options.map((item) => ({
          value: item.paramValue,
          label: isEN ? item.paramEnName : item.paramName,
        }));
      }
      setAgentTypeOptions(options);
    } catch (error) {
      setAgentTypeOptions(defaultAgentTypeOptionsWithLabels);
    }
  }, [isEN, defaultAgentTypeOptionsWithLabels]);

  useEffect(() => {
    fetchAgentTypeOptions();
  }, [fetchAgentTypeOptions]);

  const handleCancel = () => {
    form.resetFields();
    onCancel();
  };

  const createDigitalEmployee = useCallback(
    (params) => {
      handleCancel();
      try {
        sessionStorage.setItem('EmployeeDetail_prevRoute', `${window.location.pathname}${window.location.search}`);
      } catch (e) {
        console.error(e);
      }
      const searchParams = new URLSearchParams({
        digitalType: params.digitalType || '',
        resourceName: params.resourceName || '',
        resourceDesc: params.resourceDesc || '',
        ownerType: 'enterprise',
      });
      if (params.agentDevType) searchParams.set('agentDevType', params.agentDevType);
      // Ensure manual employee type is carried to /digitalEmployeesCreate
      if (params.agentType) searchParams.set('agentType', params.agentType);
      if (catalogId !== undefined && catalogId !== null && `${catalogId}` !== '') {
        searchParams.set('catalogId', `${catalogId}`);
      }
      history.push({
        pathname: '/digitalEmployeesCreate',
        search: `?${searchParams.toString()}`,
        state: { ...data, ...params },
      });
    },
    [data, dispatch, handleCancel, reload, intl]
  );

  const handleOk = async () => {
    const res = await form.validateFields();
    if (res) {
      // console.log(res);
      createDigitalEmployee(res);
    }
  };

  const querySourceOptions = useCallback(async () => {
    const res = await getSourceOption();
    if (res && res.success) {
      const formattedOptions =
        res.data?.map((item) => ({
          label: item.systemName,
          value: item.systemCode,
        })) || [];
      setSourceOptions(formattedOptions);
    } else {
      setSourceOptions([]);
    }
  }, []);

  useEffect(() => {
    querySourceOptions();
  }, []);

  useEffect(() => {
    form.setFieldsValue({
      digitalType: get(digitalTypeOpts, '0.value'),
    });
  }, [digitalTypeOpts]);

  useEffect(() => {
    const firstAgentType = get(agentTypeOptions, '0.value');
    if (digitalType === 'FROM_MANUALLY' && firstAgentType && !form.getFieldValue('agentType')) {
      form.setFieldsValue({
        agentType: firstAgentType,
      });
    }
  }, [agentTypeOptions, digitalType, form]);

  const modalTitleMap = {
    add: intl.formatMessage({ id: 'employFormModal.title.create' }),
    edit: intl.formatMessage({ id: 'employFormModal.title.edit' }),
    view: intl.formatMessage({ id: 'employFormModal.title.view' }),
  };
  const modalTitle = modalTitleMap[type] || modalTitleMap.view;

  return (
    <ModalDrawer
      type="modal"
      showFoot={false}
      title={modalTitle}
      open={open}
      onCancel={handleCancel}
      onOk={handleOk}
      paddingSize="padding-none"
      width={584}
      centered
      className={styles.modalWrap}
      confirmLoading={creating}
    >
      <Form layout="vertical" form={form}>
        <Form.Item
          label={intl.formatMessage({ id: 'form.name' })}
          name="resourceName"
          rules={[
            {
              required: true,
              message: intl.formatMessage({
                id: 'employFormModal.namePlaceholder',
              }),
            },
          ]}
        >
          <Input
            placeholder={intl.formatMessage({
              id: 'employFormModal.namePlaceholder',
            })}
          />
        </Form.Item>
        <Form.Item
          label={intl.formatMessage({ id: 'form.desc' })}
          name="resourceDesc"
          rules={[
            {
              required: true,
              message: intl.formatMessage({
                id: 'employFormModal.descriptionPlaceholder',
              }),
            },
          ]}
        >
          <TextArea
            rows={3}
            placeholder={intl.formatMessage({
              id: 'employFormModal.descriptionPlaceholder',
            })}
          />
        </Form.Item>
        <Form.Item
          label={intl.formatMessage({ id: 'employFormModal.createType' })}
          name="digitalType"
          rules={[
            {
              required: true,
              message: intl.formatMessage({
                id: 'employFormModal.createTypeRequired',
              }),
            },
          ]}
          initialValue={get(digitalTypeOpts, '0.value')}
        >
          <CardRadio options={digitalTypeOpts.filter((item) => !item.disabled)} disabled={data?.disabled} />
        </Form.Item>
        {digitalType === 'FROM_SANDBOX' && (
          <Form.Item
            label={intl.formatMessage({ id: 'employFormModal.sandboxService' })}
            name="agentDevType"
            rules={[{ required: true, message: intl.formatMessage({ id: 'form.select' }) }]}
          >
            <SandboxCardRadio />
          </Form.Item>
        )}
        {/* 数字员工类型 */}
        {digitalType === 'FROM_MANUALLY' && (
          <Form.Item
            label={intl.formatMessage({ id: 'employFormModal.employeeType' })}
            name="agentType"
            rules={[
              {
                required: true,
                message: intl.formatMessage({
                  id: 'form.select',
                }),
              },
            ]}
            initialValue={get(agentTypeOptions, '0.value')}
          >
            <Radio.Group>
              {agentTypeOptions.map((option) => (
                <Radio key={option.value} value={option.value}>
                  <Space>{option.label}</Space>
                </Radio>
              ))}
            </Radio.Group>
          </Form.Item>
        )}

        {/* 当 digitalType 为 第三方创建或沙箱 时显示来源系统 */}
        {(digitalType === 'FROM_THIRD' || digitalType === 'FROM_SANDBOX') && (
          <Form.Item
            label={intl.formatMessage({ id: 'employFormModal.sourceSystem' })}
            name="systemCode"
            rules={[
              {
                required: true,
                message: intl.formatMessage({
                  id: 'form.select',
                }),
              },
            ]}
          >
            <Select options={sourceOptions} />
          </Form.Item>
        )}
      </Form>
    </ModalDrawer>
  );
};

export default connect(({ loading }) => {
  return {
    creating: loading.effects['employeeMgr/createDigitalEmployee'],
  };
})(EmployFormModal);
