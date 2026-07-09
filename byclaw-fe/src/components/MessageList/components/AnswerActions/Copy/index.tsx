import { Button, message, Tooltip } from 'antd';
import copy from 'copy-to-clipboard';
import DOMPurify from 'dompurify';
// tslint:disable:ordered-imports
import React, { useCallback, useState } from 'react';
import { useIntl } from '@umijs/max';

import { debounce } from 'lodash';

import AntdIcon from '@/components/AntdIcon';
import btnStyles from '@/components/MessageList/index.module.less';
import useQryResourceList from '@/components/QueryInput/components/ResourceQuestion/useQryResourceList';
import showdownKatex from '@/components/Markdown/katex/showdown-katex';
import { fixUnclosedCodeBlock, replaceFilePrefixInMarkdown, replaceMdString } from '@/components/Markdown/utils';
import { getFileUrl } from '@/utils/file';

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

const markdownToClipboardHtml = (value?: string) => {
  if (!value) return '';
  const textWithReplacedUrl = replaceFilePrefixInMarkdown(value, (filePath, regExp) => {
    const fullPath = `/commonFile/preview?filePath=${filePath.replace(regExp, '')}`;
    return getFileUrl(fullPath);
  });
  const html = markdownConverter.makeHtml(fixUnclosedCodeBlock(replaceMdString(textWithReplacedUrl)));
  const sanitizedHtml = DOMPurify.sanitize(targetBlankExtension(html), {
    FORBID_TAGS: ['style', 'script'],
    ADD_ATTR: ['target', 'rel', 'data-md5-src', 'data-image-src'],
  });
  return `<div>${sanitizedHtml}</div>`;
};

const htmlToPlainText = (html: string, fallback: string) => {
  if (!html || typeof document === 'undefined') return fallback;
  const container = document.createElement('div');
  container.innerHTML = html;
  return (container.innerText || container.textContent || fallback).trim();
};

const copyRichContent = ({
  text,
  richText,
  resourceList,
  onCopied,
}: {
  text: string;
  richText?: string;
  resourceList?: unknown[];
  onCopied: () => void;
}) => {
  const html = markdownToClipboardHtml(text);
  const plainText = htmlToPlainText(html, text) || text;

  copy(plainText, {
    onCopy: (clipboardData) => {
      const clipboard = clipboardData as DataTransfer;
      if (html) {
        clipboard.setData('text/html', html);
      }
      if (richText && resourceList?.length) {
        clipboard.setData(
          'application/x-byai-slate',
          window.btoa(
            encodeURIComponent(
              JSON.stringify({
                text: richText,
                resourceList,
              })
            )
          )
        );
      }
      clipboard.setData('text/plain', plainText);
      onCopied();
    },
  });
};

function Copy({ text, richText, showText = false }: { text?: string; richText?: string; showText?: boolean }) {
  const intl = useIntl();
  const [loading, setLoading] = useState(false);
  const qryResourceList = useQryResourceList();

  const showToast = useCallback(() => {
    message.destroy();
    message.success(intl.formatMessage({ id: 'common.copySuccess' }));
  }, [intl]);

  const handleCopy = useCallback(
    debounce(() => {
      if (!text) return;
      if (richText && /\{\{.+\}\}/g.test(richText)) {
        setLoading(true);
        qryResourceList(richText, true)
          .then((resourceList) => {
            if (!resourceList || !resourceList.length) {
              copyRichContent({ text, onCopied: showToast });
              return;
            }
            copyRichContent({ text, richText, resourceList, onCopied: showToast });
          })
          .finally(() => {
            setLoading(false);
          });
      } else {
        copyRichContent({ text, onCopied: showToast });
      }
    }, 300),
    [text, richText, qryResourceList, showToast]
  );

  if (!text && !richText) return null;

  const title = intl.formatMessage({ id: 'messageList.copyMessage' });

  return (
    <Tooltip title={title}>
      <Button
        type="text"
        size="small"
        loading={loading}
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
