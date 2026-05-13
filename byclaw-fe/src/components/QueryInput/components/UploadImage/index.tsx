import React from 'react';

import { message, Upload } from 'antd';
import classnames from 'classnames';
import { head, isEmpty } from 'lodash';
import { customAlphabet } from 'nanoid';

import AntdIcon from '@/components/AntdIcon';
import styles from '@/components/QueryInput/Chat/index.module.less';
import { uploadFiles } from '@/service/file';
import { IFile, IQueryFile } from '@/typescript/file';

type IProps = {
  extendsPayload?: Record<string, string | number | undefined>;
  onCreate: (fileItem: IFile) => void;
  onUpdate: (fileItem: IFile) => void;
  onRemove: (fileItem: IFile) => void;
  setSessionId: (sessionId: string, file: any) => void;
  disabled?: boolean;
};

function UploadFile(props: IProps) {
  const { extendsPayload = {}, onCreate, onUpdate, onRemove, setSessionId, disabled = false } = props;

  const getNanoid = React.useRef<(size?: number) => string>(customAlphabet('abcdefghijklmnopqrstuvwxyz1234567890', 10));

  return (
    <Upload
      disabled={disabled}
      multiple={false}
      accept=".png,.jpg,.jpeg"
      showUploadList={false}
      customRequest={async (options) => {
        const { file } = options;
        const blobUrl = URL.createObjectURL(file as File);

        const payload: any = {
          uid: getNanoid.current(),
          file,
          downloadUrl: blobUrl,
          imgUrl: blobUrl,
          status: 'uploading',
          fileType: 'image',
        };

        const formData = new FormData();
        formData.append('files', file);
        Object.keys(extendsPayload).forEach((keyName) => {
          formData.append(keyName, `${extendsPayload[keyName] || ''}`);
        });

        onCreate({ ...payload });

        try {
          const data: {
            sessionId?: string;
            sessionDatasetid?: string;
            rebuildFileList?: IQueryFile[];
            uploadItems?: Partial<IQueryFile>[];
          } = await uploadFiles(formData);

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
      }}
    >
      <AntdIcon type="icon-shouye-icon-wrapper1" className={classnames(styles.attachment, { disabled })} />
    </Upload>
  );
}

export default UploadFile;
