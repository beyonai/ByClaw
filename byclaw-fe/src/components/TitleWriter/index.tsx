import classNames from 'classnames';
import { get } from 'lodash';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import styles from './index.module.less';
import { getRuntimeActualUrl } from '@/utils';
import { getSystemConfigByStorage } from '@/utils/system';
import useGlobal from '@/hooks/useGlobal';

type ITips = {
  tips: string;
  onClick?: () => void;
};

function TitleWriter({
  className,
  title,
  colorTitle,
  colorTitleBg,
  fullText,
  highlightStart = 1000,
  showAssistant,
  showAssistantTips = false,
}: {
  className?: string;
  title: React.ReactNode;
  colorTitle?: React.ReactNode;
  colorTitleBg?: string;
  fullText: string;
  highlightStart?: number;
  showAssistant?: boolean;
  showAssistantTips?: boolean;
}) {
  const [displayText, setDisplayText] = useState<string[]>([]);
  const [displayColorText, setDisplayColorText] = useState<string[]>([]);
  const [videoEnded, setVideoEnded] = useState(true);

  // 助手提示气泡:tipsList 通过事件接收,始终展示第一项,点击后移除当前项;为空时不显示
  const [tipsList, setTipsList] = useState<ITips[]>([]);
  const [displayTips, setDisplayTips] = useState('');

  const runner = useRef<NodeJS.Timeout>(undefined);
  const tipsRunner = useRef<NodeJS.Timeout>(undefined);
  const videoRef = useRef<HTMLVideoElement>(null);

  const { EventEmitter } = useGlobal();

  const getAssistantVideo = React.useMemo(() => getRuntimeActualUrl('beyond/assistant.mp4'), []);
  const getAssistantIcon = React.useMemo(() => {
    const defaultIcon = getRuntimeActualUrl('beyond/assistant.png');
    return getSystemConfigByStorage().assistant || defaultIcon;
  }, []);

  const playAssistantVideo = useCallback(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    setVideoEnded(false);
    try {
      video.currentTime = 0;
    } catch {
      // Some browsers do not allow seeking before enough metadata is ready.
    }

    const playPromise = video.play();
    if (playPromise) {
      playPromise.catch(() => {
        setVideoEnded(true);
      });
    }
  }, []);

  const loopFN = () => {
    setDisplayText([]);
    setDisplayColorText([]);

    // 生成字符数组
    const chars = fullText.split('');

    let idx = 0;

    const loop = () => {
      if (idx < highlightStart) {
        setDisplayText((prevList) => {
          return [...prevList, get(chars, idx, '')];
        });
      } else {
        setDisplayColorText((prevList) => {
          return [...prevList, get(chars, idx, '')];
        });
      }

      if (idx < chars.length) {
        runner.current = setTimeout(() => {
          idx += 1;
          loop();
        }, 100);
      } else {
        setTimeout(() => {
          loopFN();
        }, 3000);
      }
    };

    loop();
  };

  useEffect(() => {
    loopFN();

    return () => {
      clearTimeout(runner.current);
    };
  }, [fullText]);

  useEffect(() => {
    const handler = (list: ITips | ITips[]) => {
      const next = Array.isArray(list) ? list : [list];
      setTipsList(next);
    };

    EventEmitter.on('beyond-titlewriter-set-assistanttips', handler);

    return () => {
      EventEmitter.off('beyond-titlewriter-set-assistanttips', handler);
    };
  }, []);

  // 始终展示第一项,以打字机效果逐字出现
  useEffect(() => {
    clearTimeout(tipsRunner.current);
    const current = get(tipsList, 0);
    if (!current) {
      setDisplayTips('');
      return;
    }

    const chars = current.tips.split('');
    let idx = 0;
    setDisplayTips('');
    playAssistantVideo();

    const typing = () => {
      setDisplayTips(chars.slice(0, idx + 1).join(''));
      if (idx < chars.length - 1) {
        tipsRunner.current = setTimeout(() => {
          idx += 1;
          typing();
        }, 100);
      }
    };
    typing();

    return () => {
      clearTimeout(tipsRunner.current);
    };
  }, [tipsList, playAssistantVideo]);

  const handleTipsClick = () => {
    const current = get(tipsList, 0);
    current?.onClick?.();
    // 移除当前项,展示下一项;为空时气泡消失
    setTipsList((prev) => prev.slice(1));
  };

  return (
    <div className={classNames(styles.titleWriter, className, { [styles.withAssistant]: showAssistant })}>
      <div className={styles.title}>
        <span>{title}</span>
        <span className={styles.highlight} style={{ background: colorTitleBg }}>
          <span>{colorTitle}</span>
        </span>
      </div>
      <div className={styles.subtitle}>
        {displayText.map((char, index) => {
          return (
            <span className={styles.text} key={index}>
              {char}
            </span>
          );
        })}
        <span className={styles.highlight} style={{ background: colorTitleBg }}>
          {displayColorText.map((char, index) => {
            return (
              <span className={styles.text} key={index}>
                {char}
              </span>
            );
          })}
        </span>
        {fullText && <span className={styles.blinkWriter} />}
      </div>
      {showAssistant && (
        <div className={styles.assistant}>
          <div className={styles.wrapper}>
            <img alt="" src={getAssistantIcon} style={{ display: videoEnded ? 'block' : 'none', width: '100%' }} />
            <video
              ref={videoRef}
              src={getAssistantVideo}
              muted
              playsInline
              // loop
              onLoadedData={playAssistantVideo}
              onEnded={() => {
                videoRef.current?.pause();
                // setVideoEnded(true);
              }}
              style={{ display: videoEnded ? 'none' : 'block', width: '100%' }}
              // eslint-disable-next-line react/no-unknown-property
              fetchPriority="low"
            />
            {showAssistantTips && displayTips && (
              <div className={styles.tips} onClick={handleTipsClick}>
                <span className={styles.tipsText}>{displayTips}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default TitleWriter;
