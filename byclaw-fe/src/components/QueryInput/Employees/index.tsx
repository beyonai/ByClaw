import { Button, message, Space, Tooltip } from 'antd';
import classnames from 'classnames';
import { get, isEmpty, pullAllBy, trim } from 'lodash';
// @ts-ignore
import { connect, getIntl } from '@umijs/max';
import { customAlphabet } from 'nanoid';

import AntdIcon from '@/components/AntdIcon';
import CarouselFile from '@/components/MessageList/components/CarouselFile';
import QueryInputBase, { IProps as pIProps, IState as pIState } from '@/components/QueryInput/queryInputBase';
import { THINKING_LEVEL_DEFAULT_SIGNAL } from '@/utils/thinkingLevel';

import UploadFile from '../components/UploadFile';
import ConnectorControl from '../components/ConnectorControl';
import ModelSelect from '../components/ModelSelect';

import type { UserState } from '@/models/common/user';
import type { IAgentCache } from '@/typescript/agent';
import type { IChatSettingValue } from '@/typescript/cloud';
import type { IFile, IQueryFile } from '@/typescript/file';

import { chatModeMap } from '@/constants/query';
import { ResourceTypeMap } from '@/constants/resource';
import { getDownloadOpenClawFileUrl, isOpenClawAgent, uploadFileToOpenClaw } from '@/utils/openClaw/utils';
import { createPendingRemoteSession } from '@/utils/session';
import { confirmExistingSessionModel } from '@/service/message';
import queryStyles from '../index.module.less';
import MentionPopover from '../RichInput/mentionPopover';
import styles from './index.module.less';

type IState = {
  fileList: IFile[];
  showMentionPopoverType: '' | '@' | '#';
  chatSettings: IChatSettingValue;
  // undefined=本会话未选择（不发送 relModelId）；'-1'=显式默认模型；正数=模型主键。
  selectedModelId?: string;
  // 按会话记住选择，避免切换会话后把 A 会话的模型带到 B 会话。
  selectedModelBySession: Record<string, string>;
  // undefined=本会话未选择思考强度（不发送信号）；'-1'=跟随默认；其余为档位。
  selectedThinkingLevel?: string;
  selectedThinkingLevelBySession: Record<string, string>;
} & Omit<pIState, 'showAssitant'>;

type IProps = {
  dispatch?: any;
  employeesList?: IAgentCache[];
  agentList?: IAgentCache[];
  userInfo?: UserState;

  /** 网页端是否展示模型选择器（个人数字员工会话由页面传入）。 */
  enableModelSelect?: boolean;
} & pIProps;

const staticEmptyObject = {};

class EmployeesInputChat extends QueryInputBase<IProps, IState> {
  nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz1234567890', 6);

  constructor(props: IProps) {
    const superClass = super(props) as any;

    this.state = {
      ...superClass.state,

      chatSettings: {
        dataCloud: {},
        functionCloud: {},
        memory: {},
      } as IChatSettingValue,
      selectedModelId: undefined,
      selectedModelBySession: {},
      selectedThinkingLevel: undefined,
      selectedThinkingLevelBySession: {},
    };
  }

  componentDidUpdate(prevProps: IProps): void {
    if (`${prevProps.sessionId || ''}` === `${this.props.sessionId || ''}`) return;
    const prevSessionId = `${prevProps.sessionId || 'new'}`;
    const nextSessionId = this.sessionKey();
    const selectedModelBySession = { ...this.state.selectedModelBySession };
    const selectedThinkingLevelBySession = { ...this.state.selectedThinkingLevelBySession };
    // 新建会话拿到真实 sessionId 后，把 'new' 下的选择迁移过去，避免首轮消息后丢失。
    if (prevSessionId === 'new' && nextSessionId !== 'new' && selectedModelBySession.new) {
      selectedModelBySession[nextSessionId] = selectedModelBySession.new;
      delete selectedModelBySession.new;
      this.writeStoredModel(nextSessionId, selectedModelBySession[nextSessionId]);
      this.clearStoredModel('new');
    }
    if (prevSessionId === 'new' && nextSessionId !== 'new' && selectedThinkingLevelBySession.new) {
      selectedThinkingLevelBySession[nextSessionId] = selectedThinkingLevelBySession.new;
      delete selectedThinkingLevelBySession.new;
      this.writeStoredThinkingLevel(nextSessionId, selectedThinkingLevelBySession[nextSessionId]);
      this.clearStoredThinkingLevel('new');
    }
    const restored = selectedModelBySession[nextSessionId];
    const restoredLevel = selectedThinkingLevelBySession[nextSessionId];
    if (
      restored !== this.state.selectedModelId ||
      restoredLevel !== this.state.selectedThinkingLevel ||
      selectedModelBySession !== this.state.selectedModelBySession ||
      selectedThinkingLevelBySession !== this.state.selectedThinkingLevelBySession
    ) {
      this.setState({
        selectedModelId: restored,
        selectedModelBySession,
        selectedThinkingLevel: restoredLevel,
        selectedThinkingLevelBySession,
      });
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

  thinkingLevelStorageKey = (sessionId: string) => `byclaw.session.thinking-level.${sessionId}`;

  readStoredThinkingLevel = (sessionId: string) =>
    typeof window === 'undefined'
      ? undefined
      : window.sessionStorage.getItem(this.thinkingLevelStorageKey(sessionId)) || undefined;

  writeStoredThinkingLevel = (sessionId: string, value: string) => {
    if (typeof window !== 'undefined') window.sessionStorage.setItem(this.thinkingLevelStorageKey(sessionId), value);
  };

  clearStoredThinkingLevel = (sessionId: string) => {
    if (typeof window !== 'undefined') window.sessionStorage.removeItem(this.thinkingLevelStorageKey(sessionId));
  };

  restoreSelectedModel = () => {
    const sessionKey = this.sessionKey();
    let stored = this.readStoredModel(sessionKey);
    // EasyConfirm 在新会话取得真实 sessionId 时会按 key 重建输入框，旧实例来不及走
    // componentDidUpdate。新实例需主动接管 `new` 下的选择，避免侧栏/过程文件打开后回到默认模型。
    if (!stored && sessionKey !== 'new') {
      stored = this.readStoredModel('new');
      if (stored) {
        this.writeStoredModel(sessionKey, stored);
        this.clearStoredModel('new');
      }
    }
    let storedLevel = this.readStoredThinkingLevel(sessionKey);
    if (!storedLevel && sessionKey !== 'new') {
      storedLevel = this.readStoredThinkingLevel('new');
      if (storedLevel) {
        this.writeStoredThinkingLevel(sessionKey, storedLevel);
        this.clearStoredThinkingLevel('new');
      }
    }
    if (stored || storedLevel) {
      this.setState((prevState) => ({
        selectedModelId: stored ?? prevState.selectedModelId,
        selectedModelBySession: stored
          ? { ...prevState.selectedModelBySession, [sessionKey]: stored }
          : prevState.selectedModelBySession,
        selectedThinkingLevel: storedLevel ?? prevState.selectedThinkingLevel,
        selectedThinkingLevelBySession: storedLevel
          ? { ...prevState.selectedThinkingLevelBySession, [sessionKey]: storedLevel }
          : prevState.selectedThinkingLevelBySession,
      }));
    }
  };

  // 选择器空值 = 「默认模型」：显式发送 -1 让服务端清除本会话覆盖。
  onModelSelectChange = (next?: string) => {
    const sessionKey = this.sessionKey();
    const stored = next || '-1';
    this.writeStoredModel(sessionKey, stored);
    // 切换模型后旧档位对新模型可能不合法：只清掉本会话的档位选择，
    // 不发送任何档位信号（未做显式选择时不改变服务端覆盖），由后端按新模型重新校验。
    this.clearStoredThinkingLevel(sessionKey);
    this.setState((prevState) => {
      const nextLevels = { ...prevState.selectedThinkingLevelBySession };
      delete nextLevels[sessionKey];
      return {
        selectedModelId: stored,
        selectedModelBySession: { ...prevState.selectedModelBySession, [sessionKey]: stored },
        selectedThinkingLevel: undefined,
        selectedThinkingLevelBySession: nextLevels,
      };
    });
  };

  // '-1' = 「跟随默认 / 恢复默认」：服务端清除本会话档位覆盖。
  onThinkingLevelChange = (next?: string) => {
    const sessionKey = this.sessionKey();
    const stored = next || THINKING_LEVEL_DEFAULT_SIGNAL;
    this.writeStoredThinkingLevel(sessionKey, stored);
    this.setState((prevState) => ({
      selectedThinkingLevel: stored,
      selectedThinkingLevelBySession: { ...prevState.selectedThinkingLevelBySession, [sessionKey]: stored },
    }));
  };

  onModelConfirm = (selection: { modelId?: string; thinkingLevel?: string }) => {
    this.onModelSelectChange(selection.modelId);
    if (selection.thinkingLevel) this.onThinkingLevelChange(selection.thinkingLevel);
    confirmExistingSessionModel(this.props.sessionId, {
      modelId: selection.modelId || '-1',
      ...(selection.thinkingLevel ? { thinkingLevel: selection.thinkingLevel } : {}),
    });
  };

  componentDidMount(): void {
    this.restoreSelectedModel();
    super.componentDidMount();
  }

  getSendPayload = () => {
    const { userInfo, myAgentType } = this.props;
    const currentInputPayload = this.getCurrentInputPayload();
    const { fileList, chatSettings, connectNetAgentId } = this.state;
    const inputValue = currentInputPayload?.text ?? this.state.inputValue;
    const sendVal = trim(inputValue);

    const { agentId } = this.props.globalContext;
    // 只有联网搜索的数字员工才显示切换按钮
    const connectNet = `${connectNetAgentId}` === `${agentId}`;

    const queryPayload: any = {
      queryQuestion: sendVal,
      payload: {
        connectNet,
        files: [],
        extParams: {
          files: [],
        },
        agentType: myAgentType,
        // 仅在用户为本会话显式选择时发送：'-1' = 默认模型（清除覆盖），正数 = 模型主键。
        ...(this.state.selectedModelId ? { relModelId: this.state.selectedModelId } : {}),
        // 思考强度同理：'-1' = 跟随默认（清除档位覆盖），其余为档位值。
        ...(this.state.selectedThinkingLevel ? { relThinkingLevel: this.state.selectedThinkingLevel } : {}),
        ...chatSettings,
      },
      msgOpt: {
        queryMsg: {
          imageList: [],
          fileList: [],
        },
      },
    };

    try {
      if (!isEmpty(fileList)) {
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
            const { fileId, fileName, fileUrl, length, filePath } = item.queryFile;
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

  onSwitchOnlineSearch = () => {
    const { setAgentId } = this.props.globalContext;
    setAgentId?.('');
  };

  bottomLeftRender = () => {
    const { agentId, agentInfo } = this.props.globalContext;
    const { connectNetAgentId } = this.state;
    // 只有联网搜索的数字员工才显示切换按钮
    const showOnlineSearch = `${connectNetAgentId}` === `${agentId}`;

    if (isOpenClawAgent(agentInfo)) {
      return null;
    }

    return (
      <>
        {this.renderContextUsed()}
        {showOnlineSearch && (
          <Button
            onClick={this.onSwitchOnlineSearch}
            icon={<AntdIcon type="icon-a-shouye-Sphereyuanqiu" />}
            color="primary"
            variant="outlined"
            className={styles.active}
          >
            {getIntl().formatMessage({ id: 'queryInput.onlineSearch' })}
          </Button>
        )}
      </>
    );
  };

  onEmployeeCreateFile = (file: IFile) => {
    if (!this.onCreateFile(file)) {
      return false;
    }
    const { agentInfo } = this.props.globalContext;
    if (isOpenClawAgent(agentInfo)) {
      const rawFile = file?.file as File | undefined;
      if (!rawFile) {
        this.onRemoveFile(file);
        return false;
      }

      uploadFileToOpenClaw(rawFile)
        .then((queryFile) => {
          this.onUpdateFile({
            ...file,
            fileType: 'file',
            downloadUrl: getDownloadOpenClawFileUrl(queryFile.fileUrl!),
            queryFile: queryFile as IQueryFile,
            status: 'done',
          });
        })
        .catch((error) => {
          console.error(error);
          this.onRemoveFile(file);
        });
      return false;
    }
    return true;
  };

  bottomRightRender = () => {
    const {
      sessionId,
      dispatch,
      globalContext: { agentId, setSessionId },
      chatMode,
      cannotAt,
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
          {/* 员工详情已固定当前聊天对象，不展示追加 @ 数字员工入口。 */}
          {!cannotAt && (
            <MentionPopover
              type="@"
              chatMode={chatModeMap.expert}
              agentId={agentId}
              sessionId={sessionId}
              resourceAgentIds={this.getResourceAgentIds()}
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
          )}
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
            <Tooltip title={getIntl().formatMessage({ id: 'queryInput.tools.selectSkill' })}>
              <span
                aria-label={getIntl().formatMessage({ id: 'queryInput.tools.skill' })}
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
                // 上传接口会提前创建临时会话，必须同步带上当前选择的项目，避免会话落到默认项目。
                projectId: this.props.projectId ?? this.props.selectedProject?.projectId,
              }}
              onCreate={(fileItem: IFile) => {
                return this.onEmployeeCreateFile({
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
                  payload: createPendingRemoteSession({
                    sessionId: mySessionId,
                    sessionName,
                    projectName: this.props.selectedProject?.projectName,
                    projectId: this.props.projectId ?? this.props.selectedProject?.projectId,
                    objectId: agentId,
                    objectType: agentId ? 'DigEmployee' : undefined,
                    agentType: this.props.myAgentType,
                  }),
                });
                const projectId = this.props.projectId ?? this.props.selectedProject?.projectId;
                if (projectId !== undefined && projectId !== null) {
                  this.props.globalContext.EventEmitter.emit('projectSpace-session-refresh', {
                    projectId,
                    projectName: this.props.selectedProject?.projectName,
                    session: createPendingRemoteSession({
                      sessionId: mySessionId,
                      sessionName,
                      projectId,
                      projectName: this.props.selectedProject?.projectName,
                      updateTime: new Date().toISOString(),
                      createTime: new Date().toISOString(),
                    }),
                  });
                }
              }}
            />
          )}
          <ModelSelect
            key={`desktop-model-${this.props.sessionId || 'new'}`}
            allowWeb={this.props.enableModelSelect}
            level={this.state.selectedThinkingLevel}
            onLevelChange={this.onThinkingLevelChange}
            value={this.state.selectedModelId}
            onChange={this.onModelSelectChange}
            onConfirm={this.onModelConfirm}
          />
          {this.STTRender()}
        </Space>
      </>
    );
  };

  checkCanSend = () => {
    const { inputValue, fileList } = this.state;
    const trimInputValue = trim(inputValue || '');

    const fileIsReady = fileList.every((item) => item.status === 'done');

    return trimInputValue?.length > 0 || (!isEmpty(fileList) && fileIsReady);
  };

  inputUpper = () => {
    const { fileList } = this.state;
    const { sessionId } = this.props;

    const items: any[] = [];

    if (fileList && !isEmpty(fileList)) {
      items.push(
        ...fileList.map((file) => {
          return {
            fileItem: file,
            renderFileType: 'file',
          };
        })
      );
    }

    if (isEmpty(items)) return null;

    return (
      <div className={queryStyles.inputUpperBlock}>
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
            sessionId={sessionId}
          />
        </div>
      </div>
    );
  };
}

export default connect(
  ({ employees, user }: any) => {
    return {
      employeesList: get(employees, 'employeesList') || [],
      agentList: get(employees, 'agentList') || [],
      userInfo: get(user, 'userInfo'),
      defaultDigEmployeeId: get(employees, 'defaultDigEmployeeId') || get(user, 'userInfo.defaultDigEmployeeId'),
    };
  },
  null,
  null,
  { forwardRef: true }
)(EmployeesInputChat);
