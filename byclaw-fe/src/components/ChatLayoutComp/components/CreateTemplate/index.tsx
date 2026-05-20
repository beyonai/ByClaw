import React, { useCallback, useState, useEffect } from 'react';
import { Modal, Form, Input, Select, App } from 'antd';
import { useSelector, useIntl, getLocale } from '@umijs/max';

import QueryInput from '@/components/QueryInput';
import QueryInputBase from '@/components/QueryInput/queryInputBase';
import { getDcSystemConfigListByStandType } from '@/service/auth';
import type { IAgentType } from '@/typescript/agent';
import useGlobal from '@/hooks/useGlobal';
import GlobalContext, { Platform } from '@/layout/components/provider/global';
import { EventEmitter$Cls } from '@/utils/eventEmitter';
import { noop } from 'lodash';
import { getTemplateDetail, saveTemplate } from './services';
import UploadCover from './uploadCover';
import { agentTypeMap } from '@/constants/agent';

type IProps = {
  open: boolean;
  onClose: () => void;
  agentType?: IAgentType;
  originalSessionId?: string;
  sessionId?: string;
  sessionName?: string;
  afterOpenChange?: (open: boolean) => void;
};

const myEventEmitter = new EventEmitter$Cls();

function CreateTemplate(props: IProps) {
  const { open, onClose, sessionId, sessionName, originalSessionId } = props;
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const intl = useIntl();

  const parentGlobalContext = useGlobal();
  const queryInputRef = React.useRef<QueryInputBase>(null);

  const [myAgentId, setMyAgentId] = React.useState(parentGlobalContext.agentId);
  const [myAgentType, setMyAgentType] = React.useState<IAgentType>(props.agentType || agentTypeMap.common);
  const [loading, setLoading] = React.useState(false);
  const [tabList, setTabList] = useState([]); // 模板分类列表
  const [terminalList, setTerminalList] = useState([]); // 模板终端列表

  const { agentList, employeesList } = useSelector(({ employees }) => ({
    agentList: employees.agentList || [],
    employeesList: employees.employeesList,
  }));

  const curAgentInfo = React.useMemo(() => {
    return [...(agentList || []), ...(employeesList || [])].find(
      (item) => `${item.id}` === `${myAgentId}` || `${item.resourceCode}` === `${myAgentId}`
    );
  }, [agentList, employeesList, myAgentId]);

  useEffect(() => {
    if (props.agentType) {
      setMyAgentType(props.agentType);
    }
  }, [props.agentType]);

  useEffect(() => {
    setMyAgentId(parentGlobalContext.agentId);
  }, [parentGlobalContext.agentId]);

  useEffect(() => {
    if (sessionId) {
      setLoading(true);
      getTemplateDetail({
        sessionId,
      })
        .then((res: any) => {
          if (res) {
            // 说明有保存过
            form.setFieldsValue({
              templateType: res.templateExtInfo.templateType,
              terminal: res.templateExtInfo.terminal,
              coverId: res.templateExtInfo.templateCoverId,
              templateTitle: res.templateExtInfo.templateTitle,
            });
            try {
              const templateConfig = JSON.parse(res.templateExtInfo.templateConfig);
              if (templateConfig.agentId) {
                setMyAgentId(templateConfig.agentId);
              }
              if (templateConfig.agentType) {
                setMyAgentType(templateConfig.agentType);
              }
              myEventEmitter.emit('queryInput-set-schema', templateConfig);
            } catch (error) {
              console.error(error);
            }
          }
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [sessionId]);

  const onSaveTemplate = useCallback(() => {
    const saveSessionId = sessionId || originalSessionId;
    if (!saveSessionId) {
      throw new Error(intl.formatMessage({ id: 'createTemplate.missingSessionId' }));
    }

    form.validateFields().then(async (formValues) => {
      const sendPayloadRef = queryInputRef.current?.getSendPayload?.();

      if (!sendPayloadRef) {
        form.setFields([
          {
            name: ['templateConfig'],
            errors: [intl.formatMessage({ id: 'createTemplate.pleaseInputTemplate' })],
          },
        ]);
        return;
      }

      const schemaJson = {
        ...sendPayloadRef,
        agentId: myAgentId,
        agentType: myAgentType,
        inputSchema: {
          text: sendPayloadRef.queryQuestion,
          resourceList: sendPayloadRef.resourceList,
        },
      };

      setLoading(true);
      const formData = new FormData();
      formData.append('sessionId', saveSessionId);
      formData.append('templateConfig', JSON.stringify(schemaJson));
      formData.append('templateTitle', formValues.templateTitle);
      formData.append('templateType', formValues.templateType);
      formData.append('terminal', formValues.terminal);
      formData.append('coverId', formValues.coverId);
      saveTemplate(formData)
        .then(() => {
          message.success(intl.formatMessage({ id: 'common.saveSuccess' }));
          onClose();
        })
        .catch(() => {
          setLoading(false);
        });
    });
  }, [sessionId, originalSessionId, myAgentId, myAgentType, intl]);

  useEffect(() => {
    // 模板分类
    getDcSystemConfigListByStandType({
      standType: 'TEMPLATE_TYPE',
    }).then((data) => {
      console.log('模板分类列表', data);
      setTabList(data || []);
    });

    // 模板终端
    getDcSystemConfigListByStandType({
      standType: 'TERMINAL',
    }).then((data) => {
      console.log('模板终端列表', data);
      setTerminalList(data || []);
    });
  }, []);

  const local = getLocale();
  const isEN = React.useMemo(() => {
    return local.includes('en');
  }, [local]);

  return (
    <Modal
      centered
      open={open}
      onCancel={onClose}
      title={intl.formatMessage({ id: 'createTemplate.title' })}
      width={880}
      destroyOnHidden
      confirmLoading={loading}
      afterOpenChange={props.afterOpenChange}
      styles={{
        body: {
          paddingTop: 12,
          maxHeight: '80vh',
          overflow: 'auto',
        },
      }}
      onOk={onSaveTemplate}
    >
      <Form
        form={form}
        labelCol={{ flex: '110px' }}
        wrapperCol={{ flex: '1' }}
        colon={false}
        initialValues={{
          templateTitle: sessionName || '',
        }}
      >
        <Form.Item
          name="templateTitle"
          label={intl.formatMessage({ id: 'createTemplate.templateTitle' })}
          rules={[
            {
              required: true,
              message: intl.formatMessage({ id: 'createTemplate.pleaseInputTemplateTitle' }),
            },
          ]}
        >
          <Input placeholder={intl.formatMessage({ id: 'createTemplate.pleaseInputTemplateTitle' })} />
        </Form.Item>
        <Form.Item
          name="templateType"
          label={intl.formatMessage({ id: 'createTemplate.templateType' })}
          rules={[
            {
              required: true,
              message: intl.formatMessage({ id: 'createTemplate.pleaseSelectTemplateType' }),
            },
          ]}
        >
          <Select
            placeholder={intl.formatMessage({ id: 'createTemplate.pleaseSelectTemplateType' })}
            options={tabList.map((item: { paramValue: string; paramName: string; paramEnName: string }) => ({
              label: isEN ? item.paramEnName : item.paramName,
              value: item.paramValue,
            }))}
          />
        </Form.Item>
        <Form.Item
          name="terminal"
          label={intl.formatMessage({ id: 'createTemplate.terminal' })}
          rules={[
            {
              required: true,
              message: intl.formatMessage({ id: 'createTemplate.pleaseSelectTerminal' }),
            },
          ]}
        >
          <Select
            placeholder={intl.formatMessage({ id: 'createTemplate.pleaseSelectTerminal' })}
            options={terminalList.map((item: { paramValue: string; paramName: string; paramEnName: string }) => ({
              label: isEN ? item.paramEnName : item.paramName,
              value: item.paramValue,
            }))}
          />
        </Form.Item>
        <GlobalContext.Provider
          value={{
            platform: Platform.pc,
            sessionId: '',
            setSessionId: noop,
            agentId: myAgentId,
            agentInfo: curAgentInfo,
            setAgentId: setMyAgentId,
            EventEmitter: myEventEmitter,
          }}
        >
          <Form.Item
            required
            name="templateConfig"
            label={intl.formatMessage({ id: 'createTemplate.sameStyleConfig' })}
          >
            <QueryInput
              onSend={noop}
              myAgentType={myAgentType}
              setMyAgentType={setMyAgentType}
              isBottom
              cannotAt={false}
              cannotSend
              cannotSTT
              sessionId=""
              queryInputRef={queryInputRef}
            />
          </Form.Item>
        </GlobalContext.Provider>
        <Form.Item
          name="coverId"
          label={intl.formatMessage({ id: 'createTemplate.uploadCover' })}
          rules={[
            {
              required: true,
              message: intl.formatMessage({ id: 'createTemplate.pleaseUploadCover' }),
            },
          ]}
        >
          <UploadCover sessionId={originalSessionId} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

export default CreateTemplate;
