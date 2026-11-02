import React, { useEffect, useState } from 'react';
import DOMPurify from 'dompurify'; // HTML 净化器
import cn from 'classnames';
import { codeToHtml, BundledLanguage } from 'shiki/bundle-web.mjs';
import styles from './TextHighlight.module.less';

interface TextHighlightProps {
  lang?: BundledLanguage;

  /** 代码内容 */
  content?: string;

  /** 类名 */
  className?: string;

  /** 是否显示行号 */
  lineNumber?: boolean;
}

/**
 * 代码高亮组件 - 支持主流语言如 html/javascript/css/json/markdown/SQL 等
 * @param props
 * @returns
 */
const TextHighlight = React.memo(function TextHighlight(props: TextHighlightProps) {
  const { lang = 'markdown', content, className, lineNumber } = props;
  const [, setLoading] = useState<boolean>(false);
  const [attr, setAttr] = useState<{ dangerouslySetInnerHTML?: { __html: string } }>({});

  useEffect(() => {
    let active = true;
    setAttr({});
    if (content) {
      setLoading(true);
      codeToHtml(content, { lang, theme: 'one-light' })
        .then((code) => {
          if (active) setAttr({ dangerouslySetInnerHTML: { __html: DOMPurify.sanitize(code) } });
        })
        .catch(() => {
          if (active) setAttr({});
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }
    return () => {
      active = false;
    };
  }, [content, lang]);

  return (
    <div className={cn(styles.text, className, { [styles.lineNumber]: lineNumber })} {...attr}>
      {attr.dangerouslySetInnerHTML ? undefined : <pre>{content}</pre>}
    </div>
  );
});

export default TextHighlight;
