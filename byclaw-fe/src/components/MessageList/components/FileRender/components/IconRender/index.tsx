import classnames from 'classnames';
import React, { useMemo } from 'react';

import AntdIcon from '@/components/AntdIcon';
import { getFileIconType } from '@/constants/icon';

import styles from './index.module.less';

function IconRender(props: { fileType: string; style?: React.CSSProperties }) {
  const { fileType, style = {} } = props;
  const fileTypeIcon = useMemo(() => {
    if (!fileType) return 'icon-jishiben';

    if (['html'].includes(fileType)) {
      return 'icon-html';
    }
    if (['xls', 'xlsx', 'ods'].includes(fileType.toLowerCase())) {
      return 'icon-Excel';
    }
    if (['doc', 'docs', 'rtf', 'epub'].includes(fileType.toLowerCase())) {
      return 'icon-Word';
    }
    if (['db', 'sqlite', 'sqlite3'].includes(fileType.toLowerCase())) return 'icon-sql1';
    // 照片与文件列表共用图标识别，避免新格式仍显示成文本附件。
    if (getFileIconType(fileType) === 'Image') {
      return 'icon-Image';
    }
    if (['pdf'].includes(fileType)) {
      return 'icon-PDF';
    }
    if (['ppt', 'pptx', 'pptm'].includes(fileType)) {
      return 'icon-PPT';
    }
    if (['csv'].includes(fileType)) {
      return 'icon-CSV';
    }
    if (['mp4', 'mov', 'avi', 'wmv', 'flv', 'mkv', 'webm'].includes(fileType)) {
      return 'icon-shipin';
    }
    if (
      [
        'mp3',
        'wav',
        'aac',
        'm4a',
        'ogg',
        'flac',
        'ape',
        'm4b',
        'm4p',
        'm4r',
        'm4v',
        'm4a',
        'm4b',
        'm4p',
        'm4r',
        'm4v',
      ].includes(fileType)
    ) {
      return 'icon-yinpin';
    }

    return 'icon-jishiben';
  }, [fileType]);

  return <AntdIcon type={fileTypeIcon} className={classnames(styles.fileItemIcon)} style={style} />;
}

export default IconRender;
