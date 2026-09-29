import { Button, message, Tooltip } from 'antd';
import copy from 'copy-to-clipboard';
import DOMPurify from 'dompurify';
// tslint:disable:ordered-imports
import React, { useCallback } from 'react';
import { useIntl } from '@umijs/max';

import { debounce } from 'lodash';

import AntdIcon from '@/components/AntdIcon';
import btnStyles from '@/components/MessageList/index.module.less';
import showdownKatex from '@/components/Markdown/katex/showdown-katex';
import { fixUnclosedCodeBlock, replaceFilePrefixInMarkdown, replaceMdString } from '@/components/Markdown/utils';
import { getFileUrl } from '@/utils/file';
import { getQuestionCopyText } from './utils';

const showdown = require('@/components/Markdown/showdown');

const markdownConverter = new showdown.Converter({
  noHeaderId: true,
  simpleLineBreaks: true,
  smoothLivePreview: true,
  tables: true,
  tablesHeaderId: true,
  emoji: true,
  tasklists: true,
  strikethrough: true,
  backslashEscapesHTMLTags: false,
  completeHTMLDocument: false,
  extensions: [
    ...showdownKatex({
      throwOnError: false,
      displayMode: false,
      errorColor: '#1500ff',
    }),
  ],
  underline: true,
});

const targetBlankExtension = (html: string) =>
  html.replace(/<a href=/g, '<a rel="noopener noreferrer" target="_blank" href=');

const styleClipboardTables = (html: string) => {
  if (!html || typeof document === 'undefined') return html;
  const container = document.createElement('div');
  container.innerHTML = html;

  container.querySelectorAll('table').forEach((table) => {
    table.setAttribute('border', '1');
    table.setAttribute('cellspacing', '0');
    table.setAttribute('cellpadding', '6');
    table.setAttribute(
      'style',
      [
        'border-collapse:collapse',
        'border-spacing:0',
        'width:100%',
        'margin:8px 0',
        'font-size:14px',
        'line-height:1.6',
      ].join(';')
    );
  });

  container.querySelectorAll('th').forEach((cell) => {
    cell.setAttribute(
      'style',
      [
        'border:1px solid #d9e5f6',
        'padding:8px 12px',
        'background:#f4f7ff',
        'font-weight:600',
        'text-align:left',
        'vertical-align:middle',
        'white-space:nowrap',
        'word-break:keep-all',
        'min-width:72px',
      ].join(';')
    );
  });

  container.querySelectorAll('td').forEach((cell) => {
    cell.setAttribute('style', ['border:1px solid #d9e5f6', 'padding:8px 12px', 'vertical-align:middle'].join(';'));
  });

  container.querySelectorAll('tr').forEach((row) => {
    const firstCell = row.querySelector('th,td');
    if (!firstCell) return;
    firstCell.setAttribute(
      'style',
      [firstCell.getAttribute('style') || '', 'white-space:nowrap', 'word-break:keep-all', 'min-width:72px']
        .filter(Boolean)
        .join(';')
    );
  });

  return container.innerHTML;
};

const markdownToClipboardHtml = (value?: string) => {
  if (!value) return '';
  const textWithReplacedUrl = replaceFilePrefixInMarkdown(value, (filePath, regExp) => {
    const fullPath = `/commonFile/preview?filePath=${filePath.replace(regExp, '')}`;
    return getFileUrl(fullPath);
  });
  const html = markdownConverter.makeHtml(fixUnclosedCodeBlock(replaceMdString(textWithReplacedUrl)));
  const clipboardHtml = styleClipboardTables(targetBlankExtension(html));
  const sanitizedHtml = DOMPurify.sanitize(clipboardHtml, {
    FORBID_TAGS: ['style', 'script'],
    ADD_ATTR: ['target', 'rel', 'style', 'border', 'cellspacing', 'cellpadding', 'data-md5-src', 'data-image-src'],
  });
  return `<div>${sanitizedHtml}</div>`;
};

const htmlToPlainText = (html: string, fallback: string) => {
  if (!html || typeof document === 'undefined') return fallback;
  const container = document.createElement('div');
  container.innerHTML = html;
  return (container.innerText || container.textContent || fallback).trim();
};

const copyRichContent = ({ text, onCopied }: { text: string; onCopied: () => void }) => {
  const html = markdownToClipboardHtml(text);
  const plainText = htmlToPlainText(html, text) || text;

  copy(plainText, {
    onCopy: (clipboardData) => {
      const clipboard = clipboardData as DataTransfer;
      if (html) {
        clipboard.setData('text/html', html);
      }
      clipboard.setData('text/plain', plainText);
      onCopied();
    },
  });
};

function Copy({ text, richText, showText = false }: { text?: string; richText?: string; showText?: boolean }) {
  const intl = useIntl();

  const showToast = useCallback(() => {
    message.destroy();
    message.success(intl.formatMessage({ id: 'common.copySuccess' }));
  }, [intl]);

  const handleCopy = useCallback(
    debounce(() => {
      if (richText !== undefined) {
        // 用户消息只复制正文，避免粘贴时重新带入 @ 员工、资源引用或富文本节点。
        const plainText = getQuestionCopyText(richText);
        if (plainText && copy(plainText, { format: 'text/plain' })) {
          showToast();
        }
        return;
      }
      if (text) {
        copyRichContent({ text, onCopied: showToast });
      }
    }, 300),
    [text, richText, showToast]
  );

  if (richText !== undefined ? !getQuestionCopyText(richText) : !text) return null;

  const title = intl.formatMessage({ id: 'messageList.copyMessage' });

  return (
    <Tooltip title={title}>
      <Button
        type="text"
        size="small"
        icon={<AntdIcon type="icon-a-Copyfuzhi" className={btnStyles.copyIcon} />}
        onClick={handleCopy}
      >
        {showText ? (
          <span className={btnStyles.actionsBarText}>{intl.formatMessage({ id: 'common.copy' })}</span>
        ) : null}
      </Button>
    </Tooltip>
  );
}

export default Copy;
