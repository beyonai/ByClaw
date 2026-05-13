import React from 'react';
import DOMPurify from 'dompurify'; // HTML 净化器
import showdownKatex from './katex/showdown-katex';
import showdown from './showdown';
import { replaceMdString } from './utils';

interface Props {
  text: string;
  className?: string;
  style?: React.CSSProperties;
}

export default function Text({ text, className, style }: Props) {
  const html = React.useMemo(() => {
    if (text && typeof text === 'string') {
      const htmlContent = new showdown.Converter({
        headerLevelStart: 3,
        extensions: showdownKatex({
          throwOnError: false,
          displayMode: false,
          errorColor: '#1500ff',
        }),
      }).makeHtml(replaceMdString(text));

      return DOMPurify.sanitize(htmlContent);
    }
    return '';
  }, [text]);

  if (!text) return null;

  return (
    <div className={className} style={style}>
      <div {...{ dangerouslySetInnerHTML: { __html: html } }} />
    </div>
  );
}
