import { Tooltip } from 'antd';
import classnames from 'classnames';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useIntl } from '@umijs/max';

import useGlobal from '@/hooks/useGlobal';
import { getMessageOutline, type ConversationOutlineItem } from '@/service/message';
import type { IMessage } from '@/typescript/message';
import styles from './index.module.less';
import {
  buildConversationTurns,
  createLocalOutlineItems,
  mergeOutlineItems,
  shouldShowConversationNavigator,
} from './utils';

type Props = {
  sessionId: string;
  messageList: IMessage[];
  scrollContainerId: string;
  onLoadedMessageClick?: () => void;
};

export default function ConversationNavigator({
  sessionId,
  messageList,
  scrollContainerId,
  onLoadedMessageClick,
}: Props) {
  const intl = useIntl();
  const dispatch = useDispatch();
  const { EventEmitter } = useGlobal();
  const [remoteItems, setRemoteItems] = useState<ConversationOutlineItem[]>([]);
  const [activeTurnId, setActiveTurnId] = useState('');
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const updateRafRef = useRef<number>();

  useEffect(() => {
    let cancelled = false;
    setRemoteItems([]);
    getMessageOutline(sessionId)
      .then((items) => {
        if (!cancelled) setRemoteItems(Array.isArray(items) ? items : []);
      })
      .catch((error) => {
        console.error(error);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, messageList.length]);

  const turns = useMemo(() => {
    const localItems = createLocalOutlineItems(messageList);
    return buildConversationTurns(mergeOutlineItems(remoteItems, localItems));
  }, [messageList, remoteItems]);

  const updateState = useCallback(() => {
    const scroller = document.getElementById(scrollContainerId);
    if (!scroller) return;

    const activationLine = scroller.getBoundingClientRect().top + scroller.clientHeight * 0.32;
    let nextActive = turns[0]?.id || '';
    turns.forEach((turn) => {
      const loadedElements = turn.messageIds
        .map((messageId) => document.getElementById(`wrapper_${messageId}`))
        .filter(Boolean) as HTMLElement[];
      if (loadedElements.some((element) => element.getBoundingClientRect().top <= activationLine)) {
        nextActive = turn.id;
      }
    });
    setActiveTurnId(nextActive);
  }, [scrollContainerId, turns]);

  const scheduleUpdate = useCallback(() => {
    if (updateRafRef.current !== undefined) cancelAnimationFrame(updateRafRef.current);
    updateRafRef.current = requestAnimationFrame(() => {
      updateRafRef.current = undefined;
      updateState();
    });
  }, [updateState]);

  useEffect(() => {
    const scroller = document.getElementById(scrollContainerId);
    const host = scroller?.parentElement;
    if (!scroller || !host) return undefined;

    scheduleUpdate();
    scroller.addEventListener('scroll', scheduleUpdate, { passive: true });
    const resizeObserver = new ResizeObserver(scheduleUpdate);
    resizeObserver.observe(host);
    resizeObserver.observe(scroller);
    if (scroller.firstElementChild) resizeObserver.observe(scroller.firstElementChild);
    return () => {
      scroller.removeEventListener('scroll', scheduleUpdate);
      resizeObserver.disconnect();
      if (updateRafRef.current !== undefined) cancelAnimationFrame(updateRafRef.current);
    };
  }, [scheduleUpdate, scrollContainerId]);

  const handleTurnClick = useCallback(
    (turn: (typeof turns)[number]) => {
      const loadedElement = turn.messageIds
        .map((messageId) => document.getElementById(`wrapper_${messageId}`))
        .find(Boolean);
      if (loadedElement) {
        onLoadedMessageClick?.();
        loadedElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      dispatch({
        type: 'messageStore/setInitialSessionDataToLocateMsg',
        payload: {
          sessionId,
          index: turn.position,
          total: turn.totalCount,
          targetMessageId: turn.targetMessageId,
        },
      });
      void dispatch({
        type: 'messageStore/getSessionMessage',
        payload: { sessionId },
      }).then(() => {
        EventEmitter.emit('scrollToMsgOnSessionChanged', {
          sessionId,
          targetMessageId: turn.targetMessageId,
        });
      });
    },
    [dispatch, EventEmitter, onLoadedMessageClick, sessionId, turns]
  );

  if (!shouldShowConversationNavigator(turns)) return null;

  return (
    <nav className={styles.navigator} aria-label={intl.formatMessage({ id: 'conversationNavigator.label' })}>
      <div className={styles.track} onMouseLeave={() => setHoveredIndex(null)}>
        <div className={styles.markerStack}>
          {turns.map((turn, index) => {
            const active = turn.id === activeTurnId;
            const hoverDistance = hoveredIndex === null ? -1 : Math.abs(hoveredIndex - index);
            return (
              <Tooltip
                key={turn.id}
                placement="right"
                mouseEnterDelay={0.15}
                overlayClassName={styles.tooltipOverlay}
                title={
                  <div className={styles.tooltip}>
                    <div className={styles.tooltipTitle}>
                      {turn.question ||
                        intl.formatMessage({ id: 'conversationNavigator.conversation' }, { index: index + 1 })}
                    </div>
                    {turn.answer && <div className={styles.tooltipAnswer}>{turn.answer}</div>}
                  </div>
                }
              >
                <button
                  type="button"
                  className={classnames(styles.markerButton, {
                    [styles.active]: active,
                    [styles.hovered]: hoverDistance === 0,
                    [styles.near]: hoverDistance === 1,
                    [styles.far]: hoverDistance === 2,
                  })}
                  aria-label={intl.formatMessage({ id: 'conversationNavigator.jumpTo' }, { index: index + 1 })}
                  aria-current={active ? 'location' : undefined}
                  onMouseEnter={() => setHoveredIndex(index)}
                  onFocus={() => setHoveredIndex(index)}
                  onBlur={() => setHoveredIndex(null)}
                  onClick={() => handleTurnClick(turn)}
                >
                  <span className={styles.marker} />
                </button>
              </Tooltip>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
