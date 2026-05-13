import { get, isEmpty } from 'lodash';

import BaseSTTHandler, { IRecognizedVal } from './BaseSTTHandler';

const SOCKET_HTTP_URL = '';

type IMsg = {
  start_time: number;
  result: string;
};

interface IProps {
  onRecognized: (value: IRecognizedVal) => void;
  sttParams: {
    url: string;
  };
}

class SocketSTT extends BaseSTTHandler<IProps> {
  mediaRecorder: null | MediaRecorder = null;

  recordedChunks: any[] = [];

  previousStartTime: number = -1;

  socket: WebSocket | null = null;

  msgList: IMsg[] = [];

  url: string = '';

  constructor(props: IProps) {
    super(props);

    this.url = props?.sttParams?.url || SOCKET_HTTP_URL;
  }

  startRecording() {
    return new Promise((resolve, reject) => {
      if (!get(navigator, 'mediaDevices.getUserMedia')) {
        console.error('获取设备识失败');
        this.disconnectToService();
        reject();
      }

      navigator.mediaDevices
        .getUserMedia({
          audio: {
            deviceId: this.microphoneSource,
          },
        })
        .then((stream) => {
          this.mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
          this.mediaRecorder.onstart = () => {
            this.dispatch('recording');
            resolve(true);
          };
          this.mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) {
              this.recordedChunks.push(e.data);
              this.sendToBackend(e.data);
            }
          };
          this.mediaRecorder.start(1000);
        })
        .catch((err) => {
          console.error(err);
          reject();
          this.disconnectToService();
        });
    });
  }

  stopRecording() {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }

    this.msgList = [];
  }

  sendToBackend(data: any) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(data);
    }
  }

  initQueue(): Array<Promise<unknown>> {
    return [this.getMicrophones(), this.socketConnect()];
  }

  socketConnect() {
    this.disconnectToService();

    const { onRecognized } = this.props;

    if (!this.url) {
      return Promise.reject(new Error('missing socket url'));
    }

    return new Promise((resolve, reject) => {
      const socket: WebSocket = new WebSocket(this.url);

      socket.onopen = () => {
        console.log('Connected to the server');
        this.socket = socket;

        resolve(true);
      };
      socket.onmessage = (e) => {
        console.log('Message from server:', e);

        const { data } = e;

        if (isEmpty(data)) return;

        onRecognized(data);
      };
      socket.onerror = () => {
        console.error('socket error');
        this.dispatch('disconnected');

        this.disconnectToService();

        reject(new Error('socketConnect Error'));
      };
      socket.onclose = () => {
        console.error('socket close');
        this.dispatch('disconnected');

        this.disconnectToService();

        reject(new Error('socketConnect Close'));
      };
    });
  }

  connectToService() {
    this.startRecording();

    return true;
  }

  disconnectToService() {
    this.stopRecording();

    if (this.socket) {
      this.socket.close();
    }
    this.socket = null;
  }

  pauseToService() {
    this.stopRecording();

    return true;
  }
}

export default SocketSTT;
