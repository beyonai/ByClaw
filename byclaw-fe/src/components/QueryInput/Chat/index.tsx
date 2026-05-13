/* eslint-disable react/react-in-jsx-scope */
import React from 'react';
// @ts-ignore
import { getIntl, connect } from '@umijs/max';
import { Button, message, Space } from 'antd';
import classnames from 'classnames';
import { get, isEmpty, pullAllBy, set, trim } from 'lodash';

import AntdIcon from '@/components/AntdIcon';
import CarouselFile from '@/components/MessageList/components/CarouselFile';
import QueryInputBase, { IProps as pIProps, IState as pIState } from '@/components/QueryInput/queryInputBase';
import { chatModeMap } from '@/constants/query';

import UploadFile from '../components/UploadFile';

import type { UserInfo } from '@/models/common/user';
import type { IFile } from '@/typescript/file';

import queryStyles from '../index.module.less';
import styles from './index.module.less';
import MentionPopover from '../RichInput/mentionPopover';
import { RichInputRef } from '../RichInput';
import { IChatSettingValue } from '@/typescript/cloud';
import { agentTypeMap } from '@/constants/agent';

type IState = {
  deepThink: boolean;
  connectNet: boolean;
  showMentionPopoverType: '' | '@' | '#';
  chatSettings: IChatSettingValue;

  beyondSmartModePopoverOpen: boolean;
  selectedResourceAgentIds: string;
} & pIState;

type IProps = {
  dispatch?: any;
  userInfo?: UserInfo | null;
} & pIProps;

const staticEmptyObject = {};

class QueryInputChat extends QueryInputBase<IProps, IState> {
  constructor(props: IProps) {
    super(props);

    this.state = {
      inputValue: '',
      deepThink: false,
      connectNet: false,
      showAssitant: false,
      fileList: [],
      singleChatTargetRealHumanFlag: false,
      showMentionPopoverType: '',
      chatSettings: {
        dataCloud: {},
        functionCloud: {},
        memory: {},
      } as IChatSettingValue,
      resourceList: [],
      beyondSmartModePopoverOpen: false,
      selectedResourceAgentIds: '',
    };
  }

  componentDidMount(): void {
    const { EventEmitter } = this.props.globalContext;
    EventEmitter.on('queryInput-set-schema-imme', this.setStateBySchema);
    super.componentDidMount();
  }

  componentWillUnmount(): void {
    super.componentWillUnmount();

    const { EventEmitter } = this.props.globalContext;
    EventEmitter.off('queryInput-set-schema-imme', this.setStateBySchema);
  }

  setStateBySchema = (schema: any) => {
    if (!schema) return;
    const { setChatMode } = this.props;
    const { mode, dataCloud, functionCloud } = schema.payload || {};
    if (mode) {
      const chatMode = mode === chatModeMap.base ? chatModeMap.expert : mode;
      setChatMode?.(chatMode);
    }
    if (dataCloud && functionCloud) {
      this.setState((prevState) => ({
        ...prevState,
        chatSettings: {
          dataCloud,
          functionCloud,
        },
      }));
    }
  };

  // @ts-ignore
  getSendPayload = async () => {
    const { inputValue, fileList, deepThink, chatSettings, connectNet } = this.state;
    const { userInfo, chatMode, myAgentType } = this.props;
    const { agentId } = this.props.globalContext;
    // 未显式选择数字员工时，使用登录态中的默认超级助手资源，避免再通过 "-1" 表达隐式超级助手。
    // const defaultSuperAssistantId = get(userInfo, 'defaultDigEmployeeId');
    // const targetAgentId = agentId || defaultSuperAssistantId;
    // const targetAgentType = targetAgentId ? agentTypeMap.agent : myAgentType;

    const sendVal = trim(inputValue);
    if (!sendVal) return null;

    const enterpriseInformation = !!get(chatSettings, 'dataCloud.internalKnowledgeBase'); // 原本的企业资料

    let mode = chatMode;
    if (chatMode === chatModeMap.expert && !agentId) {
      // 如果是专家模式，但没有引用数字员工，改成base
      mode = chatModeMap.base;
    }

    const queryPayload: any = {
      queryQuestion: sendVal,
      payload: {
        deepThink,
        enterpriseInformation,
        connectNet,
        files: [],
        extParams: {
          files: [],
        },
        mode,
        agentType: myAgentType,
        agentId,
        ...chatSettings,
      },
      msgOpt: {
        queryMsg: {
          imageList: [],
          fileList: [],
        },
      },
      resourceList: this.state.resourceList,
    };

    try {
      if (!isEmpty(fileList)) {
        set(queryPayload, 'payload.extParams.chatType', 'MCP_CHAT'); // 问数用

        queryPayload.payload.extParams.files.push({
          knowledgeId: get(userInfo, 'sessionDatasetId') || '',
          fileIds: [],
          files: [],
        });
        const fileIds = get(queryPayload.payload.extParams, 'files.0.fileIds');
        const fileInfos: any[] = get(queryPayload.payload.extParams, 'files.0.files');

        fileList.forEach((item) => {
          if (item.status !== 'done') {
            message.error(getIntl().formatMessage({ id: 'upload.fileNotUploaded' }));
            throw new Error(getIntl().formatMessage({ id: 'upload.fileUploadIncomplete' }));
          }
          if (item.queryFile) {
            const { fileId, fileName, fileUrl, filePath, length } = item.queryFile;
            const fileItemPayload = {
              fileId,
              fileName,
              filePath,
              fileUrl: fileUrl || filePath || fileId,
              fileType: item.fileType,
              fileSize: length,
            };

            if (item.fileType === 'image') {
              queryPayload.msgOpt.queryMsg.imageList.push(item);
            }
            if (item.fileType === 'file') {
              queryPayload.msgOpt.queryMsg.fileList.push(item);
            }

            queryPayload.payload.files.push(fileItemPayload);
            fileIds.push(`${fileId}`);
            fileInfos.push(fileItemPayload);
          }
        });
      }
    } catch (e) {
      console.error(e);
      return null;
    }

    return queryPayload;
  };

  inputUpper = () => {
    const { fileList } = this.state;

    const items: any[] = [];
    items.push(
      ...(fileList || []).map((file) => {
        return {
          fileItem: file,
          renderFileType: 'file',
        };
      })
    );
    if (isEmpty(items)) return null;

    return (
      <div className={queryStyles.inputUpperBlock}>
        {!isEmpty(items) && (
          <div className={classnames(queryStyles.filesListBlock)}>
            <CarouselFile
              items={items}
              onClose={(fileItem) => {
                this.setState((prevState) => {
                  const fileToRemove = 'fileItem' in fileItem ? fileItem.fileItem : undefined;
                  return {
                    ...prevState,
                    fileList: pullAllBy(prevState.fileList || [], fileToRemove ? [fileToRemove] : [], 'uid'),
                  };
                });
              }}
            />
          </div>
        )}
      </div>
    );
  };

  onSelectMentionPopoverItem: RichInputRef['insertItem'] = (item, type) => {
    this.richInputRef.current?.insertItem(item, type);
    this.setState((prev) => ({ ...prev, showMentionPopoverType: '' }));
  };

  onSwitchOnlineSearch = () => {
    const { employeesList } = this.props;
    const { EventEmitter } = this.props.globalContext;
    const currentConnectNet = !!this.state.connectNet;
    const connectNet = !currentConnectNet;
    const { inputValue } = this.state;
    const onlineSearchAgent = employeesList?.find((item) => item.agentType === agentTypeMap.networkSearch);
    if (onlineSearchAgent) {
      if (connectNet) {
        EventEmitter.emit('queryInput-set-schema', {
          agentId: onlineSearchAgent.agentId,
          queryQuestion: inputValue,
          inputSchema: {
            text: inputValue,
          },
        });
      } else {
        this.setState((prevState) => ({
          ...prevState,
          connectNet,
        }));
      }
    }
  };

  getResourceAgentIds = () => {
    const { selectedResourceAgentIds } = this.state;
    if (selectedResourceAgentIds) {
      return selectedResourceAgentIds;
    }

    return undefined;
  };

  checkShowOnlineSearchBtn = () => {
    const { employeesList } = this.props;

    return !!employeesList && employeesList.some((item) => item.agentType === agentTypeMap.networkSearch);
  };

  chechCannotAt = () => {
    return this.props.cannotAt;
  };

  bottomLeftRender = () => {
    const showOnlineSearch = this.checkShowOnlineSearchBtn();

    return (
      <>
        {showOnlineSearch && (
          <Button
            aria-label={getIntl().formatMessage({ id: 'queryInput.onlineSearch' })}
            onClick={this.onSwitchOnlineSearch}
            icon={<AntdIcon type="icon-a-shouye-Sphereyuanqiu" />}
            color={this.state.connectNet ? 'primary' : 'default'}
            variant="outlined"
            className={classnames({
              [styles.active]: this.state.connectNet,
            })}
          >
            {getIntl().formatMessage({ id: 'queryInput.onlineSearch' })}
          </Button>
        )}
      </>
    );
  };

  bottomRightRender = () => {
    const {
      sessionId,
      dispatch,
      globalContext: { agentId, setSessionId },
      chatMode,
    } = this.props;
    const { showMentionPopoverType } = this.state;

    return (
      <>
        <Space size="large" className={styles.bottomRight}>
          <MentionPopover
            type="@"
            chatMode={chatMode}
            agentId={agentId}
            sessionId={sessionId}
            onSelect={this.onSelectMentionPopoverItem}
            popoverPos={showMentionPopoverType === '@' ? staticEmptyObject : undefined}
            onClose={() => this.setState((prev) => ({ ...prev, showMentionPopoverType: '' }))}
          >
            <span
              className={styles.attachment}
              onClick={() => this.setState((prev) => ({ ...prev, showMentionPopoverType: '@' }))}
            >
              @
            </span>
          </MentionPopover>
          {this.checkCanQuote() && (
            <MentionPopover
              type="#"
              chatMode={chatMode}
              agentId={agentId}
              sessionId={sessionId}
              resourceAgentIds={this.getResourceAgentIds()}
              onSelect={this.onSelectMentionPopoverItem}
              popoverPos={showMentionPopoverType === '#' ? staticEmptyObject : undefined}
              onClose={() => this.setState((prev) => ({ ...prev, showMentionPopoverType: '' }))}
            >
              <span
                className={styles.attachment}
                onClick={() => this.setState((prev) => ({ ...prev, showMentionPopoverType: '#' }))}
              >
                #
              </span>
            </MentionPopover>
          )}
          {this.checkCanUploadFile() && (
            <UploadFile
              ref={this.uploadFileRef}
              extendsPayload={{
                agentId,
                sessionType: 'AGENT',
                sessionId,
              }}
              onCreate={(fileItem: IFile) => {
                return this.onCreateFile({
                  ...fileItem,
                });
              }}
              onUpdate={this.onUpdateFile}
              onRemove={this.onRemoveFile}
              setSessionId={(mySessionId: string, file: any) => {
                if (`${mySessionId}` === `${sessionId}`) return;
                setSessionId?.(mySessionId);
                dispatch({
                  type: 'session/addSession',
                  payload: {
                    sessionId: mySessionId,
                    sessionName: file?.name,
                  },
                });
              }}
              accept={this.props.uploadFileConfig?.allowedFileTypes?.join(',')}
            />
          )}
          {this.STTRender()}
        </Space>
      </>
    );
  };

  // @ts-ignore
  onSendQuery = async () => {
    const payload = await this.getSendPayload();

    if (!payload || isEmpty(payload)) return false;

    this.finallySendQuery(payload);

    this.setState((prevState) => ({
      ...prevState,
      inputValue: '',
      fileList: [],
    }));

    return true;
  };
}

export default connect(
  ({ user, employees }: any) => {
    return {
      userInfo: get(user, 'userInfo'),
      // @ts-ignore
      employeesList: get(employees, 'employeesList') || [],
    };
  },
  null,
  null,
  { forwardRef: true }
)(QueryInputChat);
