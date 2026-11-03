import RFB from './core/rfb.js';
const screen = document.getElementById('screen');
const status = document.getElementById('status');
let rfb;
function connect() {
  if (rfb) rfb.disconnect();
  screen.replaceChildren();
  const ws = new URL('./websockify', window.location.href);
  ws.search = '';
  const sessionIds = new URLSearchParams(window.location.search).getAll('sessionId');
  if (sessionIds.length > 1 || (sessionIds.length === 1 && !sessionIds[0])) {
    status.textContent = '无效的桌面会话';
    return;
  }
  if (sessionIds[0]) ws.searchParams.set('sessionId', sessionIds[0]);
  ws.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  status.textContent = '连接中…';
  rfb = new RFB(screen, ws.toString(), { shared: true });
  rfb.scaleViewport = true;
  rfb.resizeSession = true;
  rfb.addEventListener('connect', () => { status.textContent = '已连接'; rfb.focus(); });
  rfb.addEventListener('disconnect', () => { status.textContent = '连接已断开，请重新连接'; });
  rfb.addEventListener('securityfailure', () => { status.textContent = '桌面认证失败'; });
}
document.getElementById('reconnect').addEventListener('click', connect);
document.getElementById('paste').addEventListener('click', () => {
  const text = window.prompt('输入要发送到远程桌面的文本');
  if (rfb && text !== null) rfb.clipboardPasteFrom(text);
});
connect();
