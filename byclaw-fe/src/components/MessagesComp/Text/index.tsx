// tslint:disable:ordered-imports
import React, { useState } from 'react';
import classNames from 'classnames';
import { get, isString } from 'lodash';
import Markdown from '@/components/Markdown';
import { IMessage } from '@/typescript/message';
import { DownOutlined, UpOutlined } from '@ant-design/icons';

import styles from './index.module.less';

export type ITextObj = { text: string; orderId: number; parentOrderId: number; children?: ITextObj | string };
export type IText = string | ITextObj;

const CollapseIcon = ({
  collapsed,
  onClick,
  canCollapse,
}: {
  collapsed: boolean;
  onClick: () => void;
  canCollapse: boolean;
}) => {
  if (!canCollapse) {
    return (
      <span className={classNames(styles.collapseIcon, 'ub-ac ub-pc')}>
        <span style={{ width: '12px', height: '12px' }}></span>
      </span>
    );
  }

  return (
    <span onClick={onClick} className={classNames(styles.collapseIcon, 'ub-ac ub-pc')}>
      {collapsed ? <DownOutlined /> : <UpOutlined />}
    </span>
  );
};

export const TextItemRender = (props: {
  level: number;
  textItem: ITextObj;
  message: IMessage;
  indexStr?: string;
  isThinkingProcess?: boolean;
  markdownClass?: string;

  config?: {
    defaultCollapsed?: boolean;
    showIndexStr?: boolean;
  };
}) => {
  const { level, textItem, message, indexStr, isThinkingProcess = false, markdownClass = '', config = {} } = props;
  const { defaultCollapsed, showIndexStr } = config;

  const [collapsed, setCollapsed] = useState(!!defaultCollapsed);

  const marginLeftW = React.useMemo(() => level * 20, [level]);

  const hasChildren = Array.isArray(textItem?.children) && textItem.children.length > 0;

  const toggleCollapse = () => {
    setCollapsed(!collapsed);
  };

  return (
    <React.Fragment key={`${textItem.orderId}_${textItem.parentOrderId}`}>
      {textItem.text && (
        <div style={{ marginLeft: `${marginLeftW}px`, width: `calc(100% - ${marginLeftW})` }} className={'ub ub-as'}>
          <CollapseIcon collapsed={collapsed} onClick={toggleCollapse} canCollapse={hasChildren} />
          {showIndexStr && isThinkingProcess && (
            <span style={{ margin: '1px 8px 0 0', color: '#666', flexShrink: 0 }}>{indexStr}</span>
          )}
          <div className="ub-f1">
            <Markdown
              markdownClass={markdownClass}
              text={textItem.text}
              msg={message}
              isThinkingProcess={isThinkingProcess}
            />
          </div>
        </div>
      )}
      {hasChildren &&
        !collapsed &&
        textItem.children?.map?.((child, idx) => (
          <TextItemRender
            key={`${child.orderId}_${child.parentOrderId}`}
            level={level + 1}
            textItem={child}
            message={message}
            indexStr={`${indexStr}.${idx + 1}`}
            isThinkingProcess={isThinkingProcess}
            markdownClass={markdownClass}
            config={config}
          />
        ))}
    </React.Fragment>
  );
};

type IProps = {
  message: IMessage;
  thinkListItem?: any[];
  // eslint-disable-next-line react/no-unused-prop-types
  messageListItemContent: { substance: IText };
};

function Text(props: IProps) {
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
      {isString(text) && <Markdown text={text} msg={props.message} isThinkingProcess={isThinkingProcess} />}
      {Array.isArray(text) &&
        text.map((textItem, index) => {
          if (isString(textItem)) {
            return <Markdown key={index} text={textItem} msg={props.message} isThinkingProcess={isThinkingProcess} />;
          }

          return (
            <TextItemRender
              key={index}
              level={0}
              textItem={textItem}
              message={props.message}
              indexStr={`${index + 1}`}
              isThinkingProcess={isThinkingProcess}
              config={{ showIndexStr: showIndexStr }}
            />
          );
        })}
    </>
  );
}

export default Text;
