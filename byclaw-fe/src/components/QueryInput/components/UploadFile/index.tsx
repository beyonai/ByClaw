import React, { forwardRef, useImperativeHandle } from 'react';

import { Upload, UploadProps, App } from 'antd';
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
  const { extendsPayload = {}, onCreate, onUpdate, onRemove, setSessionId, disabled = false, accept } = props;
  const { message } = App.useApp();
  const intl = useIntl();
  const getNanoid = React.useRef<(size?: number) => string>(customAlphabet('abcdefghijklmnopqrstuvwxyz1234567890', 10));

  const onUpload = async (file: File) => {
    if (!validateAccept(file, accept)) {
      message.error(`${intl.formatMessage({ id: 'common.supportedFileTypes' })}${accept}`);
      return;
    }
    const blobUrl = URL.createObjectURL(file as File);
    const payload: any = {
      uid: getNanoid.current(),
      file,
      downloadUrl: blobUrl,
      status: 'uploading',
      fileType: 'file',
    };

    const formData = new FormData();
    formData.append('files', file);
    Object.keys(extendsPayload || {}).forEach((keyName) => {
      formData.append(keyName, `${extendsPayload[keyName] || ''}`);
    });

    const canUpload = onCreate({ ...payload });
    if (!canUpload) return;

    try {
      const data: {
        sessionId?: string;
        sessionDatasetid?: string;
        rebuildFileList?: IQueryFile[];
        uploadItems?: Partial<IQueryFile>[];
      } = await uploadFiles(formData);

      const { rebuildFileList = [], uploadItems = [], sessionId } = data || {};
      const uploadedFileList = !isEmpty(rebuildFileList) ? rebuildFileList : uploadItems;

      if (sessionId && setSessionId) {
        setSessionId(sessionId, file);
      }

      if (!isEmpty(uploadedFileList)) {
        onUpdate({
          ...payload,
          queryFile: head(uploadedFileList),
          status: 'done',
        });
      }
    } catch (e: any) {
      // message.error(e.toString());
      onRemove({ ...payload });
    }
  };

  useImperativeHandle(ref, () => ({
    uploadFile: (file: File) => {
      if (!validateAccept(file, accept)) {
        return;
      }
      onUpload(file);
    },
  }));

  return (
    <Upload
      disabled={disabled}
      multiple={false}
      accept={accept}
      className={props.className}
      listType={props.listType}
      // accept=".doc,.docx,.xls,.xlsx,.ppt,.pdf,.txt"
      showUploadList={false}
      customRequest={async (options) => {
        const { file } = options;
        onUpload(file as File);
      }}
    >
      {children || <AntdIcon type="icon-shouye-icon-wrapper" className={classnames(styles.attachment, { disabled })} />}
    </Upload>
  );
});

export default UploadFile;
