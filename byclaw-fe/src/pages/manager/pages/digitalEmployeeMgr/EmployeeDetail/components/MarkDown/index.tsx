// @ts-nocheck
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ss from './styles.module.less';

interface MarkDownProps {
  content: string;
}

export default function MarkDown({ content }: MarkDownProps) {
  return (
    <div className={ss.markdown}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
