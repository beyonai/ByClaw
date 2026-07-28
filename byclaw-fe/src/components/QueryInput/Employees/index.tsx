import { Button, message, Space, Tooltip } from 'antd';
import classnames from 'classnames';
import { get, isEmpty, pullAllBy, trim } from 'lodash';
// @ts-ignore
import { connect, getIntl } from '@umijs/max';
import { customAlphabet } from 'nanoid';

import AntdIcon from '@/components/AntdIcon';
import CarouselFile from '@/components/MessageList/components/CarouselFile';
import QueryInputBase, { IProps as pIProps, IState as pIState } from '@/components/QueryInput/queryInputBase';

import UploadFile from '../components/UploadFile';
import ConnectorControl from '../components/ConnectorControl';
import type { Connector } from '../components/ConnectorControl';

import type { UserState } from '@/models/common/user';
import type { IAgentCache } from '@/typescript/agent';
import type { IChatSettingValue } from '@/typescript/cloud';
import type { IFile, IQueryFile } from '@/typescript/file';

import { chatModeMap } from '@/constants/query';
import { getDownloadOpenClawFileUrl, isOpenClawAgent, uploadFileToOpenClaw } from '@/utils/openClaw/utils';
import queryStyles from '../index.module.less';
import MentionPopover from '../RichInput/mentionPopover';
import styles from './index.module.less';

type IState = {
  fileList: IFile[];
  showMentionPopoverType: '' | '@' | '#';
  chatSettings: IChatSettingValue;
  // 当前输入会话已连接的连接器，发送消息时转换为后端所需的 ID 列表。
  connectors: Connector[];
} & Omit<pIState, 'showAssitant'>;

type IProps = {
  dispatch?: any;
  employeesList?: IAgentCache[];
  agentList?: IAgentCache[];
  userInfo?: UserState;
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
      // 当前聊天输入独立维护连接器选择，避免污染其他输入实例。
      connectors: [],
    };
  }

  getSendPayload = () => {
    const { userInfo, myAgentType } = this.props;
    const currentInputPayload = this.getCurrentInputPayload();
    const { fileList, chatSettings, connectNetAgentId, connectors } = this.state;
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
          // 后端约定：当前轮次启用的连接器 ID 列表。
          connectors: connectors.map((connector) => connector.id),
        },
        agentType: myAgentType,
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
    } = this.props;
    const { showMentionPopoverType } = this.state;

    const canQuote = this.checkCanQuote();
    const quoteAgentId = this.getQuoteAgentId();
    const mentionDigitalEmployeeTip = getIntl().formatMessage({ id: 'queryInput.tooltip.mentionDigitalEmployee' });

    return (
      <>
        <Space size="large" className={styles.bottomRight}>
          {/* 连接器控制组件只负责选择，实际状态仍由聊天输入统一维护。 */}
          <ConnectorControl
            canAuthorize={!!this.props.userInfo}
            value={this.state.connectors}
            onChange={(connectors) => this.setState((prevState) => ({ ...prevState, connectors }))}
          />
          {/* 多员工模式下 @ 入口始终保留，用于继续追加数字员工。 */}
          <MentionPopover
            type="@"
            chatMode={chatModeMap.expert}
            agentId={agentId}
            sessionId={sessionId}
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
          {canQuote && (
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
              accept={this.getUploadFileAccept()}
              beforeUpload={this.checkIsFilesValid}
              extendsPayload={{
                agentId,
                sessionType: 'AGENT',
                sessionId,
              }}
              onCreate={(fileItem: IFile) => {
                return this.onEmployeeCreateFile({
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
            />
          )}
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
    };
  },
  null,
  null,
  { forwardRef: true }
)(EmployeesInputChat);
