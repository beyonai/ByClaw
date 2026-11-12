import Recorder from 'recorder-core';
import 'recorder-core/src/engine/pcm';
import { getMicrophoneAudioContext, openMicrophone } from './microphone';
import type { VoiceStreamProtocol } from './voiceStreamProtocol';

interface Callbacks {
  onTranscript(text: string): void;
  onLevel(power: number): void;
  onConnecting(): void;
  onRecording(): void;
  onFinishing(): void;
  onComplete(): void;
  onError(error: unknown): void;
}

export class StreamSTT {
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
  constructor(private readonly protocol: VoiceStreamProtocol, private readonly callbacks: Callbacks) {}

  connectToService() {
    const capture = new AbortController();
    this.capture = capture;
    void this.connect(capture);
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
      this.callbacks.onConnecting();
      const socket = new WebSocket(this.protocol.url);
      this.socket = socket;
      socket.binaryType = 'arraybuffer';
      this.timer = window.setTimeout(() => this.fail('voice.dictationConnectionTimeout'), 10000);
      socket.onopen = () => {
        if (this.socket !== socket) return;
        if (this.protocol.authenticate) this.send(this.protocol.authenticate);
        else this.startCapture(capture, stream);
      };
      socket.onmessage = ({ data }) => {
        if (this.socket !== socket) return;
        try {
          const { ready, text, final } = this.protocol.receive(data);
          if (ready) this.startCapture(capture, stream);
          if (text !== undefined) this.callbacks.onTranscript(text);
          if (final) this.callbacks.onComplete();
        } catch {
          this.fail('voice.dictationInvalidResponse');
        }
      };
      socket.onerror = socket.onclose = () => this.fail(this.connectionErrorId());
    } catch (error) {
      if (!capture.signal.aborted) this.fail(this.stream ? 'voice.dictationConnectionFailed' : error);
    }
  }

  private send(data: string | ArrayBuffer): boolean {
    try {
      if (this.socket?.readyState !== WebSocket.OPEN) throw new Error();
      this.socket.send(data);
      return true;
    } catch {
      this.fail('voice.dictationAudioSendFailed');
      return false;
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
        onProcess: (_buffers: unknown, power: number) => this.callbacks.onLevel(power),
        takeoffEncodeChunk: (bytes: Uint8Array) => this.sendChunk(bytes),
      });
      this.recorder = recorder;
      recorder.open(
        () => {
          if (capture.signal.aborted) return;
          window.clearTimeout(this.timer);
          recorder.start();
          // 给音频队列和结束帧留出时间，避免撞到服务端的 60 秒会话上限。
          this.timer = window.setTimeout(() => this.pauseToService(), 58000);
          this.callbacks.onRecording();
        },
        () => this.fail('voice.microphoneUnavailable')
      );
    } catch {
      this.fail('voice.microphoneUnavailable');
    }
  }

  private sendChunk(bytes: Uint8Array) {
    if (this.finishing) return;
    const audio = new Uint8Array(this.audio.length + bytes.length);
    audio.set(this.audio);
    audio.set(bytes, this.audio.length);
    const { frameBytes } = this.protocol;
    let offset = 0;
    for (; offset + frameBytes <= audio.length; offset += frameBytes) {
      this.frames.push(audio.subarray(offset, offset + frameBytes));
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
    const delay =
      this.lastFrameAt === undefined ? 0 : this.protocol.frameInterval - (performance.now() - this.lastFrameAt);
    if (delay > 0) {
      this.frameTimer = window.setTimeout(() => {
        this.frameTimer = undefined;
        this.drainFrames();
      }, Math.ceil(delay));
      return;
    }
    try {
      const frame = this.frames.shift();
      if (!frame && this.firstFrame) {
        this.callbacks.onComplete();
        return;
      }
      this.endSent = !frame;
      const payload = this.protocol.encode(frame, this.firstFrame, this.endSent);
      this.firstFrame = false;
      if (!this.send(payload)) return;
      this.lastFrameAt = performance.now();
      if (this.endSent) this.timer = window.setTimeout(() => this.fail('voice.dictationResultTimeout'), 5000);
      else this.drainFrames();
    } catch {
      this.fail('voice.dictationAudioSendFailed');
    }
  }

  private connectionErrorId() {
    if (this.finishing) return 'voice.dictationResultInterrupted';
    return this.recorder ? 'voice.dictationDisconnected' : 'voice.dictationConnectionFailed';
  }

  private fail(error: unknown) {
    if (this.capture?.signal.aborted) return;
    this.disconnectToService();
    this.callbacks.onError(error);
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
    this.callbacks.onFinishing();
    this.drainFrames();
    return true;
  }
}
