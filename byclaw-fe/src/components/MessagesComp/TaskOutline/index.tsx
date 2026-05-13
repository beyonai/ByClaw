/* eslint-disable indent */
import AntdIcon from '@/components/AntdIcon';
import {
  CheckCircleFilled,
  CloseOutlined,
  DownOutlined,
  EllipsisOutlined,
  HolderOutlined,
  ProfileOutlined,
  UpOutlined,
} from '@ant-design/icons';
import type { MenuProps } from 'antd';
import {
  Alert,
  Button,
  Card,
  Col,
  Dropdown,
  Form,
  Input,
  Popconfirm,
  Popover,
  Row,
  Space,
} from 'antd';
import classnames from 'classnames';
import { cloneDeep, debounce, trim, uniqueId, get, noop } from 'lodash';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import InPutFile from './components/InPutFile';
import OutPutFile from './components/OutPutFile';
import StepSelect from './components/StepSelect';
import ToolSelect from './components/ToolSelect';
import { updateResCom } from '@/service/task';
import { validateTask } from '@/service/agent';
import { IFormStatus } from '@/hooks/useSseSender/agent/typescript';
import { getRandomNumber } from '@/utils/math';
import { initAnswerMessage } from '@/utils/messgae';
import { IMessageState } from '@/constants/message';
import { MessageListContext } from '@/components/MessageList';
import { LayoutMode } from '@/constants/system';

import useGlobal from '@/hooks/useGlobal';
import useCountDown from '@/hooks/useCountDown';

// @ts-ignore
import type { IMessage } from '@/typescript/message';
import { useIntl } from '@umijs/max';
import styles from './index.module.less';

const { TextArea } = Input;

// 1. 首先定义类型
export type ValidationStatus = 'loading' | 'pass' | 'fail';

// 定义大纲项接口 (支持递归嵌套)
interface OutlineItem {
  step_topic: string;
  collapsed?: boolean;
  sub_steps: Array<{
    step_name: string;
    reference_steps: string[];
    step_description: string;
    step_description_original?: string;
    input_files: string[];
    output_path: string;
    tool: string;
    tool_metadata?: any; // 添加此行
    updateDesc: string;
    updateTag: boolean;
    invalidErrors: string[];
    num_original?: number;
    key: string;
    id: string;
  }>;
}

// 定义文档接口
export type IDocument = {
  files: any;
  task_description: string;
  steps: OutlineItem[];
  status: IFormStatus;
};

export type IMessageListItemContent = {
  substance: IDocument;
  status: ValidationStatus;
  stopCountdManually?: boolean;
};

export type IProps = {
  message: IMessage;
  updateMessageListItemContent: (messageListItemContent: IMessageListItemContent) => void;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  messageListItemContent: IMessageListItemContent;
};

const contentHandler = (substance: IDocument) => {
  if (!substance) return [];

  return (
    substance.steps?.map((item) => {
      return {
        ...item,
        sub_steps: item.sub_steps.map((step, idx) => {
          return {
            ...step,
            step_description_original: step.step_description,
            num_original: idx,
            key: `${step.step_name}-${idx}-${getRandomNumber(0, 100)}`,
          };
        }),
      };
    }) || []
  );
};

const INIT_COUNTDOWN_MILLISECONDS = 10000;

function TaskOutline(props: IProps) {
  const { updateMessageListItemContent, messageListItemContent, message } = props;
  const { msgId, messageId, isHistoryMsg, messageState } = message;
  const { EventEmitter, layoutMode } = useGlobal();
  const intl = useIntl();
  const [form] = Form.useForm();
  const { messageListId } = React.useContext(MessageListContext);

  const modifyBtnRef = useRef<HTMLButtonElement>(null);
  const stopCountdManuallyRef = useRef(!!messageListItemContent?.stopCountdManually);
  const hasSendRef = useRef(false);
  const resetRef = useRef(noop);

  const [openStepConfigKey, setOpenStepConfigKey] = React.useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [openPopover, setOpenPopover] = useState(false);
  const [isManualEdit, setIsManualEdit] = useState(false); // 是否手动修改
  const [mySections, setMySections] = useState<OutlineItem[]>(contentHandler(messageListItemContent?.substance));
  const [copyMySections, setCopyMySections] = useState<any>([]); // mySections的副本
  const [flattenSections, setFlattenSections] = useState<any>([]); // mySections的平铺结构
  const [isEditFlag, setIsEditFlag] = useState(false); // 是否有修改的标识
  const [isDelFlag, setIsDelFlag] = useState(false); // 删除的标识(需要删除标识，否则删除步骤无法保存)
  const [isDisabled, setIsDisabled] = useState(() => {
    return messageListItemContent?.substance?.status === IFormStatus.FINISH || layoutMode === LayoutMode.preview;
  });
  const resComId = get(message, 'resComIds.0.resComId');

  const messageIsDone = get(message, 'messageState') === IMessageState.Done;

  const createStep = useCallback(() => {
    const newStepName = intl.formatMessage({ id: 'taskOutline.newStep' });
    return {
      step_name: uniqueId(newStepName),
      reference_steps: [],
      step_description: '',
      input_files: [],
      output_path: '',
      tool: '',
      updateDesc: '',
      updateTag: true,
      key: uniqueId(newStepName),
    };
  }, [intl]);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const payload = {
        sendProps: {
          queryQuestion: values.content,
          payload: {
            taskOperateType: 'UPDATE',
            llmMessageid: message.messageId,
          },
          msgOpt: {
            answerMsg: {
              ...initAnswerMessage(message),
            },
            queryMsg: {
              msgId: message.queryMsgId,
            },
          },
        },
        sendConf: {
          onlyQuery: true,
        },
      };
      EventEmitter.emit('beyond-chat-on-send-msg', payload);
      setOpenPopover(false); // 提交后关闭 Popover
    } catch (error) {
      // error
    }
  };

  const onValuesChange = (changedValues: any, allValues: any) => {
    if (changedValues.content !== undefined) {
      setInputValue(allValues.content || '');
    }
  };

  const content = (
    <Form form={form} layout="vertical" className={styles.myFormContent} onValuesChange={onValuesChange}>
      <Form.Item name="content">
        <Input.TextArea
          rows={4}
          placeholder={intl.formatMessage({ id: 'taskOutline.inputSmartModifyContent' })}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
        />
      </Form.Item>
      <div style={{ textAlign: 'right' }}>
        <Button type="primary" htmlType="submit" disabled={!inputValue.trim()} onClick={handleSubmit}>
          {intl.formatMessage({ id: 'common.submit' })}
        </Button>
      </div>
    </Form>
  );

  const items: MenuProps['items'] = [
    {
      key: '1',
      icon: <AntdIcon type="icon-xingxing" />,
      label: intl.formatMessage({ id: 'taskOutline.smartModify' }),
      onClick: () => setOpenPopover(true),
    },
    {
      key: '2',
      icon: <AntdIcon type="icon-a-Editbianji" />,
      label: intl.formatMessage({ id: 'taskOutline.manualModify' }),
      onClick: () => setIsManualEdit(true),
    },
  ];

  const addStep = useCallback((sectionIdx: number, idx: number, type: 'prev' | 'next') => {
    setMySections((prev) => {
      const p = prev?.[sectionIdx];
      if (!p) return prev;

      const hasEmptyStepIdx = p.sub_steps.findIndex((step) => !trim(step.step_description));

      if (hasEmptyStepIdx >= 0) {
        const inputDom = document.getElementById(`${msgId}-TaskOutline-${sectionIdx}`);
        const textAreaList = inputDom?.getElementsByClassName('textArea');
        if (textAreaList) {
          textAreaList[hasEmptyStepIdx]?.focus?.();
        }
        return prev;
      }

      if (type === 'prev') {
        p.sub_steps.splice(idx, 0, createStep());
      } else {
        p.sub_steps.splice(idx + 1, 0, createStep());
      }
      return [...prev];
    });
  }, []);

  const onCloseUpdate = React.useCallback(() => {
    setOpenStepConfigKey(null);
  }, []);

  const stopCountDownManually = () => {
    if (stopCountdManuallyRef.current) return;

    stopCountdManuallyRef.current = true;
    resetRef.current();

    updateMessageListItemContent({
      ...messageListItemContent,
      stopCountdManually: true,
      substance: {
        ...messageListItemContent.substance,
      },
    });
  };

  // 执行规划
  const TaskExecute = debounce(() => {
    if (hasSendRef.current) return;

    hasSendRef.current = true;
    stopCountDownManually();

    setIsDisabled(true);
    updateMessageListItemContent({
      ...messageListItemContent,
      substance: {
        ...messageListItemContent.substance,
        status: IFormStatus.FINISH,
      },
    });

    const payload = {
      sendProps: {
        queryQuestion: intl.formatMessage({ id: 'taskOutline.executePlan' }),
        payload: {
          taskOperateType: 'EXECUTE',
          llmMessageid: messageId,
          extParams: {
            resComId,
          },
        },
      },
    };

    EventEmitter.emit('beyond-chat-on-send-msg', payload);
  }, 500);

  const { remainingTime, isRunning, start, reset } = useCountDown(INIT_COUNTDOWN_MILLISECONDS, TaskExecute);

  // 修改规划-保存修改先校验
  const TaskValidate = useCallback(async () => {
    updateMessageListItemContent({
      ...messageListItemContent,
      status: 'loading',
    });
    const payload = {
      steps: mySections,
      messageId: message.messageId,
      task_description: messageListItemContent?.substance?.task_description,
    };
    await validateTask(payload).then((resp) => {
      const { result, task } = resp;
      if (result === 'pass') {
        setIsManualEdit(false);
        setCopyMySections(cloneDeep(task?.steps || mySections));

        updateResCom({
          resComId,
          resPage: JSON.stringify(payload),
        }).then((res) => {
          if (res) {
          }
        });
      } else {
        setIsManualEdit(true);
      }
      updateMessageListItemContent({
        ...messageListItemContent,
        status: result,
        substance: {
          files: task?.files || messageListItemContent?.substance?.files,
          steps: task?.steps || mySections,
          task_description: task?.task_description || messageListItemContent?.substance?.task_description,
        },
      });
    });
  }, [resComId, mySections, message, messageListItemContent]);

  // 获取 依赖步骤的select 的 options（当前子项之前的所有子项的 des）
  const getOptions = (clickedSerial: number) => {
    return flattenSections
      .filter((item: { serial: number }) => item.serial < clickedSerial)
      .map((item: { step_description: string; step_name: string; serial: any }) => ({
        label: intl.formatMessage({ id: 'taskOutline.step' }, { serial: item.serial }),
        name: item.step_name,
        desc: item.step_description,
        serial: item.serial,
      }));
  };

  // 获取 输入文件的select 的 options（当前子项和之前的所有子项的 input_files和用户输入的文件）
  const getInputFilesOptions = (clickedSerial: number) => {
    const userInputFiles = messageListItemContent?.substance?.files || [];
    const userGroup = {
      label: intl.formatMessage({ id: 'taskOutline.userInputFiles' }),
      title: intl.formatMessage({ id: 'taskOutline.userInputFiles' }),
      options: userInputFiles.map((item: { fileName: any }) => ({
        label: item.fileName,
        value: item.fileName,
      })),
    };
    const outPutFiles = flattenSections
      .filter((item: { serial: number }) => item.serial < clickedSerial)
      .map((item: { step_description: string; step_name: string; serial: number; output_path: string }) => ({
        label: intl.formatMessage({ id: 'taskOutline.step' }, { serial: item.serial }),
        title: intl.formatMessage({ id: 'taskOutline.step' }, { serial: item.serial }),
        options: [{ label: item.output_path, value: item.output_path }],
      }));
    return [userGroup, ...outPutFiles];
  };

  // 校验状态
  const statusComponents = {
    loading: (
      <Button type="primary" className={styles.validateButton} style={{ background: '#E6EBF0' }} loading>
        {intl.formatMessage({ id: 'taskOutline.validating' })}
      </Button>
    ),
    pass: (
      <Button
        type="primary"
        className={styles.validateButton}
        style={{ background: '#E8FFEA', border: '1px solid #7BE188' }}
        icon={<CheckCircleFilled style={{ color: '#7BE188' }} />}
      >
        {intl.formatMessage({ id: 'taskOutline.validationPassed' })}
      </Button>
    ),
    fail: (
      <Alert
        message={intl.formatMessage({ id: 'taskOutline.validationError' })}
        description={intl.formatMessage({ id: 'taskOutline.validationErrorDesc' })}
        type="warning"
        showIcon
        className={styles.validateAlert}
      />
    ),
  };

  // 校验结果
  const renderAlert = (status: ValidationStatus) => {
    return status ? statusComponents[status] : null;
  };

  // 公共变更处理器
  const handleStepChange = React.useCallback(
    (sectionIdx: number, stepIdx: number, key: string, value: any, defaultValue: any) => {
      setMySections((prev) => {
        // 1. 先更新当前步骤的值
        const updatedSections = prev.map((section, sIdx) =>
          sIdx !== sectionIdx
            ? section
            : {
                ...section,
                sub_steps: section.sub_steps.map((step, i) =>
                  i === stepIdx
                    ? {
                        ...step,
                        [key]: key === 'tool' ? value?.toolName : value,
                        tool_metadata: key === 'tool' ? value : step.tool_metadata,
                        updateTag: step.updateTag || value !== defaultValue,
                      }
                    : step
                ),
              }
        );

        // 2. 如果修改的是output_path且值发生变化，同步更新所有input_files引用
        if (key === 'output_path' && value !== defaultValue) {
          const oldPath = defaultValue;
          const newPath = value;

          return updatedSections.map((section) => ({
            ...section,
            sub_steps: section.sub_steps.map((step) => ({
              ...step,
              // 将所有input_files中引用旧路径的项替换为新路径
              input_files: step.input_files.map((file) => (file === oldPath ? newPath : file)),
            })),
          }));
        }

        return updatedSections;
      });
    },
    []
  );

  const onCancelEdit = () => {
    setIsManualEdit(false);
    setMySections(copyMySections);
  };

  // 步骤描述-可编辑
  const renderTextArea = (description: string, sectionIdx: number, idx: number, name: string, type: string) => {
    // textarea这边需要处理一下，因为输入汉字时value和defaultValue一直匹配不上，所以需要将新的value与备份的step_description进行匹配
    let matchedDescription = description; // 默认使用传入的description
    for (const group of copyMySections) {
      const matchedStep = group.sub_steps.find((step: { step_name: string }) => step.step_name === name);
      if (matchedStep) {
        matchedDescription = matchedStep.step_description;
        break; // 找到匹配项后立即退出循环
      }
    }
    return (
      <TextArea
        autoFocus={!description}
        value={description}
        className={classnames(type === 'withBlock' && styles.textAreaBlock, 'ub-f1 textArea')}
        style={{ resize: 'none' }}
        onChange={(e) => handleStepChange(sectionIdx, idx, 'step_description', e.target.value, matchedDescription)}
      />
    );
  };

  useEffect(() => {
    resetRef.current = reset;
  }, [reset]);

  useEffect(() => {
    setMySections(contentHandler(messageListItemContent?.substance));
  }, [messageListItemContent]);

  useEffect(() => {
    // 将mySections数据扁平化并加上序号
    let currentSerial = 1;
    const allSubSteps = cloneDeep(mySections).flatMap((section) =>
      section.sub_steps.map((subTask) => {
        const serialNumber = currentSerial;
        currentSerial += 1; // 显式递增
        return {
          ...subTask,
          serial: serialNumber,
        };
      })
    );
    setFlattenSections(allSubSteps);

    const checkHasEditFlag = (data: any[]) => {
      return data.some((group) => group.sub_steps?.some((item: { updateTag: boolean }) => item.updateTag === true));
    };
    setIsEditFlag(checkHasEditFlag(mySections));
  }, [mySections]);

  useEffect(() => {
    // 拷贝mySections
    setCopyMySections(cloneDeep(mySections));
  }, []);

  useEffect(() => {
    if (!messageListId) return noop;
    const onScroll = () => {
      onCloseUpdate();
    };

    document.getElementById(messageListId)?.addEventListener('scroll', onScroll);

    return () => {
      document.getElementById(messageListId)?.removeEventListener('scroll', onScroll);
    };
  }, [messageListId]);

  useEffect(() => {
    if (messageState !== IMessageState.Done || isHistoryMsg || isDisabled || stopCountdManuallyRef.current) return;

    start();
  }, [messageState, isHistoryMsg, isDisabled]);

  if (messageListItemContent?.status === 'loading') {
    return statusComponents.loading;
  }

  if (!messageListItemContent?.substance) return null;

  return (
    <div className={classnames(styles.outline, 'mW600')}>
      <div onClick={stopCountDownManually}>
        {renderAlert(messageListItemContent?.status)}
        <p style={{ color: '#1F2533', fontSize: '16px', marginBottom: '12px' }}>
          {intl.formatMessage(
            { id: 'outline.desInfo' },
            {
              button: <span style={{ color: '#1890ff' }}>{intl.formatMessage({ id: 'taskOutline.executePlan' })}</span>,
            }
          )}
        </p>
        <Card
          className={styles.descCard}
          title={
            <div className="ub gap8 ub-ac">
              <ProfileOutlined style={{ fontSize: '16px' }} />
              {intl.formatMessage({ id: 'taskOutline.taskDescription' })}
            </div>
          }
        >
          <div>{messageListItemContent?.substance?.task_description}</div>
        </Card>
        {mySections.map((section, sectionIdx) => {
          return (
            <Card
              key={`${section.step_topic}-${sectionIdx}`}
              title={
                <div className="ub gap8 ub-ac">
                  <ProfileOutlined />
                  {section.step_topic}
                </div>
              }
              id={`${msgId}-TaskOutline-${sectionIdx}`}
              className={styles.sectionCard}
              extra={[
                <Space key="space">
                  {!section.collapsed && (
                    <span
                      key="up"
                      className="pointer"
                      onClick={() => {
                        setMySections((prev) => {
                          const p = prev?.[sectionIdx];
                          if (!p) return prev;
                          p.collapsed = true;
                          return [...prev];
                        });
                      }}
                    >
                      <UpOutlined />
                    </span>
                  )}
                  {section.collapsed && (
                    <span
                      key="down"
                      className="pointer"
                      onClick={() => {
                        setMySections((prev) => {
                          const p = prev?.[sectionIdx];
                          if (!p) return prev;
                          p.collapsed = false;
                          return [...prev];
                        });
                      }}
                    >
                      <DownOutlined />
                    </span>
                  )}
                </Space>,
              ]}
            >
              <div
                className="ub ub-ver gap8"
                style={{
                  marginTop: 15,
                  display: section.collapsed ? 'none' : 'flex',
                }}
              >
                {section.sub_steps.map((step, idx) => {
                  const current =
                    flattenSections.find((item: { step_name: string }) => item.step_name === step.step_name) || {};
                  return (
                    <div key={`${step.key}`} className="ub gap8" style={{ position: 'relative' }}>
                      {step?.updateTag ? (
                        <div className={styles.updateCircle} />
                      ) : (
                        <HolderOutlined style={{ marginTop: '8px' }} />
                      )}
                      <span style={{ marginTop: '4px' }}>{`${current.serial || ''}.`}</span>
                      {isManualEdit ? (
                        <>
                          {renderTextArea(step.step_description, sectionIdx, idx, step.step_name, 'withBlock')}
                          <div
                            className={classnames(styles.updateIcon, 'ub ub-pe gap8')}
                            style={{ alignSelf: 'center' }}
                          >
                            {Array.isArray(step?.invalidErrors) && step.invalidErrors.length > 0 && (
                              <div className={styles.adviceText}>
                                {intl.formatMessage({ id: 'taskOutline.suggestAdjust' })}
                              </div>
                            )}
                            <Dropdown
                              open={openStepConfigKey === step.key}
                              trigger={[]}
                              popupRender={() => (
                                <div
                                  className={styles.stepConfigBlock}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    e.preventDefault();
                                  }}
                                >
                                  <div className={classnames('ub gap8 mb-8', styles.stepConfigTitle)}>
                                    <div className="fw6">
                                      {intl.formatMessage({ id: 'taskOutline.step' }, { serial: current.serial || '' })}
                                    </div>
                                    {/* 右上角关闭按钮 */}
                                    <CloseOutlined onClick={onCloseUpdate} />
                                  </div>
                                  {Array.isArray(step?.invalidErrors) && step.invalidErrors.length > 0 && (
                                    <Alert
                                      type="warning"
                                      className="mb-16"
                                      message={
                                        <div style={{ marginTop: 8 }}>
                                          {step.invalidErrors.map((item, index) => (
                                            <div key={item} className="ub gap8">
                                              <span>{index + 1}、</span>
                                              {item}
                                            </div>
                                          ))}
                                        </div>
                                      }
                                    />
                                  )}
                                  {/* 任务描述、依赖步骤、输入文件、输出文件、执行员工/工具 */}
                                  <Row>
                                    <Col span={24}>
                                      <div className="mb-16">
                                        <div className="mb-8">
                                          {intl.formatMessage({ id: 'taskOutline.taskDescription' })}
                                        </div>
                                        {renderTextArea(step.step_description, sectionIdx, idx, step.step_name, '')}
                                      </div>
                                    </Col>
                                    <Col span={12}>
                                      <div className="mb-16">
                                        <div className="mb-8">
                                          {intl.formatMessage({ id: 'taskOutline.dependencySteps' })}
                                        </div>
                                        <StepSelect
                                          data={getOptions(current.serial)}
                                          value={step.reference_steps}
                                          onChange={(val) =>
                                            handleStepChange(
                                              sectionIdx,
                                              idx,
                                              'reference_steps',
                                              val,
                                              step.reference_steps
                                            )
                                          }
                                        />
                                      </div>
                                    </Col>
                                    <Col span={12}>
                                      <div className="mb-16">
                                        <div className="mb-8">
                                          {intl.formatMessage({ id: 'taskOutline.inputFiles' })}
                                        </div>
                                        <InPutFile
                                          data={getInputFilesOptions(current.serial)}
                                          value={step.input_files}
                                          onChange={(val) =>
                                            handleStepChange(sectionIdx, idx, 'input_files', val, step.input_files)
                                          }
                                        />
                                      </div>
                                    </Col>
                                    <Col span={12}>
                                      <div className="mb-16">
                                        <div className="mb-8">
                                          {intl.formatMessage({ id: 'taskOutline.outputFiles' })}
                                        </div>
                                        <OutPutFile
                                          value={step.output_path}
                                          onChange={(val) =>
                                            handleStepChange(sectionIdx, idx, 'output_path', val, step.output_path)
                                          }
                                        />
                                      </div>
                                    </Col>
                                    <Col span={12}>
                                      <div className="mb-16">
                                        <div className="mb-8">
                                          {intl.formatMessage({ id: 'taskOutline.executeToolOrEmployee' })}
                                        </div>
                                        <ToolSelect
                                          value={step.tool || ''}
                                          onChange={(val) => handleStepChange(sectionIdx, idx, 'tool', val, step.tool)}
                                        />
                                      </div>
                                    </Col>
                                  </Row>
                                </div>
                              )}
                            >
                              <AntdIcon
                                type="icon-a-Setting-configshezhipeizhi"
                                className="pointer"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();

                                  setOpenStepConfigKey(openStepConfigKey === step.key ? null : step.key);
                                }}
                              />
                            </Dropdown>
                            <Dropdown
                              menu={{
                                items: [
                                  {
                                    key: 'addPrevStep',
                                    label: intl.formatMessage({ id: 'taskOutline.addAbove' }),
                                  },
                                  {
                                    key: 'addNextStep',
                                    label: intl.formatMessage({ id: 'taskOutline.addBelow' }),
                                  },
                                  {
                                    key: 'deleteStep',
                                    label: (
                                      <Popconfirm
                                        title={intl.formatMessage({ id: 'taskOutline.confirmDeleteStep' })}
                                        onConfirm={() => {
                                          setIsDelFlag(true);
                                          setMySections((prev) => {
                                            const p = prev?.[sectionIdx];
                                            if (!p) return prev;
                                            // 获取要删除的step_name
                                            const deletedStepName = step?.step_name;
                                            p.sub_steps.splice(idx, 1);
                                            const deletedOutputFile = step?.output_path;
                                            // 如果存在删除的步骤名称，清理所有引用
                                            if (deletedStepName) {
                                              return prev.map((section) => ({
                                                ...section,
                                                sub_steps: section.sub_steps.map((step) => ({
                                                  ...step,
                                                  reference_steps: step.reference_steps.filter(
                                                    (name) => name !== deletedStepName
                                                  ),
                                                  input_files: step.input_files.filter(
                                                    (file) => file !== deletedOutputFile
                                                  ),
                                                })),
                                              }));
                                            }
                                            return [...prev];
                                          });
                                        }}
                                      >
                                        <span onClick={(e: any) => e.stopPropagation()}>
                                          {intl.formatMessage({ id: 'taskOutline.deleteStep' })}
                                        </span>
                                      </Popconfirm>
                                    ),
                                  },
                                ],
                                onClick: ({ key }) => {
                                  if (key === 'addPrevStep') {
                                    addStep(sectionIdx, idx, 'prev');
                                  }
                                  if (key === 'addNextStep') {
                                    addStep(sectionIdx, idx, 'next');
                                  }
                                  // 删除逻辑已在 Popconfirm 里处理
                                },
                              }}
                              placement="bottom"
                            >
                              <EllipsisOutlined className="pointer" />
                            </Dropdown>
                          </div>
                        </>
                      ) : (
                        <div style={{ paddingTop: 4, wordBreak: 'break-all' }}>{step.step_description}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          );
        })}
      </div>
      <div className="ub ub-ac ub-pe gap8" style={{ marginTop: 15 }}>
        {isManualEdit ? (
          <>
            <Button onClick={onCancelEdit}>{intl.formatMessage({ id: 'common.cancel' })}</Button>
            {(isEditFlag || isDelFlag) && (
              <Button type="primary" onClick={TaskValidate}>
                {intl.formatMessage({ id: 'taskOutline.saveModify' })}
              </Button>
            )}
          </>
        ) : (
          <>
            <Button type="primary" onClick={TaskExecute} disabled={isDisabled} loading={!messageIsDone}>
              {isRunning &&
                intl.formatMessage(
                  { id: 'taskOutline.autoExecutePlan' },
                  {
                    seconds: Math.ceil(remainingTime / 1000),
                  }
                )}
              {!isRunning && intl.formatMessage({ id: 'taskOutline.executePlan' })}
            </Button>
            <Dropdown menu={{ items }} trigger={['click']} placement="bottomRight">
              <Button
                ref={modifyBtnRef}
                disabled={isDisabled}
                loading={!messageIsDone}
                onClick={() => {
                  stopCountDownManually();
                }}
              >
                {intl.formatMessage({ id: 'taskOutline.modifyPlan' })}
              </Button>
            </Dropdown>
            <Popover
              title=""
              content={content}
              trigger="click"
              placement="topLeft"
              arrow={false}
              open={openPopover}
              onOpenChange={setOpenPopover}
              getPopupContainer={() => modifyBtnRef.current?.parentElement || document.body}
            >
              <div style={{ height: '32px' }} /> {/* 只为触发定位，不显示内容, 避免点击时触发下拉菜单和弹框同时出现 */}
            </Popover>
          </>
        )}
      </div>
    </div>
  );
}
export default TaskOutline;
