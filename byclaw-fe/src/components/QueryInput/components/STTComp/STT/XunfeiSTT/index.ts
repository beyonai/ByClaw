import { decryptBySM } from '@/utils/encrypt/sm';
import CryptoJS from 'crypto-js';
import Recorder from 'recorder-core';
import 'recorder-core/src/engine/pcm';
import { getMicrophoneAudioContext, openMicrophone } from '../../../VoiceRecorder/microphone';
import BaseSTTHandler, { type IRecognizedVal } from '../BaseSTTHandler';

const SOCKET_URL = 'wss://iat-api.xfyun.cn/v2/iat';
const AUDIO_FORMAT = { format: 'audio/L16;rate=16000', encoding: 'raw' };
const FRAME_SIZE = 1280;
const FRAME_INTERVAL_MS = 40;
const STANDARD_ENDPOINT = 'wss://rtasr.xfyun.cn/v1/ws';
const END_FRAME = Uint8Array.from('{"end":true}', (character) => character.charCodeAt(0));

function toBase64(bytes: Uint8Array) {
  return window.btoa(String.fromCharCode(...bytes));
}

interface IProps {
  onRecognized: (text: IRecognizedVal) => void;
  onTranscript?: (text: string) => void;
  onComplete?: () => void;
  onLevel?: (power: number) => void;
  onFinishing?: () => void;
  sttParams:
    | { id: string; secret: string; key: string; protocol?: undefined }
    | { protocol: 'rtasr-standard-v1'; id: string; key: string; stream: string };
}

const STANDARD_ERROR_IDS: Record<string, string> = {
  '10105': 'voice.dictationAuthFailed',
  '10106': 'voice.dictationInvalidRequest',
  '10107': 'voice.dictationInvalidRequest',
  '10110': 'voice.dictationLicense',
  '10202': 'voice.dictationProviderConnection',
  '10204': 'voice.dictationProviderConnection',
  '10205': 'voice.dictationProviderConnection',
  '10700': 'voice.dictationProviderEngine',
  '10800': 'voice.dictationConcurrency',
  '16003': 'voice.dictationProviderEngine',
  '37005': 'voice.dictationNoAudio',
};

type StandardResult = {
  action: 'started' | 'result' | 'error';
  code: string | number;
  data?: string;
  desc?: string;
};
type StandardSegment = {
  seg_id?: number;
  cn?: { st?: { type?: string; rt?: { ws?: { cw?: { w?: string }[] }[] }[] } };
};

type Result = {
  code: number;
  data?: {
    status: number;
    result?: { sn?: number; pgs?: 'apd' | 'rpl'; rg?: [number, number]; ws?: { cw: { w: string }[] }[] };
  };
};

class XunfeiSTT extends BaseSTTHandler<IProps> {
  private readonly appId: string;
  private readonly apiSecret: string;
  private readonly apiKey: string;
  private readonly standard: boolean;
  private socket?: WebSocket;
  private capture?: AbortController;
  private stream?: MediaStream;
  private recorder?: ReturnType<typeof Recorder>;
  private timer?: number;
  private audio = new Uint8Array(0);
  private frames: Uint8Array<ArrayBuffer>[] = [];
  private frameTimer?: number;
  private lastFrameAt?: number;
  private firstFrame = true;
  private finishing = false;
  private endSent = false;
  private received = new Set<number>();
  private dictationSegments = new Map<number, string>();

  constructor(props: IProps) {
    super(props);
    this.appId = decryptBySM(props.sttParams?.id || '');
    this.standard = props.sttParams?.protocol === 'rtasr-standard-v1';
    this.apiSecret =
      props.sttParams?.protocol === 'rtasr-standard-v1' ? '' : decryptBySM(props.sttParams?.secret || '');
    this.apiKey = decryptBySM(props.sttParams?.key || '');
  }

  get configured() {
    if (this.props.sttParams?.protocol === 'rtasr-standard-v1') {
      return Boolean(this.appId && this.apiKey && this.props.sttParams.stream === STANDARD_ENDPOINT);
    }
    return Boolean(this.appId && this.apiSecret && this.apiKey);
  }

  async initConnect() {
    this.dispatch(this.configured ? 'inited' : 'error');
  }

  getWebSocketUrl() {
    const { sttParams } = this.props;
    if (sttParams.protocol === 'rtasr-standard-v1') {
      const url = new URL(sttParams.stream);
      const ts = String(Math.floor(Date.now() / 1000));
      const digest = CryptoJS.MD5(this.appId + ts).toString(CryptoJS.enc.Hex);
      const signa = CryptoJS.HmacSHA1(digest, this.apiKey).toString(CryptoJS.enc.Base64);
      url.search = new URLSearchParams({ appid: this.appId, ts, signa }).toString();
      return url.toString();
    }
    const url = new URL(SOCKET_URL);
    const { host } = url;
    const apiKey = this.apiKey;
    const apiSecret = this.apiSecret;
    const date = new Date().toUTCString();
    const algorithm = 'hmac-sha256';
    const headers = 'host date request-line';
    const signatureOrigin = `host: ${host}\ndate: ${date}\nGET /v2/iat HTTP/1.1`;
    const signatureSha = CryptoJS.HmacSHA256(signatureOrigin, apiSecret);
    const signature = CryptoJS.enc.Base64.stringify(signatureSha);
    const authorizationOrigin = `api_key="${apiKey}", algorithm="${algorithm}", headers="${headers}", signature="${signature}"`;
    const authorization = btoa(authorizationOrigin);
    url.search = new URLSearchParams({ authorization, date, host }).toString();
    return url.toString();
  }

  connectToService() {
    if (this.capture || !this.configured) return false;
    const capture = new AbortController();
    this.capture = capture;
    this.received.clear();
    this.dictationSegments.clear();
    this.firstFrame = true;
    this.lastFrameAt = undefined;
    this.finishing = false;
    this.endSent = false;
    void this.connect(capture);
    return true;
  }

  private async connect(capture: AbortController) {
    try {
      const stream = await openMicrophone(capture.signal, () => this.fail('voice.microphoneInterrupted'));
      if (!stream) return;
      if (capture.signal.aborted) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
      this.dispatch('connecting');
      const socket = new WebSocket(this.getWebSocketUrl());
      this.socket = socket;
      this.timer = window.setTimeout(() => this.fail('voice.dictationConnectionTimeout'), 10000);
      if (!this.standard) socket.onopen = () => this.startCapture(capture, stream);
      socket.onmessage = (event) => {
        if (process.env.NODE_ENV === 'development') {
          console.debug('[Xunfei WS] Response:', event.data);
        }
        this.renderResult(event.data);
      };
      socket.onerror = () => this.fail(this.connectionErrorId());
      socket.onclose = (event) => {
        if (this.standard && this.endSent && event.wasClean) this.complete();
        else this.fail(this.connectionErrorId());
      };
    } catch (error) {
      if (!capture.signal.aborted) this.fail(this.stream ? 'voice.dictationConnectionFailed' : error);
    }
  }

  private startCapture(capture: AbortController, stream: MediaStream) {
    if (capture.signal.aborted || this.recorder) return;
    try {
      const recorder = Recorder({
        type: 'pcm',
        sampleRate: 16000,
        bitRate: 16,
        sourceStream: stream,
        runningContext: getMicrophoneAudioContext(),
        onProcess: (_buffers: unknown, power: number) => this.props.onLevel?.(power),
        takeoffEncodeChunk: (bytes: Uint8Array) => this.sendChunk(bytes),
      });
      this.recorder = recorder;
      recorder.open(
        () => {
          if (capture.signal.aborted) return;
          window.clearTimeout(this.timer);
          recorder.start();
          // 给音频队列和结束帧留出时间，避免撞到服务端的 60 秒会话上限。
          if (!this.standard) this.timer = window.setTimeout(() => this.pauseToService(), 58000);
          this.dispatch('recording');
        },
        () => this.fail('voice.microphoneUnavailable')
      );
    } catch {
      this.fail('voice.microphoneUnavailable');
    }
  }

  private sendFrame(bytes: Uint8Array<ArrayBuffer>, end = false) {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    if (this.standard) {
      this.socket.send(end ? END_FRAME : bytes);
      this.lastFrameAt = performance.now();
      return;
    }
    const first = this.firstFrame;
    this.firstFrame = false;
    const data = { ...AUDIO_FORMAT, status: first ? 0 : end ? 2 : 1, audio: toBase64(bytes) };
    const frame = { data };
    if (first) {
      Object.assign(frame, {
        common: { app_id: this.appId },
        business: {
          language: 'zh_cn',
          domain: 'iat',
          accent: 'mandarin',
          eos: 10000,
          ...(this.props.onTranscript ? { dwa: 'wpgs' } : {}),
        },
      });
    }
    this.socket.send(JSON.stringify(frame));
    this.lastFrameAt = performance.now();
  }

  private sendChunk(bytes: Uint8Array) {
    if (this.finishing) return;
    const audio = new Uint8Array(this.audio.length + bytes.length);
    audio.set(this.audio);
    audio.set(bytes, this.audio.length);
    let offset = 0;
    for (; offset + FRAME_SIZE <= audio.length; offset += FRAME_SIZE) {
      this.frames.push(audio.subarray(offset, offset + FRAME_SIZE));
    }
    this.audio = audio.slice(offset);
    this.drainFrames();
  }

  private drainFrames() {
    if (
      this.socket?.readyState !== WebSocket.OPEN ||
      this.endSent ||
      this.frameTimer !== undefined ||
      (!this.frames.length && !this.finishing)
    )
      return;
    const delay = this.lastFrameAt === undefined ? 0 : FRAME_INTERVAL_MS - (performance.now() - this.lastFrameAt);
    if (delay > 0) {
      this.frameTimer = window.setTimeout(() => {
        this.frameTimer = undefined;
        this.drainFrames();
      }, Math.ceil(delay));
      return;
    }
    try {
      const frame = this.frames.shift();
      if (frame || (!this.standard && this.firstFrame)) {
        this.sendFrame(frame || new Uint8Array(0));
        this.drainFrames();
      } else {
        this.sendFrame(new Uint8Array(0), true);
        this.endSent = true;
        this.timer = window.setTimeout(() => this.fail('voice.dictationResultTimeout'), 5000);
      }
    } catch {
      this.fail('voice.dictationAudioSendFailed');
    }
  }

  private renderStandardResult(result: StandardResult) {
    const code = String(result.code);
    if (code !== '0' || result.action === 'error') {
      if (!/^[1-9]\d{0,7}$/.test(code)) {
        this.fail('voice.dictationInvalidResponse');
        return;
      }
      let errorId = STANDARD_ERROR_IDS[code] || 'voice.dictationProviderError';
      if (code === '10105' && typeof result.desc === 'string') {
        const detail = result.desc.trim().toLowerCase().split('|').pop()?.trim();
        if (detail === 'no appid info') errorId = 'voice.dictationAppNotFound';
        else if (detail?.startsWith('illegal client_ip')) errorId = 'voice.dictationIpDenied';
      }
      this.fail(errorId, code);
      return;
    }
    if (result.action === 'started' && this.capture && this.stream && !this.finishing) {
      this.startCapture(this.capture, this.stream);
    }
    if (result.action !== 'result' || typeof result.data !== 'string') return;
    const segment: StandardSegment = JSON.parse(result.data);
    const sentence = segment.cn?.st;
    if (sentence?.type !== '0') return;
    const words = sentence.rt
      ?.flatMap((part) => part.ws ?? [])
      .map((word) => word.cw?.[0]?.w ?? '')
      .join('');
    if (words && (segment.seg_id === undefined || !this.received.has(segment.seg_id))) {
      if (segment.seg_id !== undefined) this.received.add(segment.seg_id);
      this.props.onRecognized(words);
    }
  }

  renderResult(resultData: string) {
    let result: Result;
    try {
      if (this.standard) {
        this.renderStandardResult(JSON.parse(resultData));
        return;
      }
      result = JSON.parse(resultData);
      if (result.code !== 0) {
        this.fail();
        return;
      }
      const segment = result.data?.result;
      const words = segment?.ws?.map(({ cw }) => cw[0]?.w || '').join('');
      if (this.props.onTranscript && segment?.sn !== undefined) {
        const { sn, pgs, rg } = segment;
        if (!this.received.has(sn)) {
          this.received.add(sn);
          if (pgs === 'rpl' && rg) {
            const [first, last] = rg;
            for (const id of this.dictationSegments.keys()) {
              if (id >= first && id <= last) this.dictationSegments.delete(id);
            }
          }
          this.dictationSegments.set(sn, words || '');
          const transcript = [...this.dictationSegments]
            .sort(([a], [b]) => a - b)
            .map(([, text]) => text)
            .join('');
          this.props.onTranscript(transcript);
        }
      } else if (words && (segment?.sn === undefined || !this.received.has(segment.sn))) {
        if (segment?.sn !== undefined) this.received.add(segment.sn);
        this.props.onRecognized(words);
      }
    } catch {
      this.fail('voice.dictationInvalidResponse');
      return;
    }
    if (result.data?.status === 2) this.complete();
  }

  private complete() {
    this.disconnectToService();
    this.props.onComplete?.();
    this.dispatch('disconnected');
  }

  private connectionErrorId() {
    if (this.finishing) return 'voice.dictationResultInterrupted';
    return this.recorder ? 'voice.dictationDisconnected' : 'voice.dictationConnectionFailed';
  }

  private fail(error?: unknown, code?: string) {
    this.disconnectToService();
    this.dispatch('error', error, code);
  }

  disconnectToService() {
    window.clearTimeout(this.timer);
    this.capture?.abort();
    this.capture = undefined;
    this.closeMicrophone();
    this.audio = new Uint8Array(0);
    this.frames = [];
    window.clearTimeout(this.frameTimer);
    this.frameTimer = undefined;
    const socket = this.socket;
    this.socket = undefined;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
      socket.close();
    }
    return true;
  }

  private closeMicrophone() {
    this.recorder?.close();
    this.recorder = undefined;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
  }

  pauseToService() {
    if (this.finishing || !this.recorder || this.socket?.readyState !== WebSocket.OPEN) return false;
    this.finishing = true;
    this.closeMicrophone();
    window.clearTimeout(this.timer);
    if (this.audio.length) this.frames.push(this.audio);
    this.audio = new Uint8Array(0);
    this.props.onFinishing?.();
    this.drainFrames();
    return true;
  }
}

export default XunfeiSTT;
