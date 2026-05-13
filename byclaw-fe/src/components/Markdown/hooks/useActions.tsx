/* eslint-disable @typescript-eslint/no-unused-vars */
import React, { useCallback, useEffect, useRef, useState, createContext, useContext } from 'react';
import useGlobal from '@/hooks/useGlobal';
import copy from 'copy-to-clipboard';
import md5 from 'md5';
import { useIntl } from '@umijs/max';
import { App, Button, Segmented, Spin, Tabs } from 'antd';
import { createRoot, Root } from 'react-dom/client';
import { collectCase, cancelCollectCase } from '@/service/message';
import { PlayCircleOutlined, CodeOutlined } from '@ant-design/icons';
import IframeRender from '@/components/MessagesComp/Iframe/IframeRender';
import AntdIcon from '@/components/AntdIcon';
import { downloadFile } from '@/utils/file';
import { LayoutMode } from '@/constants/system';
import { unescapeHTML } from '../utils';
import { EventEmitter$Cls } from '@/utils/eventEmitter';

import { toggleImageCollected, loadingStarHtml } from '../imageExtension';

import styles from '../index.module.less';
import myStyles from './styles.module.less';
import classNames from 'classnames';

// Header 组件
interface HeaderProps {
  className: string;
  onCopy: () => void;
  onShare: () => void;
  hasHtml: boolean;
  shareLoading: boolean;
  showShare: boolean;
  isMessageDone: boolean;
}

type RootRenderContextValue = {
  showType: 'run' | 'markdown';
  setShowType: React.Dispatch<React.SetStateAction<'markdown' | 'run'>>;
  EventEmitter: EventEmitter$Cls<any>;
};

const RootRenderContext = createContext<RootRenderContextValue>({
  showType: 'markdown',
  setShowType: () => {},
  EventEmitter: new EventEmitter$Cls<any>(),
});

const CodeHeader: React.FC<HeaderProps> = (props) => {
  const { className, hasHtml, shareLoading, isMessageDone, showShare } = props;
  const { onCopy, onShare } = props;

  const { showType, setShowType } = useContext(RootRenderContext);

  return (
    <div className={styles.header}>
      <div style={{ fontWeight: '500' }}>{(className || 'HTML').split(' ')[0]}</div>
      {isMessageDone && (
        <div className="ub ub-ac gap4" style={{ marginLeft: 'auto' }}>
          {hasHtml && (
            <Segmented
              // size="small"
              shape="round"
              options={[
                {
                  value: 'markdown',
                  label: (
                    <div>
                      <CodeOutlined style={{ fontSize: 16 }} />
                    </div>
                  ),
                },
                {
                  value: 'run',
                  label: (
                    <div>
                      <PlayCircleOutlined style={{ fontSize: 16 }} />
                    </div>
                  ),
                },
              ]}
              value={showType}
              onChange={(value) => {
                setShowType(value as 'run' | 'markdown');
              }}
            />
          )}
          <Button ghost type="text" icon={<AntdIcon type="icon-a-Copyfuzhi" />} onClick={onCopy} />
          {showShare && (
            <Button
              ghost
              type="text"
              icon={<AntdIcon type="icon-a-Share-twofenxiang2" />}
              onClick={onShare}
              loading={shareLoading}
            />
          )}
        </div>
      )}
    </div>
  );
};

const HtmlRunner = React.memo((props: { iframeUrl: string; isMessageDone: boolean }) => {
  const { iframeUrl, isMessageDone } = props;
  const { EventEmitter } = useContext(RootRenderContext);

  const onMessage = React.useCallback((data: { type: string; data: any }) => {
    EventEmitter.emit(data.type, data.data);
  }, []);

  return (
    <div className={classNames(styles.htmlRunnerWrapper, 'full-width')} key={iframeUrl}>
      {isMessageDone && (
        <div className="full-height full-width ub ub-ac ub-pc">
          <IframeRender key={iframeUrl} url={iframeUrl} onMessage={onMessage} />
        </div>
      )}
      {!isMessageDone && <Spin />}
    </div>
  );
});

const InnerHTMLWrapper = React.memo((props: { htmlStr: string }) => {
  const { htmlStr } = props;
  return (
    <code className={styles.innerHTMLWrapper} key={htmlStr}>
      {htmlStr}
    </code>
  );
});

const CodeTabs = React.memo((props: { getHTMLURL: () => string; isMessageDone: boolean; getHTMLStr: () => string }) => {
  const { getHTMLURL, isMessageDone, getHTMLStr } = props;

  const { showType, setShowType } = useContext(RootRenderContext);

  return (
    <Tabs
      className={styles.tabs}
      key="HTMLTabs"
      activeKey={showType}
      onChange={(key) => setShowType(key as 'run' | 'markdown')}
      tabBarStyle={{ display: 'none' }}
    >
      <Tabs.TabPane key="markdown">
        <InnerHTMLWrapper htmlStr={getHTMLStr()} />
      </Tabs.TabPane>
      <Tabs.TabPane key="run">
        <HtmlRunner iframeUrl={getHTMLURL()} isMessageDone={!!isMessageDone} />
      </Tabs.TabPane>
    </Tabs>
  );
});

const RootRender = (props: {
  children: React.ReactNode;
  hasHtml: boolean;
  isMessageDone: boolean;
  EventEmitter: EventEmitter$Cls<any>;
}) => {
  const { children, hasHtml, isMessageDone, EventEmitter } = props;

  const [showType, setShowType] = useState<'run' | 'markdown'>(() => {
    if (hasHtml) {
      if (isMessageDone) {
        return 'run';
      }
    }

    return 'markdown';
  });

  useEffect(() => {
    if (isMessageDone && hasHtml) {
      setShowType('run');
    }
  }, [hasHtml, isMessageDone]);

  return (
    <RootRenderContext.Provider value={{ showType, setShowType, EventEmitter }}>{children}</RootRenderContext.Provider>
  );
};

export default function useCodeActions({
  wrap,
  msgId,
  messageId,
  isMessageDone,
  isThinkingProcess,
}: {
  wrap: React.RefObject<HTMLDivElement | null>;
  msgId?: string; // 前端的id
  messageId?: string; // 数据库的id
  isThinkingProcess?: boolean;
  isMessageDone?: boolean;
}) {
  const intl = useIntl();

  const { EventEmitter, sessionId, layoutMode } = useGlobal();
  const { message } = App.useApp();

  const rootsRef = useRef<Map<HTMLElement, Root>>(new Map());
  const loadingStatesRef = useRef<Map<HTMLElement, { share: boolean }>>(new Map());
  const isCollectLoading = useRef(false);

  const innerHTMLWrapperRef = useRef<string>('');

  const isPreviewMode = layoutMode === LayoutMode.preview;
  const showShare = !!msgId && !!messageId && !isPreviewMode;

  // 处理图片收藏点击事件
  const handleToggleCollect = useCallback(
    (
      payload:
        | {
            content: string;
            name: string;
            type?: string;
          }
        | {
            fileCode: string;
            type?: string;
          },
      collect: boolean
    ) => {
      if (collect) {
        return collectCase({
          sessionId,
          messageId,
          type: 'image',
          ...payload,
        });
      }
      return cancelCollectCase({
        sessionId,
        messageId,
        type: 'image',
        ...payload,
      });
    },
    [messageId, sessionId]
  );

  // 绑定图片收藏按钮的点击事件
  useEffect(() => {
    if (!wrap.current) return undefined;

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;

      const starButton = target.closest(`.${styles.markdownImageStar}`);
      if (starButton && !isCollectLoading.current) {
        e.preventDefault();
        e.stopPropagation();
        const imageSrc = starButton.getAttribute('data-image-src');
        const imageName = starButton.getAttribute('data-image-title');
        const currentCollected = starButton.getAttribute('data-image-collected') === 'true';
        const nextCollected = !currentCollected;

        if (imageSrc) {
          isCollectLoading.current = true;
          let payload;
          if (nextCollected) {
            payload = {
              content: imageSrc,
              name: imageName || 'image',
            };
          } else {
            payload = {
              fileCode: md5(imageSrc),
            };
          }
          starButton.innerHTML = loadingStarHtml;
          starButton.classList.add(styles.loadingIcon);
          handleToggleCollect(payload, nextCollected)
            .then(() => {
              message.success(
                intl.formatMessage({ id: nextCollected ? 'common.collectSuccess' : 'common.cancelCollectSuccess' })
              );
              toggleImageCollected(starButton as HTMLElement);
            })
            .finally(() => {
              isCollectLoading.current = false;
            });
        }
      }

      const downloadButton = target.closest(`.${styles.markdownImageDownload}`);
      if (downloadButton) {
        const imageSrc = downloadButton.getAttribute('data-image-src');
        const imageName = downloadButton.getAttribute('data-image-title');
        downloadFile({
          fileName: imageName,
          fileUrl: imageSrc,
        });
      }

      const fullScreenButton = target.closest(`.${styles.markdownIconFullScreen}`);
      if (fullScreenButton) {
        e.preventDefault();
        e.stopPropagation();
        const { parentElement } = fullScreenButton;
        if (parentElement) {
          const myParentElement = parentElement.cloneNode(true);
          myParentElement.childNodes.forEach((child) => {
            if ((child as HTMLElement).tagName !== 'TABLE') {
              child.remove();
            }
          });

          const root = (
            <div
              className={classNames(styles.newmdWrap, myStyles.mymdWrap, 'full-width full-height ub ub-pc')}
              style={{ backgroundColor: '#fff', padding: '12px' }}
            >
              <div className={classNames(styles.tableWrapper, 'full-height')}>
                <div
                  className={styles.myTable}
                  style={{ maxHeight: '100%', height: 'max-content', marginBottom: 0 }}
                  dangerouslySetInnerHTML={{ __html: myParentElement?.innerHTML }}
                />
              </div>
            </div>
          );

          EventEmitter.emit('beyond-fullscreen-modal-open-type', {
            canClose: true,
            drawerType: root,
          });
        }
      }
    };

    wrap.current.addEventListener('click', handleClick);

    return () => {
      if (wrap.current) {
        wrap.current.removeEventListener('click', handleClick);
      }
    };
  }, [handleToggleCollect]);

  const mountCodeWrapper = useCallback(
    (container: HTMLDivElement) => {
      const codeNodes = Array.from(container.querySelectorAll('pre > .html')) as HTMLElement[];

      // 清理不再存在的 codeEl 的 root
      const currentCodeEls = new Set(codeNodes);
      for (const [codeEl, root] of rootsRef.current.entries()) {
        if (!currentCodeEls.has(codeEl)) {
          root.unmount();
          rootsRef.current.delete(codeEl);
          loadingStatesRef.current.delete(codeEl);
        }
      }

      const mainBodyCodeClass = 'main-body-code';

      codeNodes.forEach((codeEl, codeElIdx) => {
        if (!isThinkingProcess) {
          codeEl.classList.add(mainBodyCodeClass);
        }
        console.log('mountCodeWrapper codeEl', codeEl);
        const rootWrapper = document.createElement('div');
        rootWrapper.className = styles.rootWrapper;

        const hasHtml = codeEl.classList.contains('language-html');

        // 初始化 loading 状态
        if (!loadingStatesRef.current.has(codeEl)) {
          loadingStatesRef.current.set(codeEl, { share: false });
        }

        // 获取当前 loading 状态
        const getLoadingState = () => loadingStatesRef.current.get(codeEl) || { share: false };

        const getHTMLURL = () => {
          // const textContent = getAllTextContent(codeEl);
          const textContent = innerHTMLWrapperRef.current;
          const cleanedContent = textContent.trim();
          const htmlContent = unescapeHTML(cleanedContent || codeEl.innerText);
          const blobUrl = URL.createObjectURL(new Blob([htmlContent], { type: 'text/html' }));
          return blobUrl;
        };

        const getHTMLStr = () => {
          return innerHTMLWrapperRef.current;
        };

        const handleCopy = async () => {
          // const textContent = getAllTextContent(codeEl);
          const textContent = innerHTMLWrapperRef.current;
          copy(textContent);
          message.success(intl.formatMessage({ id: 'common.copySuccess' }));
        };

        const handleShare = async () => {
          if (!messageId) return;

          const msgWrapId = `wrapper_${msgId}`;
          const htmlCodeEles = document.querySelectorAll(`#${msgWrapId} .${mainBodyCodeClass}`);

          const segmentIdx = Array.from(htmlCodeEles).indexOf(codeEl);

          const url = new URL(window.location.href);
          url.searchParams.set('messageId', messageId);
          url.searchParams.set('segment', `${segmentIdx + 1}`);
          url.pathname = '/byaiService/chat/preview/html';
          copy(url.toString());
          message.success(intl.formatMessage({ id: 'markdown.codeActions.linkCopied' }));
        };

        // 创建 React root 并渲染 header
        let root = rootsRef.current.get(codeEl);

        root = createRoot(rootWrapper);
        rootsRef.current.set(codeEl, root);
        innerHTMLWrapperRef.current = codeEl.innerText;

        root.render(
          <RootRender hasHtml={hasHtml} isMessageDone={!!isMessageDone} EventEmitter={EventEmitter}>
            <CodeHeader
              className={codeEl.className?.replace(mainBodyCodeClass, '') ?? 'HTML'}
              onCopy={handleCopy}
              onShare={handleShare}
              hasHtml={hasHtml}
              showShare={showShare}
              isMessageDone={!!isMessageDone}
              shareLoading={getLoadingState().share}
            />
            <CodeTabs getHTMLURL={getHTMLURL} getHTMLStr={getHTMLStr} isMessageDone={!!isMessageDone} />
          </RootRender>
        );

        codeEl.innerHTML = '';
        codeEl.appendChild(rootWrapper);
      });
    },
    [showShare, isMessageDone, isThinkingProcess, messageId, msgId]
  );

  useEffect(() => {
    if (!wrap.current) return;
    mountCodeWrapper(wrap.current);
  }, [wrap, mountCodeWrapper]);

  useEffect(() => {
    return () => {
      for (const root of rootsRef.current.values()) {
        root.unmount();
      }
      rootsRef.current.clear();
      loadingStatesRef.current.clear();
    };
  }, []);
}
