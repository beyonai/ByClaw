import React, { useCallback, useEffect, useRef, useState } from 'react';
import cn from 'classnames';
import { FullscreenExitOutlined } from '@ant-design/icons';
import DOMPurify from 'dompurify';
import { codeToHtml } from 'shiki';
import styles from './index.module.less';

interface JsonCodeEditorProps {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  rows?: number;
  readOnly?: boolean;
  maximized?: boolean;
  onExitMaximize?: () => void;
  className?: string;
}

const JsonCodeEditor: React.FC<JsonCodeEditorProps> = ({
  value = '',
  onChange,
  placeholder,
  rows = 10,
  readOnly = false,
  maximized = false,
  onExitMaximize,
  className,
}) => {
  const [highlightHtml, setHighlightHtml] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!value) {
      setHighlightHtml('');
      return;
    }
    let cancelled = false;
    codeToHtml(value, { lang: 'json', theme: 'material-theme-lighter' }).then((html) => {
      if (!cancelled) {
        setHighlightHtml(DOMPurify.sanitize(html));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [value]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange?.(e.target.value);
    },
    [onChange]
  );

  const handleScroll = useCallback(() => {
    if (textareaRef.current && preRef.current) {
      preRef.current.scrollTop = textareaRef.current.scrollTop;
      preRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  }, []);

  const lineHeight = 20;
  const minHeight = rows * lineHeight + 16;

  return (
    <div className={cn(styles.jsonCodeEditor, { [styles.maximized]: maximized }, className)} style={{ minHeight }}>
      {maximized && onExitMaximize && (
        <div className={styles.maximizedToolbar}>
          <FullscreenExitOutlined className={styles.exitBtn} onClick={onExitMaximize} />
        </div>
      )}
      <div
        ref={preRef}
        className={styles.highlight}
        dangerouslySetInnerHTML={highlightHtml ? { __html: highlightHtml } : undefined}
      />
      {!value && placeholder && <span className={styles.placeholder}>{placeholder}</span>}
      <textarea
        ref={textareaRef}
        className={styles.textarea}
        value={value}
        onChange={handleChange}
        onScroll={handleScroll}
        readOnly={readOnly}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
      />
    </div>
  );
};

export default JsonCodeEditor;
