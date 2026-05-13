import React, { useContext, useEffect, useCallback, useState } from 'react';
import { CloseCircleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useSelector, useIntl } from '@umijs/max';
import html2canvas from 'html2canvas';
import { Skeleton } from 'antd';

import GlobalContext from '@/layout/components/provider/global';
import { getRuntimeActualUrl } from '@/utils';
import { getDisplayUserNameInChat } from '@/utils/chat';

import type { IBaseProps } from './index';

import styles from './index.module.less';

export type IMyProps = IBaseProps & {
  messageListItemContent: {
    substance: {
      birthdayTime: string;
      joinTime: string;
      integrationType?: string;
    };
    hasShowed?: boolean;
  };
};

const CardRender = ({ canClose = true, messageListItemContent }: { canClose?: boolean } & IMyProps) => {
  const { substance } = messageListItemContent;
  const { birthdayTime, joinTime } = substance || {};

  const intl = useIntl();
  const { EventEmitter } = useContext(GlobalContext);

  const { userInfo } = useSelector(({ user }: any) => ({
    userInfo: user.userInfo,
  }));

  const currentYear = dayjs().year();
  const birthdayMonth = dayjs(birthdayTime).month();
  const birthdayDay = dayjs(birthdayTime).date();
  const birthdayDate = dayjs(`${currentYear}-${birthdayMonth}-${birthdayDay}`);

  return (
    <div style={{ position: 'relative' }}>
      {canClose && (
        <CloseCircleOutlined
          className="pointer"
          style={{ color: '#fff', fontSize: 24, position: 'absolute', right: 0, top: '34px', zIndex: 9 }}
          onClick={() => {
            EventEmitter.emit('beyond-fullscreen-modal-open-type');
          }}
        />
      )}
      <div
        className={styles.birthdayCard}
        style={{
          backgroundImage: `url(${getRuntimeActualUrl('imgs/material/brithday.png')})`,
          position: 'relative',
        }}
      >
        <div style={{ position: 'absolute', top: '90px', left: 0 }} className="full-width ub ub-ac ub-pc ub-ver">
          <div
            style={{
              width: '60%',
              margin: '0 auto 16px',
              textAlign: 'center',
              fontSize: '12px',
              color: '#9B6D3F',
            }}
          >
            <p>
              {intl.formatMessage(
                { id: 'birthdayCard.dateFormat' },
                {
                  year: currentYear,
                  month: birthdayMonth,
                  day: birthdayDay,
                  weekday: dayjs(birthdayDate).format('dddd'),
                }
              )}
            </p>
            <p>
              {intl.formatMessage(
                { id: 'birthdayCard.accompanyDays' },
                { days: dayjs(birthdayDate).diff(dayjs(joinTime), 'day') }
              )}
            </p>
          </div>
          <div className={styles.userName}>{getDisplayUserNameInChat(userInfo.userName)}</div>
        </div>
      </div>
    </div>
  );
};

const BirthdayCard = (props: IMyProps) => {
  const { EventEmitter } = useContext(GlobalContext);

  const { updateMessageListItemContent, messageListItemContent, message } = props;
  const { hasShowed } = messageListItemContent;
  const { isHistoryMsg } = message || {};

  const [canvasUrl, setCanvasUrl] = useState('');

  const onFullscreen = useCallback(() => {
    EventEmitter.emit('beyond-fullscreen-modal-open-type', {
      drawerType: <CardRender {...props} />,
      width: 'auto',
      height: 'auto',
      canClose: false,
    });
  }, []);

  useEffect(() => {
    if (isHistoryMsg || hasShowed) return;
    onFullscreen();
    updateMessageListItemContent({
      ...messageListItemContent,
      hasShowed: true,
    });
  }, [isHistoryMsg, hasShowed]);

  useEffect(() => {
    html2canvas(document.getElementById('birthday-card-container') as HTMLElement).then((canvas) => {
      canvas.toBlob((blob) => {
        if (!blob) return;

        const url = URL.createObjectURL(blob);
        setCanvasUrl(url);
      });
    });
  }, []);

  return (
    <>
      {!canvasUrl && (
        <div id="birthday-card-container" style={{ position: 'fixed', zIndex: -999, top: -999, left: -999 }}>
          <CardRender canClose={false} {...props} />
        </div>
      )}
      {canvasUrl ? (
        <img
          src={canvasUrl}
          style={{ width: '140px', height: '205px' }}
          alt="brithday"
          className="pointer"
          onClick={() => onFullscreen()}
        />
      ) : (
        <div className={`${styles.imageSkeleton}`}>
          <Skeleton.Image
            active
            style={{
              width: '100%',
              height: '100%',
              borderRadius: '8px',
            }}
          />
        </div>
      )}
    </>
  );
};

export default BirthdayCard;
