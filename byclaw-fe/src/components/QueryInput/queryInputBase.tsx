import React from 'react';

import { getIntl } from '@umijs/max';
import { Button, ConfigProvider, Divider, message, Popover, Progress, Space } from 'antd';
import { get, isBoolean, isEmpty, isNil, pullAllBy, set, trim, compact, omit } from 'lodash';
import classNames from 'classnames';
import { agentTypeMap } from '@/constants/agent';
import { IMessageState } from '@/constants/message';
import { chatModeMap, IChatModeType } from '@/constants/query';
import { ResourceTypeMap } from '@/constants/resource';
import type { ISendProps } from '@/hooks/useChat';
import type { IAgentCache, IAgentType } from '@/typescript/agent';
import type { IFile } from '@/typescript/file';
import type { IMessage } from '@/typescript/message';
import AntdIcon from '../AntdIcon';
import OperatePopup from './components/OperatePopup';
import styles from './index.module.less';
import RichInput, { RichInputRef, RichInputResourceList } from './RichInput';
import STTComp, { STTCompRef, RecordingStatus } from '@/components/QueryInput/components/STTComp';
import type { IGlobalContext } from '@/layout/components/provider/global';
import type { UploadFileRef } from './components/UploadFile';
import type { IAgentFileUploadConf } from '../../hooks/useAgentUploadFileConfig';
import type { DefaultValueSchema } from './RichInput/types';
import type { ContextUsed } from '@/hooks/useContextUsed';
import { getLastMentionedDigitalEmployeeId } from './utils/mention';

export type IProps = {
  getMessageList?: () => Array<IMessage>;

  onSend: (param: ISendProps) => void;

  chatMode: IChatModeType;
  setChatMode?: React.Dispatch<React.SetStateAction<IChatModeType>>;
  globalContext: IGlobalContext;
  userInfo: null | Record<string, any>;

  sessionId?: string;
  placeholder?: string;
  messageState?: IMessageState;

  onCancel?: () => void;
  maxRows?: number;
  minRows?: number;
  isBottom?: boolean;
  cannotAt?: boolean;
  cannotSend?: boolean;
  cannotSTT?: boolean;
  myAgentType?: IAgentType;
  setMyAgentType?: React.Dispatch<React.SetStateAction<IAgentType>>;
  onMounted?: () => void;
  uploadFileConfig?: IAgentFileUploadConf;
  employeesList?: IAgentCache[];
  inputDraft?: DefaultValueSchema;
  onInputDraftChange?: (draft: DefaultValueSchema) => void;
  contextUsed?: ContextUsed;

  /** 当前会话所属项目。 */
  projectId?: number;

  /** 控制新会话项目选择入口，避免通知等复用输入框误展示。 */
  enableTaskTemplate?: boolean;

  /** 输入框外部项目选择器当前选中的项目。 */
  selectedProject?: { projectId: string; projectName: string };
};

export type IState = {
  inputValue?: string;
  showAssitant: boolean;
  fileList: IFile[];
  singleChatTargetRealHumanFlag: boolean;
  resourceList: RichInputResourceList;
  connectNet?: boolean;
  connectNetAgentId?: string;
};

const AUTOSEND_TIMEOUT = 5000;

class QueryInputBase<P = Record<string, any>, S = Record<string, any>> extends React.Component<
  P & IProps,
  Partial<IState> & S
> {
  isComposing = false;

  sttCompRef = React.createRef<STTCompRef>();

  richInputRef = React.createRef<RichInputRef>();

  displayQuestion = '';

  autoSendRunner: NodeJS.Timeout | null = null;

  uploadFileRef = React.createRef<UploadFileRef>();

  selectedProject?: { projectId: string; projectName: string };

  handleProjectChange = (project: { projectId: string; projectName: string }) => {
    this.selectedProject = project;
  };

  constructor(props: P & IProps) {
    super(props);

    this.state = {
      inputValue: '',
      showAssitant: false,
      fileList: [],
      singleChatTargetRealHumanFlag: true,
      connectNet: false,
    } as S & IState;
  }

  getUploadFileConfig = () => this.props.uploadFileConfig || this.props.globalContext.uploadFileConfig;

  getUploadFileAccept = () => ''; // 不限制文件类型，允许所有类型上传

  static getDerivedStateFromProps(nextProps: IProps, prevState: IState) {
    if (nextProps.employeesList?.length && !prevState.connectNetAgentId) {
      const onlineSearchAgent = nextProps.employeesList.find((item) => item.agentType === agentTypeMap.networkSearch);
      if (onlineSearchAgent) {
        return {
          connectNetAgentId: onlineSearchAgent.agentId,
        };
      }
    }
    return null;
  }

  componentDidMount() {
    const { EventEmitter } = this.props.globalContext;
    EventEmitter.on('queryInput-push-fileList', this.pushFileList);
    EventEmitter.on('queryInput-set-value', this.setInputValue);
    EventEmitter.on('queryInput-set-value-and-send', this.setInputValueAndSend);
    EventEmitter.on('queryInput-set-schema-imme', this.setCommonStateBySchema);
    EventEmitter.on('queryInput-paste-files', this.onPasteFiles);
    EventEmitter.emit('pcLayout-contains-chatLayout', true, { waitForListeners: true });
    this.props.onMounted?.();
    this.restoreInputDraft();
  }

  componentDidUpdate(prevProps: IProps) {
    if (`${prevProps.sessionId || ''}` !== `${this.props.sessionId || ''}`) {
      // 新会话取得真实 sessionId 后重新读取已迁移的草稿，保证所有 @ 员工都恢复到输入框。
      this.restoreInputDraft();
    }
  }

  componentWillUnmount() {
    const { EventEmitter } = this.props.globalContext;
    EventEmitter.off('queryInput-push-fileList', this.pushFileList);
    EventEmitter.off('queryInput-set-value', this.setInputValue);
    EventEmitter.off('queryInput-set-value-and-send', this.setInputValueAndSend);
    EventEmitter.off('queryInput-set-schema-imme', this.setCommonStateBySchema);
    EventEmitter.off('queryInput-paste-files', this.onPasteFiles);
    EventEmitter.emit('pcLayout-contains-chatLayout', false);
  }

  onSelectMentionPopoverItem: RichInputRef['insertItem'] = (item, type) => {
    this.richInputRef.current?.insertItem(item, type);
    this.setState((prev) => ({ ...prev, showMentionPopoverType: '' }));
  };

  restoreInputDraft = () => {
    const { inputDraft } = this.props;
    if (!inputDraft || (!inputDraft.text && isEmpty(inputDraft.resourceList))) {
      this.syncSiderAgent([]);
      return;
    }

    this.richInputRef.current?.setText(inputDraft);
    this.syncSiderAgent(inputDraft.resourceList || []);
    this.setState((prevState) => ({
      ...prevState,
      inputValue: inputDraft.text || '',
      resourceList: inputDraft.resourceList || [],
    }));
  };

  setCommonStateBySchema = (schema: any) => {
    const { queryQuestion, inputSchema = {}, mentionItem, payload: { files } = {} } = schema;

    const inputValue = inputSchema?.text || queryQuestion || '';

    this.setState((prevState) => ({
      ...prevState,
      fileList: (files || []).map((item: any) => {
        const { fileId, fileUrl, fileType, fileSize, useType, sourceType } = item;
        return {
          fileType,
          useType,
          sourceType,
          status: 'done',
          uid: fileId,
          imgUrl: fileType === 'image' ? fileUrl : undefined,
          queryFile: {
            ...omit(item, ['useType', 'sourceType']),
            length: fileSize,
          },
        };
      }),
      inputValue,
    }));

    if (inputValue) {
      setTimeout(() => {
        // 目的：等待因为agentId和agentType的改变，导致RichInput的组件的内容修改
        this.richInputRef.current?.appendText(inputValue);
      });
    }

    if (mentionItem) {
      setTimeout(() => {
        // 目的：等待因为agentId和agentType的改变，导致RichInput的组件的内容修改
        this.onSelectMentionPopoverItem(mentionItem?.item, mentionItem.type);
      });
    }
  };

  upperPopover = (): null | React.ReactNode => null;

  inputUpper = (): null | React.ReactNode => null;

  bottomLeftRender = (): null | React.ReactNode => null;

  bottomRightRender = (): null | React.ReactNode => {
    const comps = compact([this.STTRender()]);

    if (isEmpty(comps)) return null;

    return <>{comps}</>;
  };

  extendRender = (): null | React.ReactNode => null;

  getAssitantTrigger = (): React.ReactNode => null;

  getCurrentInputPayload = () => {
    return this.richInputRef.current?.getPayload?.();
  };

  // # 引用只能按唯一员工 ID 查询；多 @ 员工时返回多个 ID，用于隐藏 # 入口。
  getCurrentResourceList = () => {
    return this.getCurrentInputPayload()?.resourceList || this.state.resourceList || [];
  };

  getInlineDigitalEmployeeList = () => {
    return this.getCurrentResourceList().filter(
      (item) => `${item.resourceType}` === ResourceTypeMap.digitalEmployee && item.resourceId
    );
  };

  syncSiderAgent = (resourceList: RichInputResourceList) => {
    // 左侧资源区跟随最后一个 @ 的员工，但不修改会话 agentId，避免输入框因会话身份变化而重挂载。
    this.props.globalContext.setSiderAgentId?.(getLastMentionedDigitalEmployeeId(resourceList));
  };

  getPersistentMentionDraft = (includeQuestion = false): DefaultValueSchema => {
    return this.richInputRef.current?.getPersistentMentionDraft(includeQuestion) || { text: '', resourceList: [] };
  };

  getQuoteAgentIds = (): string[] => {
    const inlineAgentIds = this.getInlineDigitalEmployeeList()
      .map((item) => `${item.resourceId}`)
      .filter(Boolean);
    const uniqueInlineAgentIds = Array.from(new Set(inlineAgentIds));
    if (uniqueInlineAgentIds.length) {
      return uniqueInlineAgentIds;
    }

    const { agentId } = this.props.globalContext;
    return agentId ? [`${agentId}`] : [];
  };

  getQuoteAgentId = (): string | undefined => {
    const agentIds = this.getQuoteAgentIds();
    return agentIds.length === 1 ? agentIds[0] : undefined;
  };

  autoSend = () => {
    if (this.autoSendRunner) {
      clearTimeout(this.autoSendRunner);
    }

    this.autoSendRunner = setTimeout(() => {
      if (!trim(this.state.inputValue)) {
        this.autoSend();
        return;
      }

      this.onSendQuery();

      this.richInputRef.current?.clearAfterSend();
      this.sttCompRef.current?.stop();

      if (this.autoSendRunner) {
        clearTimeout(this.autoSendRunner);
      }
    }, AUTOSEND_TIMEOUT);
  };

  STTRender = () => {
    const { userInfo, cannotSTT } = this.props;
    if (!userInfo || cannotSTT) {
      return null;
    }
    return (
      <STTComp
        ref={this.sttCompRef}
        onRecognized={(val) => {
          this.setInputValue({
            inputTxt: val,
            isInsert: true,
          });
          this.autoSend();
        }}
        onStatus={(recordingStatus: RecordingStatus) => {
          if (recordingStatus === 'recording') {
            this.autoSend();
          } else if (this.autoSendRunner) {
            clearTimeout(this.autoSendRunner);
          }
        }}
      />
    );
  };

  pushFileList = (fileItem: IFile) => {
    this.setState((prevState) => {
      return {
        ...prevState,
        fileList: [...(prevState.fileList || []), fileItem],
      };
    });
  };

  setInputValue = (text: string | { inputTxt: string; isInsert?: boolean; inputOpt?: Record<string, any> }) => {
    const { setChatMode } = this.props;

    const { chatMode, connectNet, enterpriseInformation } = get(text, 'inputOpt') || {};

    if (chatMode && setChatMode) {
      setChatMode(chatMode);
    }

    this.setState((prevState) => {
      const newState = {
        ...prevState,
      };

      const isInsert = get(text, 'isInsert');
      const newInputValue = get(text, 'inputTxt', text) as string;

      if (isBoolean(connectNet)) {
        Object.assign(newState, {
          connectNet,
        });
      }
      if (isBoolean(enterpriseInformation)) {
        Object.assign(newState, {
          enterpriseInformation,
        });
      }

      if (isInsert) {
        this.richInputRef.current?.appendText(newInputValue);

        Object.assign(newState, {
          inputValue: `${prevState.inputValue}${newInputValue}`,
        });
      } else {
        this.richInputRef.current?.setText(newInputValue);

        Object.assign(newState, {
          inputValue: newInputValue,
        });
      }

      return newState;
    });
  };

  // 外部任务模板入口使用该事件将生成内容写入输入框并直接发送。
  setInputValueAndSend = (text: string) => {
    if (!text?.trim()) return;
    this.richInputRef.current?.setText(text);
    this.setState({ inputValue: text }, () => {
      this.onSendQuery();
      this.richInputRef.current?.clearAfterSend();
    });
  };

  getSendPayload = () => {
    const currentInputPayload = this.getCurrentInputPayload();
    const inputValue = currentInputPayload?.text ?? this.state.inputValue;
    const resourceList = currentInputPayload?.resourceList ?? this.state.resourceList;
    const { myAgentType } = this.props;
    const sendVal = trim(inputValue);

    if (!sendVal) return null;

    return {
      queryQuestion: sendVal,
      payload: {
        agentType: myAgentType,
      },
      resourceList,
    };
  };

  // 所有子类的onSend都从父类这里触发，这里需要额外加一些公共的参数
  finallySendQuery = (data: any) => {
    // Chat、Employees 等输入框会覆盖 getSendPayload，项目选择必须在公共发送出口统一补入。
    const selectedProject = this.props.selectedProject || this.selectedProject;
    if (!this.props.sessionId && selectedProject) {
      set(data, 'payload.selectedProjectId', selectedProject.projectId);
      set(data, 'payload.selectedProjectName', selectedProject.projectName);
    } else if (this.props.sessionId && this.props.projectId !== undefined) {
      // 历史会话没有项目选择器，继续聊天时直接沿用当前会话所属项目。
      set(data, 'payload.projectId', this.props.projectId);
    }

    let { resourceList = [] } = this.state;
    const currentInputPayload = this.getCurrentInputPayload();
    if (currentInputPayload?.resourceList) {
      resourceList = currentInputPayload.resourceList;
    }

    if (resourceList.length) {
      set(data, 'resourceList', resourceList);
    }
    this.props.onSend(data);
  };

  onSendQuery = () => {
    const payload = this.getSendPayload();

    if (!payload || isEmpty(payload)) return false;
    // 发送前提取要保留的 @ 员工，后续即使输入组件重挂载也能从草稿恢复。
    const persistentMentionDraft = this.getPersistentMentionDraft();
    this.finallySendQuery(payload);

    this.setState((prevState) => ({
      ...prevState,
      inputValue: persistentMentionDraft.text,
      fileList: [],
      resourceList: persistentMentionDraft.resourceList,
    }));
    this.props.onInputDraftChange?.(persistentMentionDraft);

    return true;
  };

  checkIsSending = () => {
    const { messageState } = this.props;
    if (!isNil(messageState) && [IMessageState.Answer, IMessageState.Query].includes(messageState)) {
      return false;
    }
    return true;
  };

  checkCanSend() {
    const currentInputPayload = this.getCurrentInputPayload();
    const inputValue = currentInputPayload?.text ?? this.state.inputValue;
    const trimInputValue = trim(inputValue || '');
    return trimInputValue?.length > 0;
  }

  inputLower = () => {
    const { onCancel, cannotSend } = this.props;

    const BottomRightRender = this.bottomRightRender();
    const canSend = this.checkCanSend();

    return (
      <div className={styles.tools}>
        <ConfigProvider
          theme={{
            components: {
              Button: {
                paddingInline: 10,
              },
            },
          }}
        >
          <Space>{this.bottomLeftRender()}</Space>
        </ConfigProvider>
        <Space className={styles.toolsRight}>
          {BottomRightRender}

          {!cannotSend && (
            <>
              {BottomRightRender && <Divider type="vertical" />}
              {!this.checkIsSending() ? (
                <Button
                  icon={<AntdIcon type="icon-fasong-tingzhi" style={{ fontSize: 24 }} />}
                  onClick={() => {
                    onCancel?.();
                  }}
                  className={classNames(styles.sendBtn, styles.cancelBtn)}
                />
              ) : (
                <Button
                  type="primary"
                  aria-label="send"
                  icon={<AntdIcon type="icon-fasong-jiantou" style={{ fontSize: 24, color: '#fff' }} />}
                  shape="circle"
                  onClick={() => {
                    const canSend = this.onSendQuery();
                    if (canSend) {
                      this.richInputRef.current?.clearAfterSend();
                    }
                  }}
                  style={{
                    backgroundColor: canSend
                      ? `var(--${PREFIX_NAME}-color-primary)`
                      : `var(--${PREFIX_NAME}-color-fill)`,
                    boxShadow: 'none',
                  }}
                  className={styles.sendBtn}
                  disabled={!canSend}
                />
              )}
            </>
          )}
        </Space>
      </div>
    );
  };

  checkCanUploadFile = () => {
    const uploadFileConfig = this.getUploadFileConfig();

    if (!uploadFileConfig) {
      //  || !uploadFileConfig.allowedFileTypes.length
      return true;
    }

    const { fileList } = this.state;
    if (uploadFileConfig.maxFileCount > 0 && fileList && fileList.length >= uploadFileConfig.maxFileCount) {
      return false;
    }
    return true;
  };

  onCreateFile = (fileItem: IFile): boolean => {
    const hasSame = this.state.fileList?.find(
      (item) => item.file.name === fileItem.file.name && item.file.size === fileItem.file.size
    );
    if (hasSame) {
      message.error(getIntl().formatMessage({ id: 'upload.duplicateFile' }));
      return false;
    }
    const uploadFileConfig = this.getUploadFileConfig();
    if (uploadFileConfig?.maxFileSize) {
      const maxFileSize = Number(uploadFileConfig.maxFileSize) * 1024 * 1024;
      if (fileItem.file.size > maxFileSize) {
        message.error(getIntl().formatMessage({ id: 'upload.fileSizeLimit' }, { size: uploadFileConfig.maxFileSize }));
        return false;
      }
    }

    this.setState((prevState) => {
      return {
        ...prevState,
        fileList: [...(prevState.fileList || []), { ...fileItem }],
      };
    });

    return true;
  };

  onUpdateFile = (fileItem: IFile) => {
    this.setState((prevState) => {
      return {
        ...prevState,
        fileList: prevState.fileList?.map((item) => {
          if (item.uid === fileItem.uid) {
            return {
              ...item,
              ...fileItem,
              status: 'done',
            };
          }
          return item;
        }),
      };
    });
  };

  onRemoveFile = (fileItem: IFile) => {
    this.setState((prevState) => {
      return {
        ...prevState,
        fileList: [...pullAllBy(prevState.fileList || [], [{ uid: fileItem.uid }], 'uid')],
      };
    });
  };

  checkIsFilesValid = (files: File[]) => {
    const uploadFileConfig = this.getUploadFileConfig();
    if (!uploadFileConfig) return true;
    const { fileList } = this.state;
    if (
      uploadFileConfig.maxFileCount > 0 &&
      fileList &&
      fileList.length + files.length > uploadFileConfig.maxFileCount
    ) {
      message.error(getIntl().formatMessage({ id: 'upload.maxFilesLimit' }, { count: uploadFileConfig.maxFileCount }));
      return false;
    }
    if (uploadFileConfig.maxFileSize) {
      const maxFileSize = Number(uploadFileConfig.maxFileSize) * 1024 * 1024;
      const invalidFiles = files.filter((file) => file.size > maxFileSize);
      if (invalidFiles.length > 0) {
        message.error(getIntl().formatMessage({ id: 'upload.fileSizeLimit' }, { size: uploadFileConfig.maxFileSize }));
        return false;
      }
    }
    return true;
  };

  onPasteFiles = (files: File[]) => {
    if (!files.length) return;
    if (!this.checkIsFilesValid(files) || !this.uploadFileRef.current) return;
    Array.from(files).forEach((file) => {
      this.uploadFileRef.current?.uploadFile(file);
    });
  };

  checkCanQuote = () => {
    const { employeesList } = this.props;
    const quoteAgentId = this.getQuoteAgentId();

    if (!quoteAgentId || !employeesList) return false;
    // 页面集成类型的数字员工，不允许#技能
    const integrationType = employeesList?.find(
      (item) =>
        `${item.agentId}` === `${quoteAgentId}` ||
        `${item.id}` === `${quoteAgentId}` ||
        `${item.resourceId}` === `${quoteAgentId}` ||
        `${item.resourceCode}` === `${quoteAgentId}`
    )?.integrationType;
    if (integrationType === 'PAGE') return false;
    return true;
  };

  chechCannotAt = () => this.props.cannotAt;

  getResourceAgentIds = (): string | undefined => {
    return this.getQuoteAgentId();
  };

  renderInput() {
    const { cannotAt, myAgentType, setMyAgentType, chatMode, isBottom, placeholder } = this.props;
    const { agentId, setAgentId } = this.props.globalContext;
    const { connectNetAgentId } = this.state;
    return (
      <div style={{ display: 'flex' }}>
        <RichInput
          style={{ flex: '1 1 auto' }}
          agentId={agentId}
          agentType={myAgentType}
          ref={this.richInputRef}
          defaultPlaceholder={placeholder}
          inAgentRoute={this.chechCannotAt()}
          onPasteFiles={this.onPasteFiles}
          onChange={(inputSchema) => {
            const { text, agentId: currentAgentId, agentType, resourceList, displayText } = inputSchema;
            this.displayQuestion = displayText;
            this.setState((prev) => ({
              ...prev,
              resourceList,
              inputValue: text,
              connectNet: resourceList.some((item) => `${item.resourceId}` === `${connectNetAgentId}`),
            }));
            // 只要存在数字员工，就保存完整 mention 草稿，防止回答过程中默认 agent 变化后丢失其它员工。
            const draft = resourceList.some((item) => `${item.resourceType}` === `${ResourceTypeMap.digitalEmployee}`)
              ? this.getPersistentMentionDraft(true)
              : { text, resourceList };
            this.props.onInputDraftChange?.(draft);
            this.syncSiderAgent(resourceList);
            if (!cannotAt && `${agentId || ''}` !== `${currentAgentId || ''}`) {
              let nextAgentType = agentType;
              if (!currentAgentId && agentId) {
                // agentId从有到无，意味着，用户在输入框内，主动删除了输入框最左侧的agent数字员工，这个时候，agentType直接转为common
                nextAgentType = agentTypeMap.common;
              }
              setMyAgentType?.(nextAgentType as IAgentType);
              // 全局会话员工 ID 统一使用字符串，避免 number/string 来回切换触发默认 @ 节点重建。
              setAgentId?.(currentAgentId ? `${currentAgentId}` : '');
            }
          }}
          onSend={() => {
            this.onSendQuery();
          }}
          chatMode={chatMode}
          isInputAtBottom={isBottom}
          canSend={() => {
            return this.checkIsSending() && this.checkCanSend();
          }}
          canQuote={this.checkCanQuote()}
          resourceAgentIds={this.getResourceAgentIds()}
        />
        {this.getAssitantTrigger()}
      </div>
    );
  }

  renderContextUsed() {
    const { contextUsed } = this.props;
    if (!contextUsed || !contextUsed.percent) return null;

    return (
      <div>
        <Progress
          type="circle"
          strokeWidth={20}
          size={16}
          percent={contextUsed.percent}
          strokeColor={contextUsed.strokeColor}
          format={() => contextUsed.format}
        />
      </div>
    );
  }

  render() {
    const { chatMode, myAgentType } = this.props;
    const { showAssitant } = this.state;

    return (
      <div
        className={classNames(styles.inputBlock, {
          [styles.expert]: myAgentType === agentTypeMap.common && chatMode === chatModeMap.expert,
        })}
        id="queryInputBase"
      >
        <OperatePopup />
        <Popover
          open={showAssitant}
          arrow={false}
          classNames={{
            root: styles.assistantPopoverContent,
          }}
          content={this.upperPopover}
          trigger="click"
          onOpenChange={(isOpen) => {
            if (!isOpen) {
              this.setState((prevState) => ({
                ...prevState,
                showAssitant: false,
              }));
            }
          }}
          destroyOnHidden
        >
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, visibility: 'hidden' }} />
        </Popover>
        {this.inputUpper()}
        {this.renderInput()}
        {this.inputLower()}
        {this.extendRender()}
      </div>
    );
  }
}

export default QueryInputBase;
