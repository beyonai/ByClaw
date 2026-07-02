import React from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ss from './Md.module.less';

interface MdPreviewProps {
  content?: string;
}

function remarkSoftBreaks() {
  return (tree: any) => {
    const visit = (node: any) => {
      if (!node?.children) return;

      node.children = node.children.flatMap((child: any) => {
        if (child?.type !== 'text' || typeof child.value !== 'string' || !child.value.includes('\n')) {
          visit(child);
          return [child];
        }

        return child.value.split('\n').flatMap((value: string, index: number, list: string[]) => {
          const nodes: any[] = value ? [{ ...child, value }] : [];
          if (index < list.length - 1) {
            nodes.push({ type: 'break' });
          }
          return nodes;
        });
      });
    };

    visit(tree);
  };
}

export default React.memo(function MdPreview({ content }: MdPreviewProps) {
  return (
    <section className={ss.md}>
      <Markdown remarkPlugins={[remarkGfm, remarkSoftBreaks]}>{content}</Markdown>
    </section>
  );
});
