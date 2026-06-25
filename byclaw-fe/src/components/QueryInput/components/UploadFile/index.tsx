import React, { forwardRef, useImperativeHandle } from 'react';

import { Upload, UploadProps, App, Tooltip } from 'antd';
import type { RcFile } from 'antd/es/upload';
import classnames from 'classnames';
import { head, isEmpty } from 'lodash';
import { customAlphabet } from 'nanoid';

import AntdIcon from '@/components/AntdIcon';
import styles from '@/components/QueryInput/Chat/index.module.less';
import { uploadFiles } from '@/service/file';
import { IFile, IQueryFile } from '@/typescript/file';
import { validateAccept } from '@/utils/file';
import { useIntl } from '@umijs/max';

type IProps = {
  extendsPayload?: Record<string, string | number | undefined>;
  onCreate: (fileItem: IFile) => boolean;
  onUpdate: (fileItem: IFile) => void;
  onRemove: (fileItem: IFile) => void;
  setSessionId: (sessionId: string, file: any) => void;
  beforeUpload?: (files: File[]) => boolean;

  accept?: string;
  disabled?: boolean;
  children?: React.ReactNode;

  className?: string;
  listType?: UploadProps['listType'];
};

export interface UploadFileRef {
  uploadFile: (file: File) => void;
}

const UploadFile = forwardRef<UploadFileRef, IProps>((props, ref) => {
  const { children } = props;
  const {
    extendsPayload = {},
    onCreate,
    onUpdate,
    onRemove,
    setSessionId,
    disabled = false,
    accept,
    beforeUpload,
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

  const onUpload = async (files: File[]) => {
    const validFiles = files.filter((file) => validateAccept(file, accept));
    if (!validFiles.length) return;

    const uploadItems = validFiles
      .map((file) => {
        const blobUrl = URL.createObjectURL(file as File);
        const payload: IFile = {
          uid: getNanoid.current(),
          file,
          downloadUrl: blobUrl,
          status: 'uploading',
          fileType: 'file',
        };
        return {
          file,
          payload,
        };
      })
      .filter(({ payload }) => onCreate({ ...payload }));

    if (!uploadItems.length) return;

    const formData = new FormData();
    uploadItems.forEach(({ file }) => {
      formData.append('files', file);
    });
    Object.keys(extendsPayload || {}).forEach((keyName) => {
      formData.append(keyName, `${extendsPayload[keyName] || ''}`);
    });

    try {
      const data: {
        sessionId?: string;
        sessionDatasetid?: string;
        rebuildFileList?: IQueryFile[];
        uploadItems?: Partial<IQueryFile>[];
      } = await uploadFiles(formData);

      const { rebuildFileList = [], uploadItems: responseUploadItems = [], sessionId } = data || {};
      const uploadedFileList = !isEmpty(rebuildFileList) ? rebuildFileList : responseUploadItems;

      const firstUploadedFile = uploadItems[0]?.file;
      if (sessionId && firstUploadedFile && setSessionId) {
        setSessionId(sessionId, firstUploadedFile);
      }

      if (!isEmpty(uploadedFileList)) {
        uploadItems.forEach(({ payload }, index) => {
          onUpdate({
            ...payload,
            queryFile: uploadedFileList[index] || head(uploadedFileList),
            status: 'done',
          });
        });
      }
    } catch (e: any) {
      uploadItems.forEach(({ payload }) => {
        onRemove({ ...payload });
      });
    }
  };

  const scheduleUpload = (files: File[]) => {
    const fileListKey = getFileListKey(files);
    if (scheduledFileListKeyRef.current === fileListKey) return;
    scheduledFileListKeyRef.current = fileListKey;
    if (uploadBatchTimerRef.current !== null) {
      window.clearTimeout(uploadBatchTimerRef.current);
    }
    uploadBatchTimerRef.current = window.setTimeout(() => {
      scheduledFileListKeyRef.current = '';
      uploadBatchTimerRef.current = null;
      onUpload(files);
    }, 0);
  };

  const handleBeforeUpload: UploadProps['beforeUpload'] = (file, fileList) => {
    const files = (fileList?.length ? fileList : [file]).map((item) => item as RcFile);
    const fileListKey = getFileListKey(files);
    const isInvalid = beforeUpload ? !beforeUpload(files) : false;
    const hasInvalidType = files.some((item) => !validateAccept(item, accept));

    if (isInvalid || hasInvalidType) {
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
    return () => {
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
      disabled={disabled}
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
            <AntdIcon type="icon-shouye-icon-wrapper" />
          </span>
        </Tooltip>
      )}
    </Upload>
  );
});

export default UploadFile;
