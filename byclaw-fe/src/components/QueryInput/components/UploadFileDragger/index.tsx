import React, { forwardRef, useImperativeHandle } from 'react';

// @ts-ignore
import { useIntl } from '@umijs/max';
import { Upload, message, theme } from 'antd';
import { head, isEmpty } from 'lodash';
import { customAlphabet } from 'nanoid';

import AntdIcon from '@/components/AntdIcon';
import { uploadFiles } from '@/service/file';
import type { IFile } from '@/typescript/file';
import { validateAccept } from '@/utils/file';

import styles from './index.module.less';
import { UploadFileRef } from '../UploadFile';

const { Dragger } = Upload;

type IProps = {
  extendsPayload?: Record<string, string | number | undefined>;
  onCreate: (fileItem: IFile) => boolean;
  onUpdate: (fileItem: IFile) => void;
  onRemove: (fileItem: IFile) => void;
  setSessionId: (sessionId: string, file: any) => void;

  disabled?: boolean;
  accept?: string;
};

export default forwardRef<UploadFileRef, IProps>((props, ref) => {
  const { extendsPayload = {}, onCreate, onUpdate, onRemove, setSessionId, disabled = false, accept } = props;

  const intl = useIntl();
  const { token } = theme.useToken();

  const getNanoid = React.useRef<(size?: number) => string>(customAlphabet('abcdefghijklmnopqrstuvwxyz1234567890', 10));

  const onUpload = async (file: File) => {
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
    Object.keys(extendsPayload).forEach((keyName) => {
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

      if (!data) {
        onRemove({ ...payload });
        return;
      }

      const { rebuildFileList = [], uploadItems = [], sessionId } = data || {};
      const uploadedFileList = !isEmpty(rebuildFileList) ? rebuildFileList : uploadItems;

      if (sessionId) {
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
      message.error(e.toString());
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
    <Dragger
      disabled={disabled}
      className={styles.draggerWrap}
      accept={accept}
      multiple={false}
      showUploadList={false}
      customRequest={async (options) => {
        const { file } = options;
        onUpload(file as File);
      }}
    >
      <AntdIcon
        type="icon-a-File-addition-onewenjiantianjia1"
        style={{
          fontSize: 24,
          color: token.colorTextTertiary,
          marginBottom: 4,
        }}
      />
      <p style={{ color: token.colorTextTertiary, fontSize: 12 }}>
        {intl.formatMessage({ id: 'chatBI.dragFileHere' })}
      </p>
    </Dragger>
  );
});
