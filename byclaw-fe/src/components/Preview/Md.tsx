import React from 'react';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ss from './Md.module.less';

interface MdPreviewProps {
  content?: string;
  resolveImage?: MarkdownImageResolver;
}

export type MarkdownImageResolver = (src: string) => string | Blob | Promise<string | Blob>;

const isRelativeImageSource = (src: string) =>
  !src.startsWith('/') && !src.startsWith('#') && !src.startsWith('//') && !/^[a-z][a-z\d+.-]*:/i.test(src);

const MarkdownImage = React.memo(function MarkdownImage({
  resolveImage,
  src,
  ...props
}: React.ImgHTMLAttributes<HTMLImageElement> & { resolveImage?: MarkdownImageResolver }) {
  const [resolvedSrc, setResolvedSrc] = React.useState<string>();

  React.useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;

    if (!src || !resolveImage || !isRelativeImageSource(src)) {
      setResolvedSrc(src);
      return () => {
        active = false;
      };
    }

    setResolvedSrc(undefined);
    Promise.resolve(resolveImage(src))
      .then((result) => {
        if (result instanceof Blob) {
          objectUrl = URL.createObjectURL(result);
          if (active) {
            setResolvedSrc(objectUrl);
          } else {
            URL.revokeObjectURL(objectUrl);
          }
          return;
        }

        if (active) setResolvedSrc(result || src);
      })
      .catch(() => {
        if (active) setResolvedSrc(src);
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [resolveImage, src]);

  return <img {...props} src={resolvedSrc} />;
});

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

export default React.memo(function MdPreview({ content, resolveImage }: MdPreviewProps) {
  const components = React.useMemo<Components | undefined>(() => {
    if (!resolveImage) return undefined;

    return {
      img: (props) => {
        const imageProps = { ...props };
        delete imageProps.node;
        return <MarkdownImage {...imageProps} resolveImage={resolveImage} />;
      },
    };
  }, [resolveImage]);
  const urlTransform = React.useCallback(
    (url: string, key: string) => {
      if (resolveImage && key === 'src' && (/^blob:/i.test(url) || /^data:image\//i.test(url))) {
        return url;
      }
      return defaultUrlTransform(url);
    },
    [resolveImage]
  );

  return (
    <section className={ss.md}>
      <Markdown remarkPlugins={[remarkGfm, remarkSoftBreaks]} components={components} urlTransform={urlTransform}>
        {content}
      </Markdown>
    </section>
  );
});
