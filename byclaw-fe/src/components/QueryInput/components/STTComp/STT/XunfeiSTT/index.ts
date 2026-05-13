import loadjs from 'loadjs';
import { getRuntimeActualUrl } from '@/utils';
import CryptoJS from 'crypto-js';
// @ts-ignore
import { getIntl } from '@umijs/max';

import BaseSTTHandler, { IRecognizedVal } from '../BaseSTTHandler';
import { decryptBySM } from '@/utils/encrypt/sm';

import RecorderManager from './typescript';

// 声明 window 上的 RecorderManager 和 MozWebSocket 类型
// 解决 TS 报错: 类型“Window & typeof globalThis”上不存在属性“RecorderManager”
declare global {
  interface Window {
    RecorderManager?: typeof RecorderManager;
    MozWebSocket?: typeof WebSocket;
  }
}

const SOCKET_HTTP_URL = `${window.location.protocol.includes('https') ? 'wss' : 'ws'}://iat-api.xfyun.cn/v2/iat`;

function toBase64(buffer: ArrayBuffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

interface IProps {
  onRecognized: (text: IRecognizedVal) => void;
  sttParams: {
    id: string;
    secret: string;
    key: string;
  };
}

class XunfeiSTT extends BaseSTTHandler<IProps> {
  mediaRecorder: null | RecorderManager = null;

  socket: WebSocket | null = null;

  xunfeiParams: Record<string, string> = {
    APPID: '',
    API_SECRET: '',
    API_KEY: '',
  };

  constructor(props: IProps) {
    super(props);

    this.xunfeiParams = {
      APPID: decryptBySM(props?.sttParams?.id || ''),
      API_SECRET: decryptBySM(props?.sttParams?.secret || ''),
      API_KEY: decryptBySM(props?.sttParams?.key || ''),
    };
  }

  initQueue(): Array<Promise<unknown>> {
    return [this.loadSTTBundle(), this.getMicrophones()];
  }

  loadSTTBundle(): Promise<void> {
    if (window.RecorderManager) return Promise.resolve();

    return loadjs(
      [getRuntimeActualUrl('js/xunfei/crypto-js.js'), getRuntimeActualUrl('js/xunfei/index.umd.js')],
      'XunfeiSdkUrl',
      {
        async: true,
      }
    ) as any;
  }

  waitForRecorderManager() {
    return new Promise((resolve) => {
      const loop = () => {
        setTimeout(() => {
          if (window.RecorderManager) {
            resolve(true);
          } else {
            loop();
          }
        }, 500);
      };
      loop();
    });
  }

  async initConnect() {
    try {
      await Promise.all(this.initQueue());

      await this.waitForRecorderManager();

      if (window.RecorderManager) {
        this.mediaRecorder = new window.RecorderManager(getRuntimeActualUrl('js/xunfei'));

        if (!this.mediaRecorder) return;

        this.mediaRecorder.onStart = () => {
          this.dispatch('recording');
        };
        this.mediaRecorder.onStop = () => {
          this.dispatch('disconnected');
        };
        this.mediaRecorder.onFrameRecorded = ({ isLastFrame, frameBuffer }) => {
          if (this.socket && this.socket.readyState === this.socket.OPEN) {
            this.socket.send(
              JSON.stringify({
                data: {
                  status: isLastFrame ? 2 : 1,
                  format: 'audio/L16;rate=16000',
                  encoding: 'raw',
                  audio: toBase64(frameBuffer),
                },
              })
            );
            if (isLastFrame) {
              this.socket.send(JSON.stringify({ action: 'end' }));
            }
          }
        };

        this.dispatch('inited');
        console.log('加载讯飞语音识别库成功');
      }
    } catch (e) {
      console.error(e);
      this.dispatch('error');
    }
  }

  getWebSocketUrl() {
    // 请求地址根据语种不同变化
    let url = SOCKET_HTTP_URL;
    const { host } = new URL(SOCKET_HTTP_URL);
    const apiKey = this.xunfeiParams.API_KEY;
    const apiSecret = this.xunfeiParams.API_SECRET;
    const date = new Date().toUTCString();
    const algorithm = 'hmac-sha256';
    const headers = 'host date request-line';
    const signatureOrigin = `host: ${host}\ndate: ${date}\nGET /v2/iat HTTP/1.1`;
    const signatureSha = CryptoJS.HmacSHA256(signatureOrigin, apiSecret);
    const signature = CryptoJS.enc.Base64.stringify(signatureSha);
    const authorizationOrigin = `api_key="${apiKey}", algorithm="${algorithm}", headers="${headers}", signature="${signature}"`;
    const authorization = btoa(authorizationOrigin);
    url = `${url}?authorization=${authorization}&date=${date}&host=${host}`;
    return url;
  }

  socketConnect() {
    const websocketUrl = this.getWebSocketUrl();
    if ('WebSocket' in window) {
      this.socket = new WebSocket(websocketUrl);
    } else if ('MozWebSocket' in window) {
      this.socket = new window.MozWebSocket(websocketUrl);
    }

    this.dispatch('connecting');

    return new Promise<boolean>((resolve, reject) => {
      if (!this.socket) {
        const intl = getIntl();
        const errorMsg = intl.formatMessage({ id: 'common.browserNotSupportWebSocket' });
        console.error(errorMsg);
        this.dispatch('error');
        reject(new Error(errorMsg));
        return;
      }

      this.socket.onopen = () => {
        // 开始录音
        this.mediaRecorder?.start({
          sampleRate: 16000,
          frameSize: 1280,
        });
        const params = {
          common: {
            app_id: this.xunfeiParams.APPID,
          },
          business: {
            language: 'zh_cn',
            domain: 'iat',
            accent: 'mandarin',
            vad_eos: 9999999, // ms
            // dwa: 'wpgs',
          },
          data: {
            status: 0,
            format: 'audio/L16;rate=16000',
            encoding: 'raw',
          },
        };

        this.socket?.send(JSON.stringify(params));
        this.dispatch('recording');

        resolve(true);
      };
      this.socket.onmessage = (e) => {
        this.renderResult(e.data);
      };
      this.socket.onerror = (e) => {
        console.error(e);
        this.mediaRecorder?.stop();
        this.dispatch('error');

        reject();
      };
      this.socket.onclose = (e) => {
        console.log(e);
        this.mediaRecorder?.stop();
        this.dispatch('disconnected');

        reject();
      };
    });
  }

  renderResult(resultData: any) {
    const { onRecognized } = this.props;

    // 识别结束
    const jsonData = JSON.parse(resultData);
    if (jsonData.data && jsonData.data.result) {
      const data = jsonData.data.result;
      let str = '';
      const { ws } = data;
      for (let i = 0; i < ws.length; i += 1) {
        str += ws[i].cw[0].w;
      }

      if (str && jsonData.code === 0 && jsonData.data.status !== 2) {
        onRecognized?.(str);
      }
    }

    if (jsonData.code === 0 && jsonData.data.status === 2) {
      this.socket?.close();
    }
    if (jsonData.code !== 0) {
      this.socket?.close();
      console.error(jsonData);
    }
  }

  connectToService() {
    this.socketConnect();
    return true;
  }

  disconnectToService() {
    this.mediaRecorder?.stop();
    this.socket?.close();
    this.socket = null;
    return true;
  }

  pauseToService() {
    this.mediaRecorder?.stop();
    return true;
  }
}

export default XunfeiSTT;
