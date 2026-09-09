/* eslint-disable react/react-in-jsx-scope */
import React from 'react';
// @ts-ignore
import { getIntl, connect } from '@umijs/max';
import { Button, message, Space, Tooltip } from 'antd';
import classnames from 'classnames';
import { get, isEmpty, pullAllBy, set, trim } from 'lodash';

import AntdIcon from '@/components/AntdIcon';
import CarouselFile from '@/components/MessageList/components/CarouselFile';
import QueryInputBase, { IProps as pIProps, IState as pIState } from '@/components/QueryInput/queryInputBase';
import { chatModeMap } from '@/constants/query';
import { ResourceTypeMap } from '@/constants/resource';

import UploadFile from '../components/UploadFile';
import ConnectorControl from '../components/ConnectorControl';
import ModelSelect from '../components/ModelSelect';

import type { UserInfo } from '@/models/common/user';
import type { IFile } from '@/typescript/file';

import queryStyles from '../index.module.less';
import styles from './index.module.less';
import MentionPopover from '../RichInput/mentionPopover';
import { IChatSettingValue } from '@/typescript/cloud';
import { agentTypeMap } from '@/constants/agent';

type IState = {
  deepThink: boolean;
  connectNet: boolean;
  showMentionPopoverType: '' | '@' | '#';
  chatSettings: IChatSettingValue;

  beyondSmartModePopoverOpen: boolean;
  selectedResourceAgentIds: string;
  // undefined=本会话未选择（不发送 relModelId）；'-1'=显式默认模型；正数=模型主键。
  selectedModelId?: string;
  // 按会话记住选择，避免切换会话后把 A 会话的模型带到 B 会话。
  selectedModelBySession: Record<string, string>;
} & pIState;

type IProps = {
  dispatch?: any;
  userInfo?: UserInfo | null;

  /** 网页端是否展示模型选择器（个人数字员工会话由页面传入）。 */
  enableModelSelect?: boolean;
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
      selectedModelId: undefined,
      selectedModelBySession: {},
    };
  }

  componentDidUpdate(prevProps: IProps): void {
    if (`${prevProps.sessionId || ''}` === `${this.props.sessionId || ''}`) return;
    const prevSessionId = `${prevProps.sessionId || 'new'}`;
    const nextSessionId = this.sessionKey();
    const selectedModelBySession = { ...this.state.selectedModelBySession };
    // 新建会话拿到真实 sessionId 后，把 'new' 下的选择迁移过去，避免首轮消息后丢失。
    if (prevSessionId === 'new' && nextSessionId !== 'new' && selectedModelBySession.new) {
      selectedModelBySession[nextSessionId] = selectedModelBySession.new;
      delete selectedModelBySession.new;
      this.writeStoredModel(nextSessionId, selectedModelBySession[nextSessionId]);
      this.clearStoredModel('new');
    }
    const restored = selectedModelBySession[nextSessionId];
    if (restored !== this.state.selectedModelId || selectedModelBySession !== this.state.selectedModelBySession) {
      this.setState({ selectedModelId: restored, selectedModelBySession });
    }
  }

  sessionKey = () => `${this.props.sessionId || 'new'}`;

  modelStorageKey = (sessionId: string) => `byclaw.session.selected-model.${sessionId}`;

  readStoredModel = (sessionId: string) =>
    typeof window === 'undefined'
      ? undefined
      : window.sessionStorage.getItem(this.modelStorageKey(sessionId)) || undefined;

  writeStoredModel = (sessionId: string, value: string) => {
    if (typeof window !== 'undefined') window.sessionStorage.setItem(this.modelStorageKey(sessionId), value);
  };

  clearStoredModel = (sessionId: string) => {
    if (typeof window !== 'undefined') window.sessionStorage.removeItem(this.modelStorageKey(sessionId));
  };

  restoreSelectedModel = () => {
    const stored = this.readStoredModel(this.sessionKey());
    if (stored) {
      this.setState({ selectedModelId: stored, selectedModelBySession: { [this.sessionKey()]: stored } });
    }
  };

  // 选择器空值 = 「默认模型」：显式发送 -1 让服务端清除本会话覆盖。
  onModelSelectChange = (next?: string) => {
    const sessionKey = this.sessionKey();
    const stored = next || '-1';
    this.writeStoredModel(sessionKey, stored);
    this.setState((prevState) => ({
      selectedModelId: stored,
      selectedModelBySession: { ...prevState.selectedModelBySession, [sessionKey]: stored },
    }));
  };

  componentDidMount(): void {
    this.restoreSelectedModel();
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
  getSendPayload = () => {
    const currentInputPayload = this.getCurrentInputPayload();
    const { fileList, deepThink, chatSettings, connectNet } = this.state;
    const inputValue = currentInputPayload?.text ?? this.state.inputValue;
    const resourceList = currentInputPayload?.resourceList ?? this.state.resourceList;
    const { userInfo, chatMode, myAgentType } = this.props;
    const { agentId } = this.props.globalContext;

    const sendVal = trim(inputValue);
    if (!sendVal) return null;

    const enterpriseInformation = !!get(chatSettings, 'dataCloud.internalKnowledgeBase'); // 原本的企业资料
    const hasInlineDigitalEmployee = (resourceList || []).some(
      (item) => `${item.resourceType}` === ResourceTypeMap.digitalEmployee
    );

    let mode = chatMode;
    if (chatMode === chatModeMap.expert && !agentId && !hasInlineDigitalEmployee) {
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
        // 仅在用户为本会话显式选择时发送：'-1' = 默认模型（清除覆盖），正数 = 模型主键。
        ...(this.state.selectedModelId ? { relModelId: this.state.selectedModelId } : {}),
        ...chatSettings,
      },
      msgOpt: {
        queryMsg: {
          imageList: [],
          fileList: [],
        },
      },
      resourceList,
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

    return this.getQuoteAgentId();
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
        {this.renderContextUsed()}
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
    const quoteAgentId = this.getQuoteAgentId();
    const mentionDigitalEmployeeTip = getIntl().formatMessage({ id: 'queryInput.tooltip.mentionDigitalEmployee' });

    return (
      <>
        <Space size={14} className={styles.bottomRight}>
          {/* 连接器控制组件直接管理用户级全局开关，消息 payload 不再携带连接器 ID。 */}
          <span className="byclaw-connector-outside-tool">
            <ConnectorControl
              canAuthorize={!!this.props.userInfo}
              outside
              onOpenResourcePicker={() => this.openResourcePicker('connector')}
            />
          </span>
          {/* 多员工模式下 @ 入口始终保留，用于继续追加数字员工。 */}
          <MentionPopover
            type="@"
            chatMode={chatModeMap.expert}
            agentId={agentId}
            sessionId={sessionId}
            excludedAgentIds={(this.state.resourceList || [])
              .filter((resource) => `${resource.resourceType}` === `${ResourceTypeMap.digitalEmployee}`)
              .flatMap((resource) =>
                [resource.resourceId, resource.resourceCode].filter(Boolean).map((item) => `${item}`)
              )}
            onSelect={this.onSelectMentionPopoverItem}
            popoverPos={showMentionPopoverType === '@' ? staticEmptyObject : undefined}
            onClose={() => this.setState((prev) => ({ ...prev, showMentionPopoverType: '' }))}
          >
            <Tooltip title={mentionDigitalEmployeeTip}>
              <span
                aria-label={mentionDigitalEmployeeTip}
                className={styles.attachment}
                role="button"
                tabIndex={0}
                onClick={() => this.setState((prev) => ({ ...prev, showMentionPopoverType: '@' }))}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  this.setState((prev) => ({ ...prev, showMentionPopoverType: '@' }));
                }}
              >
                @
              </span>
            </Tooltip>
          </MentionPopover>
          <MentionPopover
            type="#"
            chatMode={chatMode}
            agentId={quoteAgentId}
            sessionId={sessionId}
            resourceAgentIds={this.getResourceAgentIds()}
            onSelect={this.onSelectMentionPopoverItem}
            popoverPos={showMentionPopoverType === '#' ? staticEmptyObject : undefined}
            onClose={() => this.setState((prev) => ({ ...prev, showMentionPopoverType: '' }))}
          >
            <Tooltip title="选择技能">
              <span
                aria-label="技能"
                className={styles.attachment}
                onClick={() => this.setState((prev) => ({ ...prev, showMentionPopoverType: '#' }))}
              >
                #
              </span>
            </Tooltip>
          </MentionPopover>
          {this.checkCanUploadFile() && (
            <UploadFile
              ref={this.uploadFileRef}
              accept={this.getUploadFileAccept()}
              beforeUpload={this.checkIsFilesValid}
              extendsPayload={{
                agentId,
                sessionType: 'AGENT',
                sessionId,
                // 新建任务上传文件会提前创建会话，创建时就传入当前选择的项目，避免先落到默认项目。
                projectId: this.props.selectedProject?.projectId || this.props.projectId,
              }}
              onCreate={(fileItem: IFile) => {
                return this.onCreateFile({
                  ...fileItem,
                });
              }}
              onUpdate={this.onUpdateFile}
              onRemove={this.onRemoveFile}
              setSessionId={(mySessionId: string, sessionName?: string) => {
                if (`${mySessionId}` === `${sessionId}`) return;
                this.props.onFileUploadSessionCreated?.(mySessionId);
                setSessionId?.(mySessionId);
                dispatch({
                  type: 'session/addSession',
                  payload: {
                    sessionId: mySessionId,
                    sessionName,
                    isLocalSession: true,
                    projectName: this.props.selectedProject?.projectName,
                    projectId: this.props.projectId ?? this.props.selectedProject?.projectId,
                    objectId: agentId,
                    objectType: agentId ? 'DigEmployee' : undefined,
                    agentType: this.props.myAgentType,
                  },
                });
                const projectId = this.props.projectId ?? this.props.selectedProject?.projectId;
                if (projectId !== undefined && projectId !== null) {
                  this.props.globalContext.EventEmitter.emit('projectSpace-session-refresh', {
                    projectId,
                    projectName: this.props.selectedProject?.projectName,
                    session: {
                      sessionId: mySessionId,
                      sessionName,
                      projectId,
                      projectName: this.props.selectedProject?.projectName,
                      updateTime: new Date().toISOString(),
                      createTime: new Date().toISOString(),
                      isLocalSession: true,
                    },
                  });
                }
              }}
            />
          )}
          <ModelSelect
            key={`desktop-model-${this.props.sessionId || 'new'}`}
            allowWeb={this.props.enableModelSelect}
            value={this.state.selectedModelId}
            onChange={this.onModelSelectChange}
          />
          {this.STTRender()}
        </Space>
      </>
    );
  };

  // @ts-ignore
  onSendQuery = async () => {
    const payload = await this.getSendPayload();

    if (!payload || isEmpty(payload)) return false;

    // Chat 覆盖了父类发送逻辑，因此同样要在清空问题前保存手动 @ 的员工。
    const persistentMentionDraft = this.getPersistentMentionDraft();
    this.finallySendQuery(payload);

    this.setState((prevState) => ({
      ...prevState,
      inputValue: persistentMentionDraft.text,
      fileList: [],
      resourceList: persistentMentionDraft.resourceList || [],
    }));
    this.props.onInputDraftChange?.(persistentMentionDraft);

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
