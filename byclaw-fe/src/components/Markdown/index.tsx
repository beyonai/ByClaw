// tslint:disable:ordered-imports
import React, { useMemo, useRef } from 'react';
import DOMPurify from 'dompurify'; // HTML 净化器
import showdownKatex from './katex/showdown-katex';
import 'katex/dist/katex.min.css';
import useActions from './hooks/useActions';
import { replaceMdString, fixUnclosedCodeBlock, isJsonString, replaceFilePrefixInMarkdown } from './utils';
import JsonRenderer from './jsonRenderer';
import styles from './index.module.less';
import { IMessageState } from '@/constants/message';
// import { isEmpty } from 'lodash';
import parse from 'html-react-parser';
import useGlobal from '@/hooks/useGlobal';
import { LayoutMode } from '@/constants/system';
import { IMessage } from '@/typescript/message';

// import createImageCollectorExtension, { addImageCollectedIds } from './imageExtension';
import createTableExtension from './tableExtension';
import { getFileUrl } from '@/utils/file';

// @ts-ignore
const showdown = require('./showdown');

// 自定义图片组件，用React.memo包装，避免不必要的重新渲染
const ImgComponent = React.memo(({ src, alt }: { src: string; alt: string }) => {
  return <img src={src} alt={alt} />;
});

const targetBlankExtension = {
  type: 'html',
  filter(text: string) {
    // 一次性添加target和rel属性
    return text.replace(/<a href=/g, '<a rel="noopener noreferrer" target="_blank" href=');
  },
};

const emptyArr: any[] = [];

const MarkdownRender = React.memo(
  ({
    markdownClass,
    text,
    wrap,
    myExtensions = emptyArr,
  }: {
    markdownClass?: string;
    text: string;
    wrap: React.RefObject<HTMLDivElement | null>;
    myExtensions?: Array<{
      type: string;
      filter: (inputText: string) => string;
    }>;
  }) => {
    const showndownConverterRef = useRef<any>(
      new showdown.Converter({
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
          {
            type: 'html',
            filter(html: string) {
              return DOMPurify.sanitize(html, {
                FORBID_TAGS: ['style', 'script'],
                ADD_ATTR: ['target', 'rel', 'data-md5-src', 'data-image-src'], // 在默认白名单基础上添加 target 和 rel
              });
            },
          },
          ...showdownKatex({
            throwOnError: false,
            displayMode: false,
            errorColor: '#1500ff',
          }),
          targetBlankExtension,
          ...myExtensions,
        ],
        underline: true,
      })
    );

    // 生成新的HTML内容
    const desc = useMemo(() => {
      const textWithReplacedUrl = replaceFilePrefixInMarkdown(text, (filePath, regExp) => {
        const fullPath = `/commonFile/preview?filePath=${filePath.replace(regExp, '')}`;
        return getFileUrl(fullPath);
      });
      const htmlContent = showndownConverterRef.current?.makeHtml(
        fixUnclosedCodeBlock(replaceMdString(textWithReplacedUrl))
      );

      return htmlContent;
    }, [text]);

    const parsedComponents = useMemo(() => {
      const options = {
        replace: (domNode: any) => {
          if (domNode.name === 'img') {
            const { src, alt } = domNode.attribs;
            // 使用src作为key，确保相同src的图片不会重新渲染
            return <ImgComponent key={src} src={src} alt={alt} />;
          }

          return domNode;
        },
      };
      return parse(desc, options);
    }, [desc]);

    return (
      <div
        className={`${styles.newmdWrap} ${markdownClass}`}
        ref={(node) => {
          if (wrap) {
            wrap.current = node;
          }
        }}
      >
        {parsedComponents}
      </div>
    );
  }
);

function TextComp({
  text = '',
  markdownClass = '',
  isThinkingProcess,
  msg,
  defaultExpandJson,
}: {
  text?: string;
  markdownClass?: string;
  isThinkingProcess?: boolean;
  msg?: IMessage;
  defaultExpandJson?: boolean;
}) {
  const { messageState, msgId, messageId, thinkDone, fromBeyond = true } = msg || {};

  const { layoutMode } = useGlobal();

  const wrap = React.useRef<HTMLDivElement | null>(null);

  const isPreviewMode = layoutMode === LayoutMode.preview;
  const isMessageDone = messageState === IMessageState.Done || (isThinkingProcess && thinkDone);

  // useMemo(() => {
  //   if (collectIds && !isEmpty(collectIds)) {
  //     addImageCollectedIds(collectIds);
  //   }
  // }, [collectIds]);

  useActions({
    wrap,
    msgId,
    messageId,
    isThinkingProcess,
    isMessageDone,
  });

  const myText = useMemo<string>(() => text, [text]);

  // 检测是否为JSON字符串
  const jsonCheck = useMemo(() => isJsonString(myText), [myText]);

  const hideButtonList = React.useMemo(() => {
    if (isPreviewMode) {
      return ['star', 'download'];
    }
    return [];
  }, [isPreviewMode]);

  const myExtensions = useMemo(() => {
    if (!fromBeyond) return [];

    return [
      createTableExtension(),
      // createImageCollectorExtension({
      //   wrap,
      //   hideButtonList,
      // }),
    ];
  }, [wrap, hideButtonList, fromBeyond]);

  return (
    <div className={styles.desc}>
      {/* 我发送的 —— 没有回应 / 报错的消息 */}
      {jsonCheck.isJson ? (
        <div className={styles.jsonContainer}>
          <JsonRenderer data={jsonCheck.data} defaultExpanded={defaultExpandJson} />
        </div>
      ) : (
        <MarkdownRender text={myText} wrap={wrap} markdownClass={markdownClass} myExtensions={myExtensions} />
      )}
    </div>
  );
}

export default React.memo(TextComp);

// https://showdownjs.com/docs/available-options
