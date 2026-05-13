let queue = [];
let isFlushing = false;
let timer = null;

let url = '';
let header = {};

const MAX_BATCH_SIZE = 10;
const FLUSH_INTERVAL = 5000; // 5秒批量发送一次

// 批量发送函数
const flushQueue = async () => {
  console.log('flushQueue', queue);
  if (queue.length === 0 || isFlushing) return;

  isFlushing = true;
  const batch = queue.slice(0, MAX_BATCH_SIZE);
  queue = queue.slice(MAX_BATCH_SIZE);

  console.log('batch', batch, url);

  let payload = '';
  try {
    payload = JSON.stringify({
      trackLogs: batch,
    });
  } catch (error) {
    console.error(error);
  }

  console.log(payload);
  if (!payload) return;
  try {
    // const blob = new Blob([JSON.stringify(payload)], {
    //   type: 'application/json',
    // });

    // 使用sendBeacon，即使页面关闭也能发送
    // const success = navigator.sendBeacon(url, blob);

    // if (!success) {
    // 降级为fetch
    await fetch(url, {
      method: 'POST',
      body: payload,
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        ...header,
      },
    });
    // }

    console.log(`发送了 ${batch.length} 条埋点数据`);
  } catch (error) {
    console.error('埋点发送失败:', error);
    // 失败后重新加入队列
    queue = [...batch, ...queue];
  } finally {
    isFlushing = false;
    // if (queue.length > 0) {
    //   setTimeout(flushQueue, 1000);
    // }
  }
};

// 定时批量发送
timer = setInterval(flushQueue, FLUSH_INTERVAL);

// 初始化完成后，发送READY消息
self.postMessage({ type: 'READY' });

// 监听主线程消息
self.addEventListener('message', (e) => {
  const { type, data } = e.data;

  switch (type) {
    case 'setUrl':
      url = data;
      break;
    case 'setHeader':
      header = data;
      break;
    case 'track':
      queue.push({
        ...data,
        timestamp: Date.now(),
        url: self.location.href,
        userAgent: navigator.userAgent,
        platform: 'PC',
      });
      console.log('track queue', queue);
      // 队列满了立即发送
      if (queue.length >= MAX_BATCH_SIZE) {
        flushQueue();
      }
      break;

    case 'flush':
      flushQueue();
      clearInterval(timer);
      break;

    case 'clear':
      queue = [];
      break;
  }
});
