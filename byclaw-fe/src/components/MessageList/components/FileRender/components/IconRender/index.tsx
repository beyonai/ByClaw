import classnames from 'classnames';
import React, { useMemo } from 'react';

import AntdIcon from '@/components/AntdIcon';

import styles from './index.module.less';

function IconRender(props: { fileType: string; style?: React.CSSProperties }) {
  const { fileType, style = {} } = props;
  const fileTypeIcon = useMemo(() => {
    if (!fileType) return 'icon-jishiben';

    if (['xls', 'xlsx'].includes(fileType)) {
      return 'icon-Excel';
    }
    if (['doc', 'docs'].includes(fileType)) {
      return 'icon-Word';
    }
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff', 'ico', 'svg'].includes(fileType)) {
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
