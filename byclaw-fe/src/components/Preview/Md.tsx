import React from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ss from './Md.module.less';

interface MdPreviewProps {
  content?: string;
}

export default function MdPreview({ content }: MdPreviewProps) {
  return (
    <section className={ss.md}>
      <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
    </section>
  );
}
