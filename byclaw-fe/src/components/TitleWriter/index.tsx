import classNames from 'classnames';
import { get } from 'lodash';
import React, { useEffect, useRef, useState } from 'react';
import styles from './index.module.less';
import { getRuntimeActualUrl } from '@/utils';
import { getSystemConfigByStorage } from '@/utils/system';

function TitleWriter({
  className,
  title,
  colorTitle,
  colorTitleBg,
  fullText,
  highlightStart = 1000,
  showAssistant,
}: {
  className?: string;
  title: React.ReactNode;
  colorTitle?: React.ReactNode;
  colorTitleBg?: string;
  fullText: string;
  highlightStart?: number;
  showAssistant?: boolean;
}) {
  const [displayText, setDisplayText] = useState<string[]>([]);
  const [displayColorText, setDisplayColorText] = useState<string[]>([]);
  const [videoEnded, setVideoEnded] = useState(true);

  const runner = useRef<NodeJS.Timeout>(undefined);

  const getAssistantIcon = React.useMemo(() => {
    const defaultIcon = getRuntimeActualUrl('beyond/assistant.png');
    return getSystemConfigByStorage().assistant || defaultIcon;
  }, []);

  const getAssistantVideo = React.useMemo(() => getRuntimeActualUrl('beyond/assistant.mp4'), []);

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
              src={getAssistantVideo}
              autoPlay
              muted
              playsInline
              loop
              // onEnded={() => setVideoEnded(true)}
              onLoadedData={() => setVideoEnded(false)}
              style={{ display: videoEnded ? 'none' : 'block', width: '100%' }}
              // eslint-disable-next-line react/no-unknown-property
              fetchPriority="low"
            />
            {/* <div className={styles.tips}>点击查看版本详情</div> */}
          </div>
        </div>
      )}
    </div>
  );
}

export default TitleWriter;
