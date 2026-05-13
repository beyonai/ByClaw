import { clearToken, loginRedirect } from '@/utils/auth';

class BeyondBroadcastChannel {
  private name: string;

  private channel: BroadcastChannel | null = null;

  constructor(name: string) {
    this.name = name;
  }

  /**
   * 初始化 BroadcastChannel 并监听消息
   */
  init() {
    // 检查浏览器是否支持 BroadcastChannel
    if (typeof BroadcastChannel === 'undefined') {
      console.warn('BroadcastChannel is not supported in this browser');
      return;
    }

    try {
      this.channel = new BroadcastChannel(this.name);

      // 监听消息事件
      this.channel.addEventListener('message', (event: MessageEvent) => {
        console.log('BroadcastChannel received message:', event.data);
        if (event.data.type === 'logout') {
          clearToken();
          loginRedirect();
        }
      });

      // 监听错误事件
      this.channel.addEventListener('messageerror', (event: MessageEvent) => {
        console.error('BroadcastChannel message error:', event);
      });
    } catch (error) {
      console.error('Failed to initialize BroadcastChannel:', error);
    }
  }

  /**
   * 发送消息到其他窗口/标签页
   * @param data 要发送的数据
   */
  postMessage(data: any) {
    if (this.channel) {
      try {
        this.channel.postMessage(data);
      } catch (error) {
        console.error('Failed to post message via BroadcastChannel:', error);
      }
    }
  }

  /**
   * 关闭 BroadcastChannel 连接
   */
  close() {
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
  }
}

const globalBroadcastChannel = new BeyondBroadcastChannel('beyond');

export default globalBroadcastChannel;
