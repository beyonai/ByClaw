import MessageForm, { IFormItem } from '@/components/MessageForm';
import { IFormStatus } from '@/hooks/useSseSender/agent/typescript';
import type { IMessage } from '@/typescript/message';
import useGlobal from '@/hooks/useGlobal';
import classnames from 'classnames';
import { get, isEmpty } from 'lodash';
import { useRef, useState } from 'react';

import { useIntl, useSelector, getIntl } from '@umijs/max';
import { App, Button } from 'antd';
import { LayoutMode } from '@/constants/system';

import styles from './index.module.less';

export type FormContent = {
  pluginMachineFields: IFormItem[];
  formStatus: IFormStatus;
  humanTool?: boolean;
  metadata?: unknown;
};

export type IMessageListItemContent = {
  substance: FormContent;
  stepId?: string;

  /** SSE 挂在卡片 content 上的 metadata，原样透传 */
  metadata?: unknown;
  sourceAgentType?: string;
};

export type IProps = {
  message: IMessage;
  updateMessageListItemContent: (messageListItemContent: IMessageListItemContent) => void;
  messageListItemContent: IMessageListItemContent;
};

const emptyArr: IFormItem[] = [];

/** 是否视为「有有效 metadata」：空串不应挡住助手消息上的完整 JSON */
function isUsableRawMetadata(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') {
    return v.trim() !== '';
  }
  return true;
}

/**
 * 原样透传、不做 JSON 解析。优先本条助手回答上的 metadata（含 LangGraph checkpoint 全量）；
 * 卡片级多为空串或片段，放后面且空串不占优。
 */
function pickRawResumeMetadata(
  messageInfo: IMessage | undefined,
  messageListItemContent: IMessageListItemContent | undefined
): unknown {
  const candidates = [
    messageInfo?.metadata,
    get(messageListItemContent, 'substance.metadata'),
    get(messageListItemContent, 'metadata'),
  ];
  for (const v of candidates) {
    if (isUsableRawMetadata(v)) {
      return v;
    }
  }
  return undefined;
}

/**
 * 与底部输入框一致：主文案用用户在卡片里输入的文本（优先 textarea / input），多字段时再 JSON
 */
function buildResumeQueryQuestion(values: Record<string, unknown>, fields: IFormItem[]): string {
  const textareaField = fields.find((f) => f.formType === 'textarea');
  if (textareaField) {
    const v = values[textareaField.fieldCode];
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      return String(v);
    }
  }
  const inputField = fields.find((f) => f.formType === 'input');
  if (inputField) {
    const v = values[inputField.fieldCode];
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      return String(v);
    }
  }
  const handerFormData: { [key: string]: unknown } = {};
  fields.forEach((item) => {
    const { fieldCode } = item;
    if (Object.prototype.hasOwnProperty.call(values, fieldCode)) {
      if (item.formType === 'select') {
        const option = item.optional?.find(
          (opt: { label?: string; value: string }) => opt.value === values[fieldCode]
        );
        handerFormData[item.fieldName] = option ? option.label : values[fieldCode];
      } else if (item.formType === 'file') {
        handerFormData[item.fieldName] = values[fieldCode];
      } else {
        handerFormData[item.fieldName] = values[fieldCode];
      }
    }
  });
  return JSON.stringify(handerFormData);
}

function ThinkTaskUserInput(props: IProps) {
  const { updateMessageListItemContent, messageListItemContent, message: messageInfo } = props;

  const assistantLlmMessageId = messageInfo?.messageId ?? messageInfo?.msgId;
  const { sourceAgentType } = messageListItemContent || {};
  const { pluginMachineFields = emptyArr, formStatus, humanTool } = get(messageListItemContent, 'substance') || {};

  /** content 级（SSE）或表单 JSON 内嵌 */
  const stepIdRaw =
    get(messageListItemContent, 'stepId') ??
    get(messageListItemContent, 'substance.stepId') ??
    get(messageListItemContent, 'substance.taskStepId');
  const stepId = stepIdRaw !== undefined && stepIdRaw !== null && stepIdRaw !== '' ? String(stepIdRaw) : undefined;
  const formRef = useRef<any>(null);
  const intl = useIntl();
  const { EventEmitter, layoutMode } = useGlobal();
  const { userInfo } = useSelector(({ user }: any) => ({
    userInfo: user.userInfo,
  }));
  const isPreviewMode = layoutMode === LayoutMode.preview;
  const [submitting, setSubmitting] = useState(false);
  const { message: antdMessage } = App.useApp();

  return (
    <div className={classnames(styles.thinkTaskUserInput, 'ub ub-ac')}>
      <div className={classnames('ub-f1')}>
        <div>
          <MessageForm
            ref={formRef}
            substance={pluginMachineFields}
            disabled={formStatus !== IFormStatus.INIT || isPreviewMode}
          />
        </div>
        <div className="ub ub-pe ub-ac">
          <Button
            type="primary"
            loading={submitting}
            disabled={formStatus === IFormStatus.FINISH || isPreviewMode}
            onClick={async () => {
              const form = formRef.current;
              await form.validateFields();
              const values = form.getFieldsValue();
              try {
                setSubmitting(true);
                const pluginMachineFieldsPayload = pluginMachineFields.map((item) => {
                  return {
                    ...item,
                    fieldValue: get(values, item.fieldCode),
                  };
                });

                const extParamsFiles: { knowledgeId: string; fileIds: string[]; files: any[] }[] = [
                  { knowledgeId: get(userInfo, 'sessionDatasetId') || '', fileIds: [], files: [] },
                ];
                const filesList: Array<{
                  fileId: string;
                  fileName: string;
                  fileUrl: string;
                  fileType: string;
                  fileSize: number;
                }> = [];

                const formFileList = values?.files || [];
                if (!isEmpty(formFileList)) {
                  const { fileIds } = extParamsFiles[0];
                  const fileInfos = extParamsFiles[0].files;

                  formFileList.forEach((item: any) => {
                    if (item.status !== 'done') {
                      antdMessage.error(getIntl().formatMessage({ id: 'upload.fileNotUploaded' }));
                      return;
                    }
                    if (item.queryFile) {
                      const { fileId, fileName, fileUrl, length } = item.queryFile;
                      const fileItemPayload = {
                        fileId,
                        fileName,
                        fileUrl,
                        fileType: item.fileType,
                        fileSize: length,
                      };
                      filesList.push(fileItemPayload);
                      fileIds.push(`${fileId}`);
                      fileInfos.push(fileItemPayload);
                    }
                  });
                }

                const resumeMetadata = pickRawResumeMetadata(messageInfo, messageListItemContent);

                updateMessageListItemContent({
                  ...messageListItemContent,
                  substance: {
                    ...messageListItemContent.substance,
                    pluginMachineFields: pluginMachineFieldsPayload,
                    formStatus: IFormStatus.FINISH,
                  },
                });

                const queryQuestion = buildResumeQueryQuestion(values, pluginMachineFields);

                const payload: Record<string, unknown> = {
                  actionType: 'RESUME',
                  llmMessageId: assistantLlmMessageId,
                  files: filesList,
                  extParams: {
                    files: extParamsFiles,
                  },
                  humanTool,
                  sourceAgentType,
                };
                if (stepId) {
                  payload.taskStepId = stepId;
                }
                if (resumeMetadata !== undefined) {
                  payload.metadata = resumeMetadata;
                }

                EventEmitter.emit('beyond-chat-on-send-msg', {
                  sendProps: {
                    queryQuestion,
                    payload,
                    msgOpt: {
                      queryMsg: {},
                      answerMsg: {
                        agentId: messageInfo?.agentId,
                        agentType: messageInfo?.agentType,
                      },
                    },
                  },
                  sendConf: {
                    onlyQuery: false,
                  },
                });
              } catch (error) {
                console.log('error', error);
              } finally {
                setSubmitting(false);
              }
            }}
          >
            {formStatus === IFormStatus.FINISH
              ? intl.formatMessage({ id: 'form.completed' })
              : intl.formatMessage({ id: 'form.confirm' })}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ThinkTaskUserInput;
