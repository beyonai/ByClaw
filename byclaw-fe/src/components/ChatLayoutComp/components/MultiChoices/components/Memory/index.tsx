import React, { useEffect, useState } from 'react';
import { Modal, Form, Input, Tag, Button, Space, Divider, Steps, message } from 'antd';
import { isEmpty, size, get } from 'lodash';
import classNames from 'classnames';
import { useSelector, useIntl } from '@umijs/max';

import AntdIcon from '@/components/AntdIcon';

import { getAgentChatAvatar } from '@/utils/agent';
import { generateFixedMemory, saveFixedMemory } from '@/service/memory';
import { ResourceTypeMap } from '@/constants/resource';

import { IAgentCache } from '@/typescript/agent';

import type { IMessage } from '@/typescript/message';

import styles from './index.module.less';
import useGlobal from '@/hooks/useGlobal';

const { TextArea } = Input;
const { Step } = Steps;

type IProps = {
  open: boolean;
  onClose: () => void;
  multiChoicesMsgId: string[];
  messageList: IMessage[];
  onSuccess: () => void;
};

export type IRelResource = {
  resourceId: string;
  resourceBizType: (typeof ResourceTypeMap)[keyof typeof ResourceTypeMap];
  resourceName: string;
};

type IGenerateInfo = {
  fixedMemorySteps?: {
    question: string;
    relResources: IRelResource[];
  }[];
  tags?: string[];
  title?: string;
  messageTaskDto?: any;
};

const emptyArr: any[] = [];

function Memory(props: IProps) {
  const { open, onClose, multiChoicesMsgId, messageList, onSuccess } = props;

  const intl = useIntl();
  const [form] = Form.useForm();
  const { sessionId } = useGlobal();

  const [loading, setLoading] = useState<boolean>(false);
  const [generating, setGenerating] = useState<boolean>(false);

  const [generateInfo, setGenerateInfo] = useState<IGenerateInfo>({});
  const [tagInputVisible, setTagInputVisible] = useState<boolean>(false);
  const [tagInputValue, setTagInputValue] = useState<string>('');

  const { employeesList } = useSelector((state: any) => {
    return {
      employeesList: state.employees.employeesList,
    };
  });

  const generateRef = React.useRef<AbortController | null>(null);

  const fixedMemorySteps: IGenerateInfo['fixedMemorySteps'] = get(generateInfo, 'fixedMemorySteps') || emptyArr;
  const tags: IGenerateInfo['tags'] = get(generateInfo, 'tags') || emptyArr;

  const handleTagClose = React.useCallback((removedTag: string) => {
    setGenerateInfo((prevState) => {
      return {
        ...prevState,
        tags: (prevState?.tags || []).filter((tag) => tag !== removedTag),
      };
    });
  }, []);

  const handleTagInputChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setTagInputValue(e.target.value);
  }, []);

  const handleTagInputConfirm = () => {
    const value = tagInputValue.trim();
    if (value && !tags.includes(value)) {
      setGenerateInfo((prevState) => {
        return {
          ...prevState,
          tags: [...(prevState?.tags || []), value],
        };
      });
    }
    setTagInputVisible(false);
    setTagInputValue('');
  };

  const handleConfirm = () => {
    // 这里只是占位，后续有接口时可以在此提交表单数据
    form.validateFields().then((values) => {
      setLoading(true);
      saveFixedMemory({
        ...generateInfo,
        title: values.question,
      })
        .then(() => {
          onSuccess();
          message.success(intl.formatMessage({ id: 'common.saveSuccess' }));
        })
        .catch(() => {
          message.error(intl.formatMessage({ id: 'common.saveFailed' }));
        })
        .finally(() => {
          setLoading(false);
        });
    });
  };

  useEffect(() => {
    if (open) {
      const messageIds: string[] = [];
      messageList.forEach((item) => {
        if (multiChoicesMsgId.includes(item.msgId) && item?.messageId) {
          messageIds.push(item?.messageId);
        }
      });
      if (!isEmpty(messageIds)) {
        setGenerating(true);

        if (generateRef.current && !generateRef.current?.signal?.aborted) {
          generateRef.current.abort();
          generateRef.current = null;
        }

        generateRef.current = new AbortController();

        generateFixedMemory(
          {
            sessionId,
            messageIds,
          },
          generateRef.current
        )
          .then((res) => {
            setGenerateInfo(res || {});
            form.setFieldsValue({
              question: res?.title,
            });
          })
          .finally(() => {
            setGenerating(false);
          });
      }
    } else if (generateRef.current && !generateRef.current?.signal?.aborted) {
      generateRef.current.abort();
      generateRef.current = null;
    }
  }, [open, multiChoicesMsgId, messageList]);

  return (
    <Modal
      title={intl.formatMessage({ id: 'memory.enhanceMemory' })}
      centered
      width={840}
      open={open}
      destroyOnHidden
      onCancel={() => {
        onClose();
      }}
      footer={
        <Button type="primary" onClick={handleConfirm} disabled={isEmpty(fixedMemorySteps)} loading={loading}>
          {intl.formatMessage({ id: 'common.save' })}
        </Button>
      }
      loading={generating}
    >
      <Form form={form} layout="vertical">
        <Form.Item
          label={intl.formatMessage({ id: 'memory.memoryQuestion' })}
          name="question"
          rules={[{ required: true, message: intl.formatMessage({ id: 'memory.memoryQuestionPlaceholder' }) }]}
        >
          <TextArea autoSize={{ minRows: 2, maxRows: 4 }} disabled={loading} />
        </Form.Item>

        <Form.Item label={intl.formatMessage({ id: 'memory.memoryTags' })} name="tags">
          <Space
            wrap
            size="small"
            style={{ maxHeight: '20vh', maxWidth: '100%', overflow: 'auto' }}
            className="overflow-auto"
          >
            {tags.map((tag) => (
              <Tag
                key={tag}
                closable={!loading}
                onClose={() => handleTagClose(tag)}
                className={classNames(styles.tag, 'ub ub-ac ub-pc gap4')}
              >
                {tag}
              </Tag>
            ))}
            {size(tags) < 10 && !loading && (
              <>
                {tagInputVisible ? (
                  <Input
                    size="small"
                    style={{ width: 120 }}
                    value={tagInputValue}
                    onChange={handleTagInputChange}
                    onBlur={handleTagInputConfirm}
                    onPressEnter={handleTagInputConfirm}
                    autoFocus
                  />
                ) : (
                  <Button type="dashed" size="small" onClick={() => setTagInputVisible(true)}>
                    +{intl.formatMessage({ id: 'memory.memoryTags' })}
                  </Button>
                )}
              </>
            )}
          </Space>
        </Form.Item>
      </Form>

      <Divider style={{ margin: '16px 0' }} />

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 500, fontSize: 14, marginBottom: 4 }}>
          {intl.formatMessage({ id: 'memory.memorySteps' })}
        </div>
        <div style={{ color: 'rgba(0,0,0,0.45)', fontSize: 12 }}>
          {intl.formatMessage({ id: 'memory.memoryStepsDesc' })}
        </div>
      </div>

      <Steps
        direction="vertical"
        current={size(fixedMemorySteps)}
        style={{ marginTop: 8 }}
        size="small"
        className={classNames(styles.steps, 'overflow-auto')}
      >
        {fixedMemorySteps.map((item, index) => {
          const toolList: IRelResource[] = [];
          const kbList: IRelResource[] = [];
          const agentList: IAgentCache[] = [];

          (item?.relResources || []).forEach((resource) => {
            if (resource.resourceBizType === ResourceTypeMap.digitalEmployee) {
              const agent = employeesList.find(
                (emp: IAgentCache) =>
                  `${emp.agentId}` === `${resource.resourceId}` || `${emp.id}` === `${resource.resourceId}`
              );
              if (agent) {
                agentList.push(agent);
              }
            }
            if (resource.resourceBizType === ResourceTypeMap.TOOL) {
              toolList.push(resource);
            }
            if ([ResourceTypeMap.knowledgeBase, ResourceTypeMap.knowledgeBaseQa].includes(resource.resourceBizType)) {
              kbList.push(resource);
            }
          });

          return (
            <Step
              key={index}
              title={
                <Space>
                  <span style={{ fontSize: 14 }}>{item.question}</span>
                </Space>
              }
              description={
                <div style={{ fontSize: 13, gap: '8px 16px' }} className="ub ub-ac ub-wrap">
                  {!isEmpty(agentList) && (
                    <div className="ub gap8">
                      <span style={{ wordBreak: 'keep-all', marginTop: '4px' }}>
                        {intl.formatMessage({ id: 'common.callDigitalEmployee' })}
                      </span>
                      <div className="ub ub-ac gap4 ub-wrap">
                        {agentList.map((resource: IAgentCache) => {
                          return (
                            <div key={resource.id} className={classNames(styles.resourceItem, 'ub ub-ac gap4')}>
                              <div style={{ height: '20px', width: '20px' }} className="ub ub-ac ub-pc">
                                {getAgentChatAvatar(resource?.chatAvatar)}
                              </div>
                              {resource.name}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {!isEmpty(toolList) && (
                    <div className="ub gap8">
                      <span style={{ wordBreak: 'keep-all', marginTop: '4px' }}>
                        {intl.formatMessage({ id: 'common.callTool' })}
                      </span>
                      <div className="ub ub-ac gap4 ub-wrap">
                        {toolList.map((resource) => {
                          return (
                            <div key={resource.resourceId} className={classNames(styles.resourceItem, 'ub ub-ac gap4')}>
                              <span
                                style={{
                                  background: 'rgba(62, 207, 72, 0.1)',
                                  padding: '2px 2px 2.5px 2.5px',
                                  borderRadius: '2px',
                                }}
                              >
                                <AntdIcon type="icon-chuangjianfangshi-chajian" />
                              </span>
                              {resource.resourceName}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {!isEmpty(kbList) && (
                    <div className="ub gap8">
                      <span style={{ wordBreak: 'keep-all', marginTop: '4px' }}>
                        {intl.formatMessage({ id: 'common.callKnowledgeBase' })}
                      </span>
                      <div className="ub ub-ac gap4 ub-wrap">
                        {toolList.map((resource) => {
                          return (
                            <div key={resource.resourceId} className={classNames(styles.resourceItem, 'ub ub-ac gap4')}>
                              <span
                                style={{
                                  background: 'rgba(22, 93, 255, 0.1)',
                                  padding: '2px 2px 2.5px 2.5px',
                                  borderRadius: '2px',
                                }}
                              >
                                <AntdIcon
                                  type="icon-a-Book-oneshuji12"
                                  style={{ color: 'var(--beyond-color-primary)' }}
                                />
                              </span>
                              {resource.resourceName}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              }
              icon={<span className={classNames(styles.stepIcon, 'ub ub-ac ub-pc')}>{index + 1}</span>}
            />
          );
        })}
      </Steps>
    </Modal>
  );
}

export default React.memo(Memory);
