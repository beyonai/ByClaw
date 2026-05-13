import React, { useState, useEffect } from 'react';
import { message, Tooltip } from 'antd';
import { debounce } from 'lodash';
import classNames from 'classnames';
import { useIntl } from '@umijs/max';
import AndtIcon from '@/components/AntdIcon';
import { LoadingOutlined } from '@ant-design/icons';

import useAppStore from '@/models/common/useAppStore';

import RecordererSTT from './STT/RecordererSTT';
import XunfeiSTT from './STT/XunfeiSTT';
import { IRecognizedVal } from './STT/BaseSTTHandler';
import RecordingIcon from './recordingIcon';

import styles from './index.module.less';

export type RecordingStatus = 'recording' | 'stopping' | 'connecting' | 'error';
export type ISttOpts = {
  type?: string;
  options?: Record<string, unknown>;
};

const CONNECT_DELAY = 500;

export interface STTCompRef {
  stop: () => void;
  start: () => void;
}

interface Props {
  onRecognized: (value: IRecognizedVal) => void;
  onStatus?: (recordingStatus: RecordingStatus) => void;
  asrOpts?: {
    type: 'xunfei' | 'socket';
    options?: Record<string, unknown>;
  };
}

function STTComp(props: Props, ref: any) {
  const intl = useIntl();
  const { onRecognized, onStatus, asrOpts } = props;

  const { getSTTOpts } = useAppStore();

  const sttInstance = React.useRef<any>(null);

  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus>('error');

  const isRecording = recordingStatus === 'recording';
  const isConnecting = recordingStatus === 'connecting';
  const isStopping = recordingStatus === 'stopping';
  const isError = recordingStatus === 'error';

  const stop = React.useCallback(() => {
    setRecordingStatus('stopping');

    if (sttInstance.current) {
      sttInstance.current.pauseToService();
    }
  }, []);

  const start = React.useCallback(() => {
    setRecordingStatus('connecting');

    setTimeout(() => {
      if (sttInstance.current) {
        sttInstance.current.connectToService();
      }
    }, CONNECT_DELAY);
  }, []);

  const onMyRecognized = (value: IRecognizedVal) => {
    setRecordingStatus((prevStatus) => {
      if (prevStatus === 'recording') {
        onRecognized?.(value);
      }

      return prevStatus;
    });
  };

  const myGetSTTOpts = React.useCallback(() => {
    if (asrOpts) {
      return Promise.resolve(asrOpts);
    }
    return getSTTOpts();
  }, [getSTTOpts, asrOpts]);

  React.useImperativeHandle(ref, () => ({
    stop,
    start,
  }));

  useEffect(() => {
    const init = (sttParams: ISttOpts) => {
      const { type, options } = sttParams || {};

      if (!type) return;

      let STTInstance: any = null;
      switch (type) {
        case 'xunfei':
          STTInstance = XunfeiSTT;
          break;
        case 'socket':
          STTInstance = RecordererSTT;
          break;
        default:
          break;
      }

      if (!STTInstance) return;

      sttInstance.current = new STTInstance({
        onRecognized: onMyRecognized,
        sttParams: options,
      });

      sttInstance.current.on('inited', () => {
        setRecordingStatus('stopping');
      });

      sttInstance.current.on('connecting', () => {
        setRecordingStatus('connecting');
      });

      sttInstance.current.on('recording', () => {
        setRecordingStatus('recording');
      });

      sttInstance.current.on('disconnected', () => {
        setRecordingStatus('stopping');
      });
      sttInstance.current.on('error', () => {
        setRecordingStatus('error');
      });

      sttInstance.current.initConnect();
    };

    myGetSTTOpts().then((sttOpts: ISttOpts) => {
      init(sttOpts);
    });

    return () => {
      if (!sttInstance.current) {
        return;
      }
      sttInstance.current.disconnectToService();
      sttInstance.current.offAllEvent();
    };
  }, []);

  useEffect(() => {
    onStatus?.(recordingStatus);
  }, [onStatus, recordingStatus]);

  const renderIcon = () => {
    if (isError) {
      return <AndtIcon type="icon-yuyin" className={classNames(styles.btnIcon, styles.disabled)} />;
    }

    if (isConnecting) {
      return (
        <>
          <AndtIcon
            type="icon-yuyin"
            className={classNames(styles.btnIcon, styles.disabled)}
            style={{ cursor: 'not-allowed' }}
          />
          <div className="loadingio-spinner-eclipse-block">
            <LoadingOutlined style={{ fontSize: 20 }} />
          </div>
        </>
      );
    }

    if (isRecording) {
      return <RecordingIcon classname={styles.recordingIcon} />;
    }

    if (isStopping) {
      return <AndtIcon type="icon-yuyin" className={classNames(styles.btnIcon, styles.mic)} />;
    }

    return null;
  };

  return (
    <div
      className={`${styles.sttCompWrapper}`}
      onClick={debounce(async () => {
        if (isError && sttInstance.current) {
          setRecordingStatus('connecting');

          setTimeout(() => {
            sttInstance.current
              .initConnect()
              .then(() => {
                sttInstance.current.connectToService();
              })
              .catch((e: any) => {
                message.destroy();
                message.error(e);
                setRecordingStatus('error');
              });
          }, CONNECT_DELAY);
        }

        if (isRecording) {
          stop();
        }
        if (isStopping) {
          start();
        }
      }, 300)}
    >
      <Tooltip
        title={
          <>
            {isRecording && intl.formatMessage({ id: 'common.stopInput' })}
            {isConnecting && intl.formatMessage({ id: 'common.connecting' })}
            {isStopping && intl.formatMessage({ id: 'common.startVoiceInput' })}
            {isError && intl.formatMessage({ id: 'common.reconnect' })}
          </>
        }
      >
        {renderIcon()}
      </Tooltip>
    </div>
  );
}

export default React.forwardRef(STTComp);
