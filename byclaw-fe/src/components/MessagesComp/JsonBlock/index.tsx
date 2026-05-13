import React from 'react';
import { get } from 'lodash';
import JsonRenderer from '@/components/Markdown/jsonRenderer';
import styles from './style.less';

type IProps = {
  messageListItemContent: {
    substance: {
      json: string;
      title?: string;
    };
  };
};

export default function JsonBlock(props: IProps) {
  const substance = get(props, 'messageListItemContent.substance', {
    json: '',
    title: '',
  });

  const { json, title } = substance;

  const data = React.useMemo(() => {
    try {
      return JSON.parse(json);
    } catch (error) {
      return {
        formattedError: true,
        data: json,
      };
    }
  }, [json]);

  return (
    <div className={styles.wrap}>
      {title && <header className={styles.header}>{title}</header>}
      <JsonRenderer defaultExpanded data={data} className={styles.json} />
    </div>
  );
}
