import { ArrowUpOutlined, CloseOutlined } from '@ant-design/icons';
import AntdIcon from '@/components/AntdIcon';
import { Button, message, Popover, Tooltip } from 'antd';
import { useEffect, useRef, useState } from 'react';
import Recorder from 'recorder-core';
import 'recorder-core/src/engine/mp3';
import 'recorder-core/src/engine/mp3-engine';
import styles from './index.module.less';

type Props = {
  disabled?: boolean;
  onActiveChange?: (active: boolean) => void;
  onRecorded: (file: File, durationMs: number) => Promise<void>;
};

type Status = 'idle' | 'opening' | 'recording' | 'ready' | 'sending';

export default function VoiceRecorder({ disabled, onRecorded, onActiveChange }: Props) {
  const recorderRef = useRef<any>(undefined);
  const aliveRef = useRef(true);
  const holdingRef = useRef(false);
  const statusRef = useRef<Status>('idle');
  const cancelRef = useRef(false);
  const startYRef = useRef(0);
  const onRecordedRef = useRef(onRecorded);
  onRecordedRef.current = onRecorded;
  const [mobile] = useState(() => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches);
  const pendingRef = useRef<{ file: File; durationMs: number } | undefined>(undefined);
  const [power, setPower] = useState(0);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [seconds, setSeconds] = useState(0);
  const [canceling, setCanceling] = useState(false);

  useEffect(() => {
    onActiveChange?.(status !== 'idle');
  }, [onActiveChange, status]);

  const updateStatus = (next: Status) => {
    statusRef.current = next;
    if (aliveRef.current) setStatus(next);
  };

  const closeRecorder = () => {
    recorderRef.current?.close();
    recorderRef.current = undefined;
  };

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      holdingRef.current = false;
      closeRecorder();
    };
  }, []);

  const sendRecording = async (file: File, durationMs: number) => {
    updateStatus('sending');
    try {
      await onRecordedRef.current(file, durationMs);
      pendingRef.current = undefined;
      if (aliveRef.current) setOpen(false);
      updateStatus('idle');
    } catch (error) {
      if (aliveRef.current) message.error(typeof error === 'string' ? error : '语音发送失败，请重试');
      updateStatus('ready');
    }
  };

  const finishRecording = (send: boolean) => {
    if (!recorderRef.current || statusRef.current !== 'recording') return;
    updateStatus('sending');
    recorderRef.current.stop(
      async (blob: Blob, durationMs: number) => {
        closeRecorder();
        if (!aliveRef.current) return;
        if (durationMs < 500) {
          message.warning('录音时间太短，请重新录制');
          updateStatus('idle');
          return;
        }
        const file = new File([blob], `voice-${Date.now()}.mp3`, { type: 'audio/mpeg' });
        pendingRef.current = { file, durationMs };
        if (send) await sendRecording(file, durationMs);
        else updateStatus('ready');
      },
      () => {
        closeRecorder();
        if (aliveRef.current) message.error('录音失败，请重试');
        updateStatus('idle');
      }
    );
  };

  const finish = (send: boolean) => {
    holdingRef.current = false;
    if (statusRef.current === 'opening') {
      if (!send) {
        closeRecorder();
        updateStatus('idle');
      }
      return;
    }
    if (statusRef.current === 'sending') return;
    if (!send || cancelRef.current) {
      closeRecorder();
      pendingRef.current = undefined;
      updateStatus('idle');
      setCanceling(false);
      return;
    }
    if (statusRef.current === 'ready' && pendingRef.current) {
      void sendRecording(pendingRef.current.file, pendingRef.current.durationMs);
      return;
    }
    finishRecording(true);
  };

  useEffect(() => {
    if (status !== 'recording') return;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    const limit = window.setTimeout(() => {
      holdingRef.current = false;
      if (mobile) finish(true);
      else finishRecording(false);
    }, 60000);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(limit);
    };
  }, [status]);

  const start = () => {
    if (disabled || statusRef.current !== 'idle') return;
    holdingRef.current = true;
    cancelRef.current = false;
    setCanceling(false);
    updateStatus('opening');
    const recorder = Recorder({
      type: 'mp3',
      sampleRate: 16000,
      bitRate: 32,
      onProcess: (_buffers: unknown, level: number) => {
        if (aliveRef.current) setPower(level);
      },
    });
    recorderRef.current = recorder;
    recorder.open(
      () => {
        if (recorderRef.current !== recorder) {
          recorder.close();
          return;
        }
        if (!aliveRef.current || !holdingRef.current) {
          recorder.close();
          recorderRef.current = undefined;
          updateStatus('idle');
          return;
        }
        recorder.start();
        setSeconds(0);
        setPower(0);
        updateStatus('recording');
      },
      () => {
        closeRecorder();
        if (aliveRef.current) message.error('无法使用麦克风，请检查浏览器录音权限');
        updateStatus('idle');
      }
    );
  };

  let recordingHint = '按住说话，松开发送';
  if (status === 'sending') recordingHint = '正在发送语音…';
  else if (canceling) recordingHint = '松开取消';
  else if (status === 'recording') recordingHint = '松开发送，上滑取消';

  const microphone = (
    <Tooltip title="发语音">
      <Button
        type="text"
        aria-label="发语音"
        aria-pressed={open || status !== 'idle'}
        className={styles.recordButton}
        disabled={disabled}
        onClick={mobile ? undefined : start}
        icon={<AntdIcon type="icon-yuyin" />}
      />
    </Tooltip>
  );

  if (!mobile) {
    if (status === 'idle') return microphone;
    return (
      <div className={styles.desktopBar} role="group" aria-label="语音录制">
        <Button
          type="text"
          size="small"
          aria-label="取消语音"
          className={styles.cancelButton}
          icon={<CloseOutlined />}
          disabled={status === 'sending'}
          onClick={() => finish(false)}
        />
        <div className={styles.waveform} aria-hidden="true">
          {[0.3, 0.55, 0.8, 0.45, 1, 0.6, 0.9, 0.5, 0.75, 0.4, 0.65, 0.35].map((weight, index) => (
            <span key={index} style={{ height: `${Math.max(3, weight * (5 + power * 0.28))}px` }} />
          ))}
        </div>
        <span className={styles.desktopDuration} role="timer">
          {seconds}″
        </span>
        <Tooltip title={status === 'ready' ? '发送语音' : '结束录音并发送'}>
          <Button
            type="primary"
            shape="circle"
            size="small"
            aria-label="发送语音"
            className={styles.sendButton}
            icon={<ArrowUpOutlined />}
            loading={status === 'opening' || status === 'sending'}
            onClick={() => finish(true)}
          />
        </Tooltip>
      </div>
    );
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (statusRef.current === 'sending') return;
        if (!next) finish(false);
        setOpen(next);
      }}
      trigger="click"
      placement="topRight"
      content={
        <div className={styles.recordingPanel}>
          <div className={styles.recordingHint} role="status">
            {recordingHint}
          </div>
          <Button
            className={`${styles.holdButton} ${canceling ? styles.canceling : ''}`}
            type={status === 'recording' ? 'primary' : 'default'}
            disabled={disabled || status === 'sending'}
            loading={status === 'opening' || status === 'sending'}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.currentTarget.setPointerCapture?.(event.pointerId);
              startYRef.current = event.clientY;
              start();
            }}
            onPointerMove={(event) => {
              if (!holdingRef.current) return;
              cancelRef.current = startYRef.current - event.clientY > 60;
              setCanceling(cancelRef.current);
            }}
            onPointerUp={() => finish(true)}
            onPointerCancel={() => finish(false)}
            onKeyDown={(event) => {
              if (!['Enter', ' '].includes(event.key) || event.repeat) return;
              event.preventDefault();
              start();
            }}
            onKeyUp={(event) => {
              if (['Enter', ' '].includes(event.key)) {
                event.preventDefault();
                finish(true);
              }
            }}
            onBlur={() => finish(false)}
          >
            {status === 'recording' ? (
              <>
                <span className={styles.recordingDot} />
                <span role="timer">{seconds}″</span>
              </>
            ) : (
              '按住说话'
            )}
          </Button>
          <span className={styles.limitHint}>最长 60 秒</span>
        </div>
      }
    >
      {microphone}
    </Popover>
  );
}
