import { Button, Space, message, Modal, Input } from 'antd';
import React, { useCallback, useState } from 'react';
import { CloseOutlined, SelectOutlined, FileAddOutlined } from '@ant-design/icons';
import { isEmpty, compact, get } from 'lodash';
import classnames from 'classnames';
import { useIntl, useSelector, useDispatch, useNavigate } from '@umijs/max';
import { customAlphabet } from 'nanoid';

import ShareSelect from './components/ShareSelect';
import Memory from './components/Memory';
import LinkShare from './components/LinkShare';
import SaveToKnowledgeModal from './components/SaveToKnowledgeModal';
import AntdIcon from '@/components/AntdIcon';

import useTracker from '@/hooks/useTracker';
import useGlobal from '@/hooks/useGlobal';

import { agentTypeMap } from '@/constants/agent';
import { getAgentPath } from '@/utils/agent';
import { isOpenClawAgent } from '@/utils/openClaw/utils';
import { getFileUrl } from '@/utils/file';
import {
  referenceToOpenClawHandler,
  referenceToWisdomPenHandler,
} from '@/components/ChatLayoutComp/components/MultiChoices/util';
import { getMessageText } from '@/utils/messgae';

import { uploadFiles } from '@/service/file';
import { writeTxt } from '@/service/workSpace';
import type { IState as UseEmployeesIState } from '@/models/useEmployees';
import type { IMultiChoicesType } from '@/components/ChatLayoutComp/hooks/useEventEmitterHooks';
import type { IAgentType } from '@/typescript/agent';
import type { IQueryFile } from '@/typescript/file';
import { ISession } from '@/typescript/session';
import { IMessage } from '@/typescript/message';
import type { NotificationInstance } from 'antd/es/notification/interface.d.ts';

import styles from './index.module.less';

type IProps = {
  multiChoicesList: any[];
  currentSession: ISession;
  sessionId: string;
  multiChoicesMsgId: string[];
  messageList: IMessage[];
  setMultiChoicesMsgId: React.Dispatch<React.SetStateAction<string[]>>;
  setMultiChoicesList: React.Dispatch<React.SetStateAction<IMultiChoicesType[]>>;
  updateSession: (session: Partial<Omit<ISession, 'sessionId'>> & Pick<ISession, 'sessionId'>) => void;
  setMyAgentType: React.Dispatch<React.SetStateAction<IAgentType>>;
  notificationMessage: NotificationInstance;
};

function MultiChoices(props: IProps) {
  const {
    multiChoicesList,
    currentSession,
    sessionId,
    multiChoicesMsgId,
    messageList,
    setMultiChoicesMsgId,
    setMultiChoicesList,
    updateSession,
    setMyAgentType,
    notificationMessage,
  } = props;

  const { EventEmitter } = useGlobal();

  const [sessionSelectOpen, setSessionSelectOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [linkShareOpen, setLinkShareOpen] = useState(false);
  const [saveToKnowledgeOpen, setSaveToKnowledgeOpen] = useState(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [workspaceModalOpen, setWorkspaceModalOpen] = useState(false);
  const [workspaceFileName, setWorkspaceFileName] = useState('');
  const [countdown, setCountdown] = useState(15);
  const [countdownTimer, setCountdownTimer] = useState<NodeJS.Timeout | null>(null);
  const [workspaceSaveData, setWorkspaceSaveData] = useState<{
    userCode: string;
    sessionId: string;
    content: string;
  } | null>(null);

  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { setAgentId, setSessionId } = useGlobal();
  const intl = useIntl();

  const { trackerEmployeeClick } = useTracker();

  const { agentList, employeesList } = useSelector(({ employees }: { employees: UseEmployeesIState }) => employees);
  const { userInfo } = useSelector((state: any) => state.user);

  const getNanoid = React.useRef<(size?: number) => string>(customAlphabet('abcdefghijklmnopqrstuvwxyz1234567890', 10));

  const openClawAgent = React.useMemo(() => {
    return employeesList.find((item) => isOpenClawAgent(item));
  }, [employeesList]);

  const writerAgent = React.useMemo(() => {
    return [...agentList, ...employeesList].find((item) => item.agentType === agentTypeMap.writer);
  }, [agentList, employeesList]);

  const getExportMessageInfo = React.useCallback(
    (msg: IMessage) => {
      let metadata: Record<string, any> = {};

      try {
        metadata = JSON.parse(msg?.metadata || '{}');
      } catch (error) {
        metadata = {};
      }

      const sender = ['1', '4'].includes(`${msg?.usage || ''}`)
        ? intl.formatMessage({ id: 'multiChoices.export.senderUser' })
        : intl.formatMessage({ id: 'multiChoices.export.senderAssistant' });
      const content = getMessageText(msg) || '';
      const resourceName = metadata?.resourceName || msg?.resourceList?.[0]?.resourceName || '';
      const resourceType = metadata?.resourceType || msg?.resourceList?.[0]?.resourceType || '';

      return {
        sender,
        content,
        resourceName,
        resourceType,
        messageId: msg?.messageId || msg?.msgId || '',
        sessionId: msg?.sessionId || '',
        createTime: new Date(msg?.createTime || Date.now()).toLocaleString(),
      };
    },
    [intl]
  );

  const myUploadFileToOpenClaw = React.useCallback(
    (rawFile: File) => {
      if (!openClawAgent) return;

      dispatch({
        type: 'session/save',
        payload: {
          nextSessionRawFileCache: [rawFile],
        },
      });

      trackerEmployeeClick(openClawAgent, 'referenceAgentRedirect');

      setAgentId?.(`${openClawAgent.agentId}`);
      setSessionId?.('');
      navigate(getAgentPath(openClawAgent));
    },
    [openClawAgent]
  );

  const writeTxtHandler = useCallback(
    (payload: { userCode: string; sessionId: string; filePath: string; content: string }) => {
      writeTxt(payload)
        .then(() => {
          message.success(intl.formatMessage({ id: 'multiChoices.saveToWorkspace.success' }));
          setMultiChoicesMsgId([]);
          setMultiChoicesList([]);
          setWorkspaceModalOpen(false);

          EventEmitter.emit('beyond-resourceList-resourceType-reload', 'SPACE');
        })
        .catch((error) => {
          console.error('Failed to save to workspace:', error);
          message.error(intl.formatMessage({ id: 'multiChoices.saveToWorkspace.failed' }));
        });
    },
    [EventEmitter, intl, setMultiChoicesList, setMultiChoicesMsgId]
  );

  const myUploadFileToWriter = React.useCallback(
    (rawFile: File) => {
      return new Promise((resolve, reject) => {
        setIsLoading(true);

        const formData = new FormData();
        formData.append('files', rawFile);
        formData.append('sessionType', 'WRITER');
        formData.append('sessionId', `${sessionId || ''}`);
        formData.append('agentId', `${writerAgent?.id || ''}`);

        uploadFiles(formData)
          .then((data: { sessionId: string; sessionDatasetid: string; rebuildFileList: IQueryFile[] }) => {
            const queryFile = get(data, 'rebuildFileList.0');
            if (queryFile) {
              const fileItem = {
                uid: getNanoid.current(),
                file: rawFile,
                downloadUrl: getFileUrl(queryFile.fileUrl),
                status: 'done',
                fileType: 'file',
                queryFile,
              };

              dispatch({
                type: 'session/save',
                payload: {
                  nextSessionIFileCache: fileItem,
                },
              });

              resolve(true);
            } else {
              reject(new Error(intl.formatMessage({ id: 'multiChoices.uploadFailed' })));
            }
          })
          .catch(reject)
          .finally(() => {
            setIsLoading(false);
          });
      });
    },
    [writerAgent, sessionId, intl]
  );

  return (
    <>
      <div className={classnames('ub-ac ub-pc', styles.multiChoicesWrapper)}>
        <div className="full-width mW900 ub ub-ac ub-pe">
          <Space size="large">
            {/* {multiChoicesList.includes('memory') && (
              <Button
                type="primary"
                onClick={() => {
                  setMemoryOpen(true);
                }}
              >
                {intl.formatMessage({ id: 'memory.enhanceMemory' })}
              </Button>
            )} */}
            {multiChoicesList.includes('collect') && (
              <Space>
                <Button
                  icon={<FileAddOutlined />}
                  onClick={() => {
                    setSaveToKnowledgeOpen(true);
                  }}
                  disabled={isEmpty(multiChoicesMsgId)}
                >
                  {intl.formatMessage({ id: 'multiChoices.saveToKnowledge' })}
                </Button>
                <Button
                  icon={<AntdIcon type="icon-a-Starxingxing" style={{ fontSize: '16px' }} />}
                  onClick={() => {
                    try {
                      const userCode = userInfo?.userCode || '';
                      const userName = userInfo?.userName || '';
                      if (!userCode) {
                        message.error(intl.formatMessage({ id: 'multiChoices.saveToWorkspace.userInfoFailed' }));
                        return;
                      }

                      // 生成默认文件名
                      const now = new Date();
                      const timestamp =
                        now.getFullYear() +
                        String(now.getMonth() + 1).padStart(2, '0') +
                        String(now.getDate()).padStart(2, '0') +
                        '_' +
                        String(now.getHours()).padStart(2, '0') +
                        String(now.getMinutes()).padStart(2, '0') +
                        String(now.getSeconds()).padStart(2, '0');
                      const defaultFileName = intl.formatMessage(
                        { id: 'multiChoices.saveToKnowledge.defaultFileName' },
                        { userName, timestamp }
                      );

                      const selectedMessages = multiChoicesMsgId
                        .map((msgId) => messageList.find((item) => item.msgId === msgId))
                        .filter(Boolean);

                      let content = '';
                      selectedMessages.forEach((msg, index) => {
                        if (msg) {
                          const messageInfo = getExportMessageInfo(msg);
                          content += `# ${intl.formatMessage(
                            { id: 'multiChoices.export.messageTitle' },
                            { index: index + 1 }
                          )}\n`;
                          content += `**${intl.formatMessage({ id: 'multiChoices.export.messageId' })}**: ${
                            messageInfo.messageId
                          }\n`;
                          content += `**${intl.formatMessage({ id: 'multiChoices.export.sessionId' })}**: ${
                            messageInfo.sessionId
                          }\n`;
                          content += `**${intl.formatMessage({ id: 'multiChoices.export.sender' })}**: ${
                            messageInfo.sender
                          }\n`;
                          content += `**${intl.formatMessage({ id: 'common.time' })}**: ${messageInfo.createTime}\n`;
                          if (messageInfo.resourceName || messageInfo.resourceType) {
                            content += `**${intl.formatMessage({ id: 'multiChoices.export.resource' })}**: ${
                              messageInfo.resourceName || '-'
                            }${messageInfo.resourceType ? ` (${messageInfo.resourceType})` : ''}\n`;
                          }
                          content += `**${intl.formatMessage({ id: 'multiChoices.export.content' })}**:\n${
                            messageInfo.content || ''
                          }\n\n`;
                        }
                      });

                      setWorkspaceFileName(defaultFileName);
                      setCountdown(15);
                      setWorkspaceSaveData({
                        userCode,
                        sessionId,
                        content,
                      });
                      // 启动倒计时
                      if (countdownTimer) {
                        clearInterval(countdownTimer);
                        setCountdownTimer(null);
                      }
                      const currentSaveData = {
                        userCode,
                        sessionId,
                        content,
                      };
                      const currentFileName = defaultFileName;
                      const timer = setInterval(() => {
                        setCountdown((prev) => {
                          if (prev <= 1) {
                            clearInterval(timer);
                            setCountdownTimer(null);
                            setWorkspaceModalOpen(false);
                            writeTxtHandler({
                              userCode: currentSaveData.userCode,
                              sessionId: currentSaveData.sessionId,
                              filePath: currentFileName + '.md',
                              content: currentSaveData.content,
                            });

                            return 0;
                          }
                          return prev - 1;
                        });
                      }, 1000);
                      setCountdownTimer(timer);
                      setWorkspaceModalOpen(true);
                    } catch (error) {
                      console.error('Failed to save to workspace:', error);
                      message.error(intl.formatMessage({ id: 'multiChoices.saveToWorkspace.failed' }));
                    }
                  }}
                  disabled={isEmpty(multiChoicesMsgId)}
                >
                  {intl.formatMessage({ id: 'multiChoices.saveToWorkspace' })}
                </Button>
              </Space>
            )}
            {multiChoicesList.includes('shared') && (
              <Space>
                <Button
                  icon={<AntdIcon type="icon-a-Share-twofenxiang21" style={{ fontSize: 20 }} />}
                  onClick={() => {
                    setSessionSelectOpen(true);
                  }}
                  disabled={isEmpty(multiChoicesMsgId)}
                >
                  {intl.formatMessage({ id: 'common.shareByai' })}
                </Button>
                <Button
                  icon={<AntdIcon type="icon-a-Share-twofenxiang21" style={{ fontSize: 20 }} />}
                  onClick={() => {
                    setLinkShareOpen(true);
                  }}
                  disabled={isEmpty(multiChoicesMsgId)}
                >
                  {intl.formatMessage({ id: 'common.linkShare' })}
                </Button>
              </Space>
            )}
            {multiChoicesList.includes('reference') && (
              <>
                {openClawAgent && (
                  <Button
                    icon={<SelectOutlined />}
                    onClick={() => {
                      const textFile = referenceToOpenClawHandler(messageList, multiChoicesMsgId);

                      myUploadFileToOpenClaw(textFile);
                    }}
                    disabled={isEmpty(multiChoicesMsgId)}
                    loading={isLoading}
                  >
                    {intl.formatMessage({ id: 'multiChoices.referenceToOpenClaw' })}
                  </Button>
                )}
                {writerAgent && (
                  <Button
                    icon={<SelectOutlined />}
                    onClick={async () => {
                      if (writerAgent.integrationType === 'PAGE') {
                        const textFile = referenceToWisdomPenHandler(messageList, multiChoicesMsgId);
                        try {
                          await myUploadFileToWriter(textFile);

                          setMyAgentType(agentTypeMap.writer);
                          setAgentId?.(writerAgent.agentId);
                          setSessionId?.('');

                          navigate(getAgentPath(writerAgent));
                        } catch (e: any) {
                          message.error(e.toString());
                        }

                        return;
                      }

                      await updateSession({
                        sessionId,
                        citeMsgIdList: multiChoicesMsgId,
                      });
                      setMultiChoicesList([]);

                      setMyAgentType(agentTypeMap.writer);
                      setAgentId?.(writerAgent.agentId);
                    }}
                    disabled={isEmpty(multiChoicesMsgId)}
                    loading={isLoading}
                  >
                    {intl.formatMessage({ id: 'multiChoices.referenceToWisdomPen' })}
                  </Button>
                )}
              </>
            )}
            <CloseOutlined
              style={{ fontSize: 20 }}
              className="pointer"
              onClick={() => {
                setMultiChoicesMsgId([]);
                setMultiChoicesList([]);
              }}
            />
          </Space>
        </div>
      </div>
      <Memory
        open={memoryOpen}
        onClose={() => setMemoryOpen(false)}
        multiChoicesMsgId={multiChoicesMsgId}
        messageList={messageList}
        onSuccess={() => {
          setMultiChoicesMsgId([]);
          setMultiChoicesList([]);
          setSessionSelectOpen(false);
        }}
      />
      <ShareSelect
        sessionSelectOpen={sessionSelectOpen}
        notificationMessage={notificationMessage}
        onClose={() => {
          setMultiChoicesMsgId([]);
          setMultiChoicesList([]);
          setSessionSelectOpen(false);
        }}
        getExtraInfo={() => {
          return {
            shareSourceType: 'chat',
            shareData: {
              messageIds: multiChoicesMsgId
                .map((msgId) => {
                  const item = messageList.find((item) => item.msgId === msgId);
                  return item?.messageId;
                })
                .join(','),
            },
          };
        }}
      />
      <LinkShare
        open={linkShareOpen}
        onClose={() => setLinkShareOpen(false)}
        getExtraInfo={() => {
          return {
            title: `${currentSession?.sessionName || intl.formatMessage({ id: 'multiChoices.linkShareDefaultTitle' })}`,
            messageIds: compact(
              multiChoicesMsgId.map((msgId) => {
                const item = messageList.find((item) => item.msgId === msgId);
                return `${item?.messageId || ''}`;
              })
            ),
          };
        }}
      />
      <SaveToKnowledgeModal
        open={saveToKnowledgeOpen}
        onClose={() => setSaveToKnowledgeOpen(false)}
        multiChoicesMsgId={multiChoicesMsgId}
        messageList={messageList}
        onSuccess={() => {
          setMultiChoicesMsgId([]);
          setMultiChoicesList([]);
        }}
      />
      <Modal
        title={intl.formatMessage({ id: 'multiChoices.saveToWorkspace' })}
        open={workspaceModalOpen}
        onCancel={() => {
          setWorkspaceModalOpen(false);
          if (countdownTimer) {
            clearInterval(countdownTimer);
            setCountdownTimer(null);
          }
        }}
        onOk={async () => {
          setWorkspaceModalOpen(false);
          if (countdownTimer) {
            clearInterval(countdownTimer);
            setCountdownTimer(null);
          }
          if (workspaceSaveData) {
            writeTxtHandler({
              userCode: workspaceSaveData.userCode,
              sessionId: workspaceSaveData.sessionId,
              filePath: workspaceFileName + '.md',
              content: workspaceSaveData.content,
            });
          }
        }}
      >
        <div className={styles.fileNameContainer}>
          <p className={styles.fileNameLabel}>
            {intl.formatMessage({ id: 'multiChoices.saveToKnowledge.fileName' })}：
          </p>
          <Input
            value={workspaceFileName}
            onChange={(e) => {
              setWorkspaceFileName(e.target.value);
              setCountdown(15);
              if (countdownTimer) {
                clearInterval(countdownTimer);
                setCountdownTimer(null);
              }
              const timer = setInterval(() => {
                setCountdown((prev) => {
                  if (prev <= 1) {
                    clearInterval(timer);
                    setCountdownTimer(null);
                    if (workspaceSaveData) {
                      writeTxtHandler({
                        userCode: workspaceSaveData.userCode,
                        sessionId: workspaceSaveData.sessionId,
                        filePath: workspaceFileName + '.md',
                        content: workspaceSaveData.content,
                      });
                    }
                    return 0;
                  }
                  return prev - 1;
                });
              }, 1000);
              setCountdownTimer(timer);
            }}
            suffix=".md"
            className={styles.fileNameInput}
          />
        </div>
        <p className={styles.countdownText}>
          {intl.formatMessage({ id: 'multiChoices.saveToWorkspace.autoSave' }, { seconds: countdown })}
        </p>
      </Modal>
    </>
  );
}

export default MultiChoices;
