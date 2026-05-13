import React from 'react';

import { getIntl } from '@umijs/max';
import { Button, ConfigProvider, Divider, message, Popover, Space } from 'antd';
import { get, isBoolean, isEmpty, isNil, pullAllBy, set, trim, compact, omit } from 'lodash';
import classNames from 'classnames';
import { agentTypeMap } from '@/constants/agent';
import { IMessageState } from '@/constants/message';
import { chatModeMap, IChatModeType } from '@/constants/query';
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
import { validateAccept } from '@/utils/file';

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
    EventEmitter.on('queryInput-set-schema-imme', this.setCommonStateBySchema);
    EventEmitter.on('queryInput-paste-files', this.onPasteFiles);
    EventEmitter.emit('pcLayout-contains-chatLayout', true, { waitForListeners: true });
    this.props.onMounted?.();
  }

  componentWillUnmount() {
    const { EventEmitter } = this.props.globalContext;
    EventEmitter.off('queryInput-push-fileList', this.pushFileList);
    EventEmitter.off('queryInput-set-value', this.setInputValue);
    EventEmitter.off('queryInput-set-schema-imme', this.setCommonStateBySchema);
    EventEmitter.off('queryInput-paste-files', this.onPasteFiles);
    EventEmitter.emit('pcLayout-contains-chatLayout', false);
  }

  setCommonStateBySchema = (schema: any) => {
    const { queryQuestion, inputSchema, payload: { files } = {} } = schema;

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
      inputValue: queryQuestion,
    }));

    if (inputSchema) {
      setTimeout(() => {
        // 目的：等待因为agentId和agentType的改变，导致RichInput的组件的内容修改
        this.richInputRef.current?.setText(inputSchema);
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

      this.richInputRef.current?.setText('');
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

  getSendPayload = () => {
    const { inputValue, resourceList } = this.state;
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
    let { resourceList = [] } = this.state;

    if (resourceList.length) {
      set(data, 'resourceList', resourceList);
    }
    this.props.onSend(data);
  };

  onSendQuery = () => {
    const payload = this.getSendPayload();

    if (!payload || isEmpty(payload)) return false;
    this.finallySendQuery(payload);

    this.setState((prevState) => ({
      ...prevState,
      inputValue: '',
      fileList: [],
    }));

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
    const { inputValue } = this.state;
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
                      this.richInputRef.current?.setText('');
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
    const { uploadFileConfig } = this.props;
    if (
      !uploadFileConfig ||
      !uploadFileConfig.enabled ||
      !uploadFileConfig.allowedFileTypes ||
      !uploadFileConfig.allowedFileTypes.length
    ) {
      return false;
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
    const { uploadFileConfig } = this.props;
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
    const { uploadFileConfig } = this.props;
    if (!uploadFileConfig) return true;
    if (!uploadFileConfig.enabled) return false;
    const { fileList } = this.state;
    if (uploadFileConfig.maxFileCount > 0 && fileList && fileList.length >= uploadFileConfig.maxFileCount) {
      message.error(getIntl().formatMessage({ id: 'upload.maxFilesLimit' }, { count: uploadFileConfig.maxFileCount }));
      return false;
    }
    if (uploadFileConfig.allowedFileTypes && uploadFileConfig.allowedFileTypes.length > 0) {
      const accept = uploadFileConfig.allowedFileTypes.join(',');
      const invalidFiles = files.filter((file) => !validateAccept(file, accept));
      if (invalidFiles.length > 0) {
        message.error(`${getIntl().formatMessage({ id: 'common.supportedFileTypes' })}${accept}`);
        return false;
      }
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
    const { agentId } = this.props.globalContext;

    if (!agentId || !employeesList) return false;
    // 页面集成类型的数字员工，不允许#技能
    const integrationType = employeesList?.find((item) => `${item.agentId}` === `${agentId}`)?.integrationType;
    if (integrationType === 'PAGE') return false;
    return true;
  };

  chechCannotAt = () => this.props.cannotAt;

  getResourceAgentIds = (): string | undefined => undefined;

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
            if (!cannotAt && agentId !== currentAgentId) {
              let nextAgentType = agentType;
              if (!currentAgentId && agentId) {
                // agentId从有到无，意味着，用户在输入框内，主动删除了输入框最左侧的agent数字员工，这个时候，agentType直接转为common
                nextAgentType = agentTypeMap.common;
              }
              setMyAgentType?.(nextAgentType as IAgentType);
              setAgentId?.(currentAgentId || '');
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
