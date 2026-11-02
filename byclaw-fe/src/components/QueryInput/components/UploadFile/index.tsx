import React, { forwardRef, useImperativeHandle } from 'react';

import { Upload, UploadProps, App, Tooltip } from 'antd';
import type { RcFile } from 'antd/es/upload';
import classnames from 'classnames';
import { isEmpty } from 'lodash';
import { customAlphabet } from 'nanoid';

import AntdIcon from '@/components/AntdIcon';
import styles from '@/components/QueryInput/Chat/index.module.less';
import { uploadFiles } from '@/service/file';
import { IFile, IQueryFile } from '@/typescript/file';
import { validateAccept } from '@/utils/file';
import { normalizeSessionId } from '@/utils/sessionId';
import type { SessionIdInput } from '@/utils/sessionId';
import { useIntl } from '@umijs/max';

type IProps = {
  extendsPayload?: Record<string, string | number | undefined>;
  onCreate: (fileItem: IFile) => boolean;
  onUpdate: (fileItem: IFile) => void;
  onRemove: (fileItem: IFile) => void;
  setSessionId: (sessionId: string, sessionName?: string) => void;
  beforeUpload?: (files: File[]) => boolean;
  uploadFile?: (
    file: File,
    report: (event: { loaded: number; total?: number }) => void
  ) => Promise<{ queryFile: Partial<IQueryFile>; downloadUrl?: string }>;

  accept?: string;
  disabled?: boolean;
  hidden?: boolean;
  children?: React.ReactNode;

  className?: string;
  listType?: UploadProps['listType'];
};

export interface UploadFileRef {
  uploadFile: (file: File) => void;
}

interface UploadContext {
  key: string;
  identity: string;
  sourceSessionId?: string;
  sessionId?: string;
  sessionName?: string;
  pendingSession?: Promise<void>;
  active: number;
  announced: boolean;
}

const UploadFile = forwardRef<UploadFileRef, IProps>((props, ref) => {
  const { children } = props;
  const {
    extendsPayload = {},
    onCreate,
    onUpdate,
    setSessionId,
    disabled = false,
    accept,
    beforeUpload,
    uploadFile: uploadSingleFile,
  } = props;
  const { message } = App.useApp();
  const intl = useIntl();
  const getNanoid = React.useRef<(size?: number) => string>(customAlphabet('abcdefghijklmnopqrstuvwxyz1234567890', 10));
  const lastInvalidFileListKeyRef = React.useRef('');
  const scheduledFileListKeyRef = React.useRef('');
  const uploadBatchTimerRef = React.useRef<number | null>(null);
  const uploadFileTip = intl.formatMessage({ id: 'queryInput.tooltip.uploadFile' });

  const getFileListKey = (files: File[]) => {
    return files.map((file) => `${file.name}-${file.size}-${file.lastModified}`).join('|');
  };

  const mounted = React.useRef(true);
  const contextRef = React.useRef<UploadContext | undefined>(undefined);
  const sourceSessionId = normalizeSessionId(extendsPayload.sessionId);
  const identity = JSON.stringify([extendsPayload.agentId, extendsPayload.projectId, extendsPayload.sessionType]);
  const key = JSON.stringify([identity, sourceSessionId]);
  const previousContext = contextRef.current;
  if (
    !previousContext ||
    (previousContext.key !== key &&
      !(previousContext.identity === identity && sourceSessionId && previousContext.sessionId === sourceSessionId))
  ) {
    contextRef.current = { key, identity, sourceSessionId, sessionId: sourceSessionId, active: 0, announced: false };
  } else {
    previousContext.key = key;
  }
  const isCurrent = (context: UploadContext) => mounted.current && contextRef.current === context;

  const onUpload = async (files: File[], context = contextRef.current!) => {
    if (!isCurrent(context)) return;
    const validFiles = files.filter((file) => validateAccept(file, accept));
    if (!validFiles.length) return;

    // Validate the complete selection before creating any attachment or request.
    if (beforeUpload && !beforeUpload(validFiles)) return;

    const uploadItems = validFiles
      .map((file) => {
        const payload: IFile = {
          uid: getNanoid.current(),
          file,
          downloadUrl: URL.createObjectURL(file),
          status: 'uploading',
          fileType: 'file',
          uploadProgress: 0,
          uploadPhase: 'uploading',
        };
        return { file, payload, running: false, attempt: 0 };
      })
      .filter(({ payload }) => onCreate({ ...payload }));

    const run = async (item: (typeof uploadItems)[number], retry = false) => {
      if (item.running || !isCurrent(context)) return;
      item.running = true;
      item.attempt += 1;
      const attempt = item.attempt;
      context.active += 1;
      let latest: IFile = { ...item.payload, uploadError: undefined, retryUpload: undefined };
      if (retry) onUpdate(latest);
      const report = ({ loaded, total }: { loaded: number; total?: number }) => {
        if (!isCurrent(context) || !item.running || item.attempt !== attempt) return;
        const progress =
          total && total > 0
            ? Math.min(100, Math.max(0, Math.round((loaded / total) * 100)))
            : latest.uploadProgress || 0;
        latest = {
          ...latest,
          status: 'uploading',
          uploadProgress: progress,
          uploadPhase: progress >= 100 ? 'processing' : 'uploading',
        };
        onUpdate(latest);
      };
      try {
        // Only the first request may create a new session. Siblings reuse its identity.
        while (!uploadSingleFile && !context.sessionId && context.pendingSession) await context.pendingSession;
        const execute = async () => {
          let queryFile: Partial<IQueryFile> | undefined;
          let downloadUrl: string | undefined;
          if (uploadSingleFile) {
            const uploaded = await uploadSingleFile(item.file, report);
            queryFile = uploaded.queryFile;
            downloadUrl = uploaded.downloadUrl;
          } else {
            const formData = new FormData();
            formData.append('files', item.file);
            Object.keys(extendsPayload).forEach((keyName) => {
              formData.append(keyName, `${extendsPayload[keyName] ?? ''}`);
            });
            if (context.sessionId) formData.set('sessionId', context.sessionId);
            const data = await uploadFiles(formData, report);
            const { rebuildFileList = [], uploadItems: responseItems = [], sessionId, sessionName } = data || {};
            const uploadedFiles = !isEmpty(rebuildFileList) ? rebuildFileList : responseItems;
            const resolvedSessionId = normalizeSessionId(sessionId as SessionIdInput);
            if (resolvedSessionId) {
              context.sessionId = resolvedSessionId;
              context.sessionName = sessionName;
            }
            queryFile = uploadedFiles[0];
          }
          if (!queryFile || ['FAILED', 'ERROR'].includes(String(queryFile.uploadState || '').toUpperCase())) {
            throw new Error(intl.formatMessage({ id: 'upload.failed' }));
          }
          if (isCurrent(context)) {
            onUpdate({
              ...latest,
              ...(downloadUrl ? { downloadUrl } : {}),
              queryFile,
              status: 'done',
              uploadProgress: 100,
              uploadError: undefined,
              retryUpload: undefined,
            });
          }
        };
        if (!uploadSingleFile && !context.sessionId) {
          const request = execute();
          const pending = request.then(
            () => {},
            () => {}
          );
          context.pendingSession = pending;
          try {
            await request;
          } finally {
            if (context.pendingSession === pending) context.pendingSession = undefined;
          }
        } else {
          await execute();
        }
      } catch (error: unknown) {
        if (!isCurrent(context)) return;
        const reason = typeof error === 'string' ? error : error instanceof Error ? error.message : '';
        const uploadError = reason || intl.formatMessage({ id: 'upload.failed' });
        onUpdate({
          ...latest,
          status: 'error',
          uploadError,
          retryUpload: () => {
            void run(item, true);
          },
        });
        message.error(uploadError);
      } finally {
        item.running = false;
        context.active -= 1;
        if (
          isCurrent(context) &&
          context.active === 0 &&
          context.sessionId &&
          !context.announced &&
          context.sessionId !== context.sourceSessionId
        ) {
          context.announced = true;
          setSessionId(context.sessionId, context.sessionName);
        }
      }
    };
    await Promise.all(uploadItems.map((item) => run(item)));
  };

  const scheduleUpload = (files: File[]) => {
    const fileListKey = getFileListKey(files);
    if (scheduledFileListKeyRef.current === fileListKey) return;
    scheduledFileListKeyRef.current = fileListKey;
    if (uploadBatchTimerRef.current !== null) {
      window.clearTimeout(uploadBatchTimerRef.current);
    }
    const scheduledContext = contextRef.current;
    uploadBatchTimerRef.current = window.setTimeout(() => {
      scheduledFileListKeyRef.current = '';
      uploadBatchTimerRef.current = null;
      if (scheduledContext && isCurrent(scheduledContext)) void onUpload(files, scheduledContext);
    }, 0);
  };

  const handleBeforeUpload: UploadProps['beforeUpload'] = (file, fileList) => {
    const files = (fileList?.length ? fileList : [file]).map((item) => item as RcFile);
    const fileListKey = getFileListKey(files);
    const hasInvalidType = files.some((item) => !validateAccept(item, accept));

    if (hasInvalidType) {
      if (hasInvalidType && lastInvalidFileListKeyRef.current !== fileListKey) {
        message.error(`${intl.formatMessage({ id: 'common.supportedFileTypes' })}${accept}`);
      }
      lastInvalidFileListKeyRef.current = fileListKey;
      return Upload.LIST_IGNORE;
    }

    lastInvalidFileListKeyRef.current = '';
    scheduleUpload(files);
    return Upload.LIST_IGNORE;
  };

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (uploadBatchTimerRef.current !== null) {
        window.clearTimeout(uploadBatchTimerRef.current);
      }
    };
  }, []);

  useImperativeHandle(ref, () => ({
    uploadFile: (file: File) => {
      if (!validateAccept(file, accept)) {
        return;
      }
      onUpload([file]);
    },
  }));

  return (
    <Upload
      disabled={disabled || props.hidden}
      style={props.hidden ? { display: 'none' } : undefined}
      multiple
      accept={accept}
      className={props.className}
      listType={props.listType}
      // accept=".doc,.docx,.xls,.xlsx,.ppt,.pdf,.txt"
      showUploadList={false}
      beforeUpload={handleBeforeUpload}
      customRequest={async (options) => {
        const { file } = options;
        onUpload([file as File]);
      }}
    >
      {children || (
        <Tooltip title={uploadFileTip}>
          <span
            aria-label={uploadFileTip}
            className={classnames(styles.attachment, { disabled })}
            role="button"
            tabIndex={disabled ? -1 : 0}
            onKeyDown={(event) => {
              if (disabled || (event.key !== 'Enter' && event.key !== ' ')) return;
              event.preventDefault();
              event.currentTarget.click();
            }}
          >
            <AntdIcon type="icon-shouye-icon-wrapper" style={{ fontSize: '18px' }} />
          </span>
        </Tooltip>
      )}
    </Upload>
  );
});

export default UploadFile;
