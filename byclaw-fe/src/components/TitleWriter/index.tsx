import classNames from 'classnames';
import { useSelector } from '@umijs/max';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import styles from './index.module.less';
import { getRuntimeActualUrl } from '@/utils';
import { getSystemConfigByStorage } from '@/utils/system';
import useGlobal from '@/hooks/useGlobal';

type ITips = {
  tips: string;
  onClick?: () => void;
};

type PendingPlayType = 'auto' | 'tips';

const Subtitle = React.memo((props: { colorTitleBg?: string; fullText: string; highlightStart?: number }) => {
  const { colorTitleBg, fullText, highlightStart = 1000 } = props;

  const [displayText, setDisplayText] = useState<string[]>([]);
  const [displayColorText, setDisplayColorText] = useState<string[]>([]);

  const runner = useRef<NodeJS.Timeout>(undefined);

  const loopFN = () => {
    setDisplayText([]);
    setDisplayColorText([]);

    // 生成字符数组
    const chars = fullText.split('');

    let idx = 0;

    const loop = () => {
      if (idx < highlightStart) {
        setDisplayText((prevList) => {
          return [...prevList, chars[idx] ?? ''];
        });
      } else {
        setDisplayColorText((prevList) => {
          return [...prevList, chars[idx] ?? ''];
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

  return (
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
  );
});

const Assistant = React.memo((props: { showAssistantTips?: boolean }) => {
  const { showAssistantTips = false } = props;

  const userInfo = useSelector((state: any) => state.user?.userInfo);

  const [videoEnded, setVideoEnded] = useState(true);

  // 助手提示气泡:tipsList 通过事件接收,始终展示第一项,点击后移除当前项;为空时不显示
  const [tipsList, setTipsList] = useState<ITips[]>([]);
  const [displayTips, setDisplayTips] = useState('');

  const tipsRunner = useRef<NodeJS.Timeout>(undefined);
  const videoRef = useRef<HTMLVideoElement>(null);
  const pendingTipsRef = useRef<string | null>(null);
  // 标记是否有一次播放请求正在等待视频可播,并区分自动播放和 tips 触发的播放。
  const pendingPlayTypeRef = useRef<PendingPlayType | null>(null);
  // 标记当前 video 是否已经进入播放流程;防止播放中再次 request/play 导致循环。
  const playingRef = useRef(false);
  // userInfo 是异步获取的,该标记保证用户信息就绪后的自动播放只触发一次。
  const autoPlayedRef = useRef(false);

  const { EventEmitter } = useGlobal();

  const getAssistantVideo = React.useMemo(() => getRuntimeActualUrl('beyond/assistant.mp4'), []);
  const getAssistantIcon = React.useMemo(() => {
    const defaultIcon = getRuntimeActualUrl('beyond/assistant.png');
    return getSystemConfigByStorage().assistant || defaultIcon;
  }, []);

  const startTipsTyping = useCallback((tips: string) => {
    clearTimeout(tipsRunner.current);
    const chars = tips.split('');
    let idx = 0;
    setDisplayTips('');

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
  }, []);

  const releasePendingTips = useCallback(() => {
    const tips = pendingTipsRef.current;
    if (!tips) {
      return;
    }

    pendingTipsRef.current = null;
    startTipsTyping(tips);
  }, [startTipsTyping]);

  const playAssistantVideo = useCallback(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    // 消费本次等待中的播放请求;后续 canplay 即使再次触发,也不会重复进入播放逻辑。
    const pendingPlayType = pendingPlayTypeRef.current;
    pendingPlayTypeRef.current = null;
    if (playingRef.current && !video.paused && !video.ended) {
      return;
    }

    playingRef.current = true;
    if (pendingPlayType === 'auto') {
      autoPlayedRef.current = true;
    }
    setVideoEnded(false);
    releasePendingTips();
    try {
      if (video.readyState >= HTMLMediaElement.HAVE_METADATA && video.currentTime > 0.05) {
        video.currentTime = 0;
      }
    } catch {
      // Some browsers do not allow seeking before enough metadata is ready.
    }

    const playPromise = video.play();
    if (playPromise) {
      playPromise.catch(() => {
        playingRef.current = false;
        setVideoEnded(true);
      });
    }
  }, [releasePendingTips]);

  const requestAssistantVideoPlay = useCallback(
    (isAutoPlay = false) => {
      const video = videoRef.current;
      if (!video) {
        return;
      }

      if (isAutoPlay && autoPlayedRef.current) {
        return;
      }

      if (playingRef.current && !video.paused && !video.ended) {
        return;
      }

      pendingPlayTypeRef.current = isAutoPlay ? 'auto' : 'tips';
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        // 已经具备当前帧数据时直接播放,不依赖下一次 canplay 事件。
        playAssistantVideo();
        return;
      }

      // 数据未就绪时主动触发加载,后续由 onCanPlay 消费 pending 播放请求。
      video.load();
    },
    [playAssistantVideo]
  );

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

  useEffect(() => {
    if (!userInfo || autoPlayedRef.current || tipsList.length > 0) {
      return;
    }

    // 等 userInfo 异步返回后再发起一次自动播放;实际播放仍要等视频可播放。
    requestAssistantVideoPlay(true);
  }, [userInfo, requestAssistantVideoPlay, tipsList.length]);

  // 始终展示第一项,以打字机效果逐字出现
  useEffect(() => {
    clearTimeout(tipsRunner.current);
    const current = tipsList[0];
    if (!current) {
      pendingTipsRef.current = null;
      setDisplayTips('');
      return;
    }

    setDisplayTips('');
    pendingTipsRef.current = current.tips;
    requestAssistantVideoPlay();

    const video = videoRef.current;
    if (video && playingRef.current && !video.paused && !video.ended) {
      releasePendingTips();
    }

    return () => {
      clearTimeout(tipsRunner.current);
    };
  }, [tipsList, releasePendingTips, requestAssistantVideoPlay]);

  const handleTipsClick = () => {
    const current = tipsList[0];
    current?.onClick?.();
    // 移除当前项,展示下一项;为空时气泡消失
    setTipsList((prev) => prev.slice(1));
  };

  return (
    <div className={styles.assistant}>
      <div className={styles.wrapper}>
        <img alt="" src={getAssistantIcon} style={{ display: videoEnded ? 'block' : 'none', width: '100%' }} />
        <video
          preload="auto"
          ref={videoRef}
          src={getAssistantVideo}
          muted
          playsInline
          onCanPlay={() => {
            // canplay 可能多次触发,只有存在等待中的播放请求时才真正播放。
            if (pendingPlayTypeRef.current) {
              playAssistantVideo();
            }
          }}
          onEnded={() => {
            pendingPlayTypeRef.current = null;
            playingRef.current = false;
          }}
          onError={() => {
            pendingPlayTypeRef.current = null;
            playingRef.current = false;
            setVideoEnded(true);
            releasePendingTips();
          }}
          style={{ display: videoEnded ? 'none' : 'block', width: '100%' }}
          // React 18 不识别 camelCase fetchPriority，透传小写属性避免控制台告警。
          {...{ fetchpriority: 'low' }}
        />
        {showAssistantTips && displayTips && (
          <div className={styles.tips} onClick={handleTipsClick}>
            <span className={styles.tipsText}>{displayTips}</span>
          </div>
        )}
      </div>
    </div>
  );
});

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
  return (
    <div className={classNames(styles.titleWriter, className, { [styles.withAssistant]: showAssistant })}>
      <div className={styles.title}>
        <span>{title}</span>
        <span className={styles.highlight} style={{ background: colorTitleBg }}>
          <span>{colorTitle}</span>
        </span>
      </div>
      <Subtitle colorTitleBg={colorTitleBg} fullText={fullText} highlightStart={highlightStart} />
      {showAssistant && <Assistant showAssistantTips={showAssistantTips} />}
    </div>
  );
}

export default React.memo(TitleWriter);
