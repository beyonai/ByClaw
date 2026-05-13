import { getPublicPath } from '@/utils';
import { getAgentAvatarUrl, getDefaultAgentAvatar } from '@/utils/agent';
import { fileToBase64 } from '@/utils/file';
import { DeleteOutlined } from '@ant-design/icons';
import { Upload } from 'antd';
import type { UploadProps } from 'antd/es/upload/interface';
import { UploadFile } from 'antd/es/upload/interface';
import classnames from 'classnames';
import React, { useEffect, useState } from 'react';
import styles from './index.module.less';

type InnerProps = {
  value?: any;
  onChange?: (v: any) => void;
  uploadProps?: Partial<UploadProps>;
  beforeUploadChange?: (v: any) => void;
  defaultImage?: string | File;
  contentBoxClassName?: string;
};

const PagePhoto = (props: InnerProps) => {
  const { value, beforeUploadChange, onChange, uploadProps, defaultImage, contentBoxClassName } = props;

  const defResourceIcon = `${getPublicPath()}${getDefaultAgentAvatar()}`;

  const [imageUrl, setImageUrl] = useState<any>();

  const beforeUpload = (file: File) => {
    if (beforeUploadChange) {
      beforeUploadChange([file]);
    }
    return false;
  };

  const handleChange = async ({ file }: { file: UploadFile }) => {
    if (onChange) {
      onChange(file);
    }
  };

  const setImageData = async (file: File | string) => {
    let imageUrl: string;

    if (typeof file === 'string') {
      imageUrl = file;
    } else {
      imageUrl = await fileToBase64(file);
    }

    setImageUrl(imageUrl);
  };

  const clearImage = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setImageUrl(null);
    if (onChange) {
      onChange(undefined);
    }
  };

  useEffect(() => {
    if (value) {
      setImageData(value);
    }
  }, [value]);

  const { className, ...restUploadProps } = uploadProps || {};

  return (
    <Upload
      name="pagePhoto"
      onChange={handleChange}
      fileList={value ? [value] : []}
      beforeUpload={beforeUpload}
      maxCount={1}
      listType="picture-card"
      accept=".jpg,.jpeg,.png"
      showUploadList={false}
      className={classnames(styles.pagephotoBox, className)}
      {...restUploadProps}
    >
      <div className={classnames(styles.contentBox, contentBoxClassName)}>
        <img
          src={getAgentAvatarUrl(imageUrl || defaultImage || defResourceIcon)}
          className={styles.coverImage}
          alt="logo"
          onError={() => {
            setImageUrl(defResourceIcon);
          }}
        />
        {imageUrl && !uploadProps?.disabled && (
          <div className={styles.contentBg}>
            <DeleteOutlined onClick={clearImage} />
          </div>
        )}
      </div>
    </Upload>
  );
};

export default PagePhoto;
