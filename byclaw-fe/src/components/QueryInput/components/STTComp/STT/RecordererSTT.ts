/* eslint-disable */
import {} from 'lodash';

import Recorder from 'recorder-core';
import 'recorder-core/src/engine/pcm.js';

import BaseSTTHandler from './BaseSTTHandler';
import { getASRWebSocketUrl } from '@/constants/websocket';

// 使用Nginx代理的WebSocket地址
const SOCKET_HTTP_URL = getASRWebSocketUrl();

interface IProps {
  properWord?: string[];
}

class RecordererSTT extends BaseSTTHandler<IProps> {
  mediaRecorder: null | MediaRecorder = null;

  previousStartTime: number = -1;

  socket: WebSocket | null = null;

  curRecorder: any = null;

  // 新增缓存区用于分包
  _pcmCache: Uint8Array = new Uint8Array(0);

  createRecorder() {
    const sampleRate = 16000;
    // 新增缓存区用于分包
    this._pcmCache = new Uint8Array(0);

    // Int16Array 转 Uint8Array
    function int16ToBytes(int16Arr: Int16Array): Uint8Array {
      const bytes = new Uint8Array(int16Arr.length * 2);
      for (let i = 0; i < int16Arr.length; i += 1) {
        bytes[i * 2] = int16Arr[i] & 0xff;
        bytes[i * 2 + 1] = (int16Arr[i] >> 8) & 0xff;
      }
      return bytes;
    }

    return new Promise((resolve, reject) => {
      /**调用open打开录音请求好录音权限**/
      this.curRecorder = Recorder({
        //本配置参数请参考下面的文档，有详细介绍
        type: 'pcm',
        sampleRate,
        bitRate: 16, //mp3格式，指定采样率hz、比特率kbps
        onProcess: (
          buffers: any[],
          powerLevel: number,
          bufferDuration: number,
          bufferSampleRate: number,
          newBufferIdx: number
        ) => {
          //录音实时回调，大约1秒调用12次本回调，buffers为开始到现在的所有录音pcm数据块(16位小端LE)
          //可利用extensions/sonic.js插件实时变速变调，此插件计算量巨大，onProcess需要返回true开启异步模式
          //可实时上传（发送）数据，配合Recorder.SampleData方法，将buffers中的新数据连续的转换成pcm上传，或使用mock方法将新数据连续的转码成其他格式上传，可以参考文档里面的：Demo片段列表 -> 实时转码并上传-通用版；基于本功能可以做到：实时转发数据、实时保存数据、实时语音识别（ASR）等
          // 只处理新采集到的 buffer，避免重复
          const newBuffers = buffers.slice(newBufferIdx);
          if (newBuffers.length === 0) return;
          let pcmData: Int16Array = Recorder.SampleData(newBuffers, bufferSampleRate, 16000).data;
          let bytes = int16ToBytes(pcmData);

          // 合并到缓存
          let cache = new Uint8Array(this._pcmCache.length + bytes.length);
          cache.set(this._pcmCache, 0);
          cache.set(bytes, this._pcmCache.length);
          this._pcmCache = cache;

          // 每4096字节发一包
          while (this._pcmCache.length >= 4096) {
            let chunk = this._pcmCache.slice(0, 4096);
            this.sendToBackend(chunk);
            this._pcmCache = this._pcmCache.slice(4096);
          }
        },
      });

      this.curRecorder.open(
        () => {
          //打开麦克风授权获得相关资源
          resolve(true);
        },
        (msg: string, isUserNotAllow: boolean) => {
          //用户拒绝未授权或不支持
          console.error((isUserNotAllow ? 'UserNotAllow，' : '') + '无法录音:' + msg);

          reject();
        }
      );
    });
  }

  async startRecording() {
    if (!this.curRecorder) {
      await Promise.all(this.initQueue());
    }

    this.socketConnect().then(() => {
      this.curRecorder.start();
      this.dispatch('recording');
    });
  }

  stopRecording() {
    if (this.curRecorder) {
      this.curRecorder.stop();
    }
  }

  sendToBackend(data: Uint8Array) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      // 只发送有效部分，避免发送多余内容
      this.socket.send(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    }
  }

  initQueue(): Array<Promise<unknown>> {
    return [
      this.createRecorder(),
    ];
  }

  socketConnect() {
    if (this.socket) {
      return Promise.resolve(true);
    }
    const { onRecognized } = this.props;

    const socketUrl = SOCKET_HTTP_URL;

    return new Promise((resolve, reject) => {
      const socket: WebSocket = new WebSocket(socketUrl);

      socket.onopen = () => {
        console.log('Connected to the server');
        this.socket = socket;

        this.dispatch('recording');

        resolve(true);
      };
      socket.onmessage = (e) => {
        console.log('Message from server:', e.data, e);
        const strRes = e.data;

        if ('Connection successful. You can start sending audio data.' === strRes) {
          return;
        }

        if (strRes) {
          onRecognized(strRes);
        }
      };
      socket.onerror = () => {
        console.log('socket error');
        this.dispatch('error');

        reject();
      };
      socket.onclose = () => {
        console.log('socket close');
        this.disconnectToService();
        this.dispatch('disconnected');

        reject();
      };
    });
  }

  connectToService() {
    this.startRecording();

    return true;
  }

  disconnectToService() {
    this.stopRecording();

    this.socket?.close();
    this.socket = null;

    this.curRecorder?.close();
    this.curRecorder = null;

    return true;
  }

  pauseToService() {
    this.stopRecording();

    return true;
  }
}

export default RecordererSTT;
