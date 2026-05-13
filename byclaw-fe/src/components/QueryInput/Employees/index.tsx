import { Button, message, Space } from 'antd';
import classnames from 'classnames';
import { get, isEmpty, pullAllBy, trim } from 'lodash';
// @ts-ignore
import { connect, getIntl } from '@umijs/max';
import { customAlphabet } from 'nanoid';

import AntdIcon from '@/components/AntdIcon';
import CarouselFile from '@/components/MessageList/components/CarouselFile';
import QueryInputBase, { IProps as pIProps, IState as pIState } from '@/components/QueryInput/queryInputBase';

import UploadFile from '../components/UploadFile';

import type { UserState } from '@/models/common/user';
import type { IAgentCache } from '@/typescript/agent';
import type { IChatSettingValue } from '@/typescript/cloud';
import type { IFile, IQueryFile } from '@/typescript/file';

import { getDownloadOpenClawFileUrl, isOpenClawAgent, uploadFileToOpenClaw } from '@/utils/openClaw/utils';
import queryStyles from '../index.module.less';
import { RichInputRef } from '../RichInput';
import MentionPopover from '../RichInput/mentionPopover';
import styles from './index.module.less';

type IState = {
  fileList: IFile[];
  showMentionPopoverType: '' | '@' | '#';
  chatSettings: IChatSettingValue;
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
    };
  }

  getSendPayload = () => {
    const { userInfo, myAgentType } = this.props;
    const { fileList, inputValue, chatSettings, connectNetAgentId } = this.state;
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

  onSelectMentionPopoverItem: RichInputRef['insertItem'] = (item, type) => {
    this.richInputRef.current?.insertItem(item, type);
    this.setState((prev) => ({ ...prev, showMentionPopoverType: '' }));
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
    } = this.props;
    const { showMentionPopoverType } = this.state;

    const canQuote = this.checkCanQuote();

    return (
      <>
        <Space size="large" className={styles.bottomRight}>
          {canQuote && (
            <MentionPopover
              type="#"
              agentId={agentId}
              sessionId={sessionId}
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
              accept={this.props.uploadFileConfig?.allowedFileTypes?.join(',')}
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
                return {
                  ...prevState,
                  fileList: pullAllBy(prevState.fileList || [], [fileItem?.fileItem], 'uid'),
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
