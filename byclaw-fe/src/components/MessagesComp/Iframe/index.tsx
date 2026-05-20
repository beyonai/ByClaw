// tslint:disable:ordered-imports
import React, { useCallback, useMemo } from 'react';
import classnames from 'classnames';
import { isEmpty, get } from 'lodash';
import { ContainerOutlined, ArrowRightOutlined } from '@ant-design/icons';
import useAppStore from '@/models/common/useAppStore';
import useGlobal from '@/hooks/useGlobal';
// @ts-ignore
import { useIntl } from '@umijs/max';
import styles from './index.module.less';

export type IIFrame = {
  url: string;
  param: Record<string, string>;
  config: Record<string, unknown>;
  text?: string;
};

type IProps = {
  messageListItemContent: { substance: string };
};

function IframeComp(props: IProps) {
  const { messageListItemContent } = props;
  const substance = get(messageListItemContent, 'substance');

  const intl = useIntl();
  const { setSiderCollapsed } = useAppStore();
  const { EventEmitter } = useGlobal();

  const iframeParam = useMemo<IIFrame>(() => {
    if (substance && typeof substance === 'object') {
      return substance;
    }
    try {
      return JSON.parse(substance);
    } catch (e) {
      console.error(e);
      return {};
    }
  }, [substance]);

  const openIframe = useCallback(() => {
    const fullWindow = get(iframeParam, 'config.width') === 'max';
    const param = get(iframeParam, 'param') || {};

    let url = get(iframeParam, 'url') || '';

    if (!isEmpty(param)) {
      const searchParams = new URLSearchParams(param);
      url += `?${searchParams.toString()}`;
    }

    if (fullWindow) {
      EventEmitter.emit('beyond-fullscreen-modal-message', {
        url,
        needToken: true,
      });
      EventEmitter.emit('beyond-fullscreen-modal-open-type', 'iframe');
      return;
    }

    setSiderCollapsed(true);
    EventEmitter.emit('beyond-minor-driver-message', {
      url,
      needToken: true,
    });
    EventEmitter.emit('beyond-minor-driver-open-type', {
      title: iframeParam?.text || intl.formatMessage({ id: 'common.viewDetail' }),
      canFullScreen: true,
      canClose: true,
      drawerType: 'iframe',
    });
  }, [iframeParam, intl]);

  if (isEmpty(iframeParam) || !iframeParam.url) return null;

  return (
    <div className={classnames('mw600', 'pointer', 'ub ub-ac', styles.iframeComp)} onClick={openIframe}>
      <div className="ub ub-ac" style={{ gap: '4px' }}>
        <ContainerOutlined style={{ color: '#165DFF' }} />
        <span style={{ color: '#165DFF' }}>{intl.formatMessage({ id: 'common.clickHere' })}</span>
      </div>
      {iframeParam?.text || intl.formatMessage({ id: 'common.clickToViewDetail' })}
      <ArrowRightOutlined />
    </div>
  );
}

export default IframeComp;
