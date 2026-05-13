// @ts-nocheck
/* author:caibaojian
website:http://caibaojian.com
weibo:http:weibo.com/kujian
兼容UC竖屏转横屏出现的BUG
自定义设计稿的宽度：designWidth
最大宽度:maxWidth
这段js的最后面有两个参数记得要设置，一个为设计稿实际宽度，一个为制作稿最大宽度，例如设计稿为750，最大宽度为750，则为(750,750) */

const flexibleStyleId = 'flexibleStyle';

export default function flexible(designWidth: number, maxWidth: number, minWidth: number) {
  const doc = document;
  const win = window;
  const docEl = doc.documentElement;
  const remStyle = document.createElement('style');
  let tid: NodeJS.Timeout;

  function refreshRem() {
    let { width } = docEl.getBoundingClientRect();
    if (width > maxWidth) {
      width = maxWidth;
    }
    if (width < minWidth) {
      width = minWidth;
    }
    remStyle.id = flexibleStyleId;
    remStyle.innerHTML = `html{font-size:${100}px;}`;
  }

  if (docEl.firstElementChild) {
    docEl.firstElementChild.appendChild(remStyle);
  } else {
    let wrap = doc.createElement('div');
    wrap.appendChild(remStyle);
    doc.write(wrap.innerHTML);
    wrap = null as unknown as HTMLDivElement;
  }
  // 要等 wiewport 设置好后才能执行 refreshRem，不然 refreshRem 会执行2次；
  refreshRem();

  win.addEventListener(
    'resize',
    () => {
      clearTimeout(tid); // 防止执行两次
      tid = setTimeout(refreshRem, 300);
    },
    false
  );

  win.addEventListener(
    'pageshow',
    (e) => {
      if (e.persisted) {
        // 浏览器后退的时候重新计算
        clearTimeout(tid);
        tid = setTimeout(refreshRem, 300);
      }
    },
    false
  );

  if (doc.readyState === 'complete') {
    doc.body.style.fontSize = '16px';
  } else {
    doc.addEventListener(
      'DOMContentLoaded',
      () => {
        doc.body.style.fontSize = '16px';
      },
      false
    );
  }
}
