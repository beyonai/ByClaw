// tslint:disable:ordered-imports
import React from 'react';
import { get, isString } from 'lodash';
import Markdown from '@/components/Markdown';
import { IText, TextItemRender } from '@/components/MessagesComp/Text';
import { IMessage } from '@/typescript/message';

import styles from './index.module.less';

type IProps = {
  message: IMessage;
  // eslint-disable-next-line react/no-unused-prop-types
  messageListItemContent: { substance: IText };
  thinkListItem?: any[];
};

function ThinkingProcess(props: IProps) {
  const text = get(props, 'messageListItemContent.substance', '');
  const isThinkingProcess = !!props.thinkListItem;

  const showIndexStr = React.useMemo(() => {
    if (!Array.isArray(text)) return false;

    let count = 0;
    for (const n of text) {
      if (!isString(n) && ++count >= 2) break;
    }
    return count >= 2;
  }, [text]);

  if (!text) return null;

  return (
    <>
      {isString(text) && <Markdown markdownClass={styles.mdWrap} text={text} msg={props.message} isThinkingProcess={isThinkingProcess} /> }
      {Array.isArray(text) && (
        text.map((textItem, index) => {
          if (isString(textItem)) {
            return (
              <Markdown markdownClass={styles.mdWrap} key={index} text={textItem} msg={props.message} isThinkingProcess={isThinkingProcess} />
            );
          }

          return (
            <TextItemRender
              key={index}
              level={0}
              textItem={textItem}
              message={props.message}
              indexStr={showIndexStr ? `${index + 1}` : undefined}
              isThinkingProcess={isThinkingProcess}
              markdownClass={styles.mdWrap}
              config={{ showIndexStr: showIndexStr, defaultCollapsed: true }}
            />
          );
        })
      )}
    </>
  );
}

export default ThinkingProcess;
