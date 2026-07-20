/* eslint-disable lines-around-comment */
// 一体化录制投屏(Phase 1+2):录制中显示目标页画面 + 在画面上直接操作。
// Phase 1:轮询 client.screenshot() 拿 base64 jpeg 刷新 <img>(目标页始终在扩展真 tab,这里只投屏)。
// Phase 2:在画面上监听鼠标/键盘 → 坐标换算成页面像素 → client.sendInput() 经 CDP Input.* 回传真 tab。
// 真 tab 仍是逃生口(投屏异常或想直接操作时切过去)。
import { useEffect, useRef, useState, useCallback } from 'react';
import { Typography, theme } from 'antd';
import { getRecorderClient } from '../services/recorderClient';

const { Text } = Typography;

const POLL_MS = 800; // 空闲轮询截图间隔(Phase 3 真截屏流可消除此延迟)
const ACTIVE_POLL_MS = 180; // 交互期(滚动/拖拽)临时升频,让画面跟手
const ACTIVE_WINDOW_MS = 1200; // 最后一次交互后维持升频的时长,之后回落 POLL_MS
const JPEG_QUALITY = 55;

// CDP Input key 事件需要 windowsVirtualKeyCode 等;这里只覆盖最常用键,文本输入走 insertText。
function keyEventParams(e: React.KeyboardEvent, type: 'keyDown' | 'keyUp'): Record<string, unknown> {
  return {
    type,
    key: e.key,
    code: e.code,
    windowsVirtualKeyCode: e.keyCode || undefined,
    nativeVirtualKeyCode: e.keyCode || undefined,
  };
}

interface Props {
  /** 画面自然尺寸未知时的展示宽度(px);坐标换算用 img 实际渲染尺寸 vs 自然尺寸的比例。 */
  height?: number;
}

export default function LivePreview({ height = 360 }: Props) {
  const { token } = theme.useToken();
  const client = useRef(getRecorderClient()).current;
  const imgRef = useRef<HTMLImageElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string>('');
  const [err, setErr] = useState<string>('');
  const [interactive, setInteractive] = useState(false);
  const interactiveRef = useRef(false);
  const [lastCoord, setLastCoord] = useState<string>('');
  const dragging = useRef(false);
  // 交互活跃窗口:滚动/拖拽时刷新到 now+ACTIVE_WINDOW_MS,轮询据此在升频/空闲间切换。
  const activeUntil = useRef(0);
  const bumpActive = useCallback(() => {
    activeUntil.current = Date.now() + ACTIVE_WINDOW_MS;
  }, []);
  // interactive 的 ref 镜像(给原生事件监听用,避免闭包捕获旧值)。
  interactiveRef.current = interactive;

  // 轮询截图刷新。组件挂载即开始,卸载停。交互期(activeUntil 未过)用 ACTIVE_POLL_MS 升频,否则 POLL_MS。
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (!alive) return;
      const res = await client.screenshot(JPEG_QUALITY);
      if (!alive) return;
      if (res.ok && res.data?.data) {
        setSrc(`data:image/jpeg;base64,${res.data.data}`);
        setErr('');
      } else if (!res.ok) {
        setErr(res.error?.message || '截图失败');
      }
      const next = Date.now() < activeUntil.current ? ACTIVE_POLL_MS : POLL_MS;
      timer = setTimeout(tick, next);
    };
    tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [client]);

  // canvas 坐标(渲染像素)→ 页面 CSS 像素。
  // ⚠️ objectFit:contain 会留黑边(letterbox):图片实际渲染区 ≤ rect,按宽高比居中。
  // 必须先算出图片在 rect 内的真实显示区(displayed box),再映射,否则点击落点整体偏移。
  // 截图是「CSS 视口 × dpr」(Retina=2),naturalWidth 是设备像素;Input 要 CSS 像素 → ÷ dpr。
  const toPageCoords = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    const img = imgRef.current;
    if (!img || !img.naturalWidth) return null;
    const rect = img.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    // contain:按 min(缩放比) 居中;算出实际显示区尺寸 + 黑边偏移。
    const scale = Math.min(rect.width / img.naturalWidth, rect.height / img.naturalHeight);
    const dispW = img.naturalWidth * scale;
    const dispH = img.naturalHeight * scale;
    const offX = (rect.width - dispW) / 2;
    const offY = (rect.height - dispH) / 2;
    const relX = clientX - rect.left - offX;
    const relY = clientY - rect.top - offY;
    if (relX < 0 || relY < 0 || relX > dispW || relY > dispH) return null; // 点在黑边外,忽略
    // relX/dispW = 图片内归一坐标;× naturalWidth = 设备像素;÷ dpr = CSS 像素。
    return {
      x: Math.round(((relX / dispW) * img.naturalWidth) / dpr),
      y: Math.round(((relY / dispH) * img.naturalHeight) / dpr),
    };
  }, []);

  const dispatchMouse = useCallback(
    (type: string, e: React.MouseEvent) => {
      if (!interactive) return;
      const p = toPageCoords(e.clientX, e.clientY);
      if (!p) return;
      if (type !== 'mouseMoved') setLastCoord(`${type} @ ${p.x},${p.y}`);
      bumpActive(); // 点击/拖拽也进入升频窗口,让画面更快反映变化
      client
        .sendInput('Input.dispatchMouseEvent', {
          type,
          x: p.x,
          y: p.y,
          button: 'left',
          buttons: type === 'mousePressed' ? 1 : 0,
          clickCount: 1,
        })
        .then((r) => {
          if (!r.ok) setErr(`输入失败:${r.error?.message || r.error?.code || '未知'}`);
        });
    },
    [client, interactive, toPageCoords, bumpActive]
  );

  // 滚轮转发:用**原生非 passive** 监听(React onWheel 是 passive,preventDefault 无效且会连带滚 dashboard)。
  // CDP Input.dispatchMouseEvent type:'mouseWheel' 带 deltaX/Y,在光标处滚动目标页。
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    // 按帧合并:连续 wheel 的 delta 累积进 pending,rAF 里一次性发一条 synthesizeScrollGesture。
    // 否则一次滚动手势打出几十条 CDP 指令堆在 daemon 串行处理,既加剧卡顿又浪费。
    let raf = 0;
    let accDx = 0,
      accDy = 0;
    let lastP: { x: number; y: number } | null = null;
    const flush = () => {
      raf = 0;
      const p = lastP;
      const dx = Math.round(accDx),
        dy = Math.round(accDy);
      accDx = 0;
      accDy = 0;
      if (!p || (dx === 0 && dy === 0)) return;
      setLastCoord(`scroll Δ${dy} @ ${p.x},${p.y}`);
      // synthesizeScrollGesture 真正驱动滚动(mouseWheel 只发事件、很多页面不响应)。
      // CDP yDistance 正=向上,故取 deltaY 的负值(deltaY>0=向下滚)。
      // gestureSourceType:'mouse' 必须显式给——默认 'default' 在桌面 Chrome 可能落到 touch 合成,
      // 部分页面(无 touch 滚动监听)对 touch 手势不滚动,这是「事件链全通但页面不滚」的常见根因。
      client
        .sendInput('Input.synthesizeScrollGesture', {
          x: p.x,
          y: p.y,
          xDistance: -dx,
          yDistance: -dy,
          gestureSourceType: 'mouse',
          speed: 3000,
        })
        .then((r) => {
          if (!r.ok) setErr(`滚动失败:${r.error?.message || r.error?.code || '未知'}`);
        });
    };
    const handler = (e: WheelEvent) => {
      if (!interactiveRef.current) return;
      e.preventDefault();
      const p = toPageCoords(e.clientX, e.clientY);
      if (!p) return;
      // 触控板/鼠标 delta 常很小,放大若干倍才看得见滚动。
      const factor = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 800 : 4;
      accDy += e.deltaY * factor;
      accDx += e.deltaX * factor;
      lastP = p;
      bumpActive(); // 进入交互升频窗口
      if (!raf) raf = requestAnimationFrame(flush);
    };
    box.addEventListener('wheel', handler, { passive: false });
    return () => {
      box.removeEventListener('wheel', handler);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [client, toPageCoords, bumpActive]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!interactive) return;
      e.preventDefault();
      // 可打印单字符走 insertText(覆盖输入法/大小写);其余(Enter/Backspace/方向键等)走 dispatchKeyEvent。
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        void client.sendInput('Input.insertText', { text: e.key });
      } else {
        void client.sendInput('Input.dispatchKeyEvent', keyEventParams(e, 'keyDown'));
      }
    },
    [client, interactive]
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          目标页投屏{interactive ? '·可操作' : '·只读'}
          {lastCoord ? ` · ${lastCoord}` : ''}
        </Text>
        <Text
          style={{ fontSize: 12, cursor: 'pointer', color: interactive ? token.colorWarning : token.colorPrimary }}
          onClick={() => setInteractive((v) => !v)}
        >
          {interactive ? '■ 关闭操作' : '▶ 在画面上操作'}
        </Text>
      </div>
      <div
        ref={boxRef}
        tabIndex={interactive ? 0 : -1}
        onKeyDown={onKeyDown}
        style={{
          position: 'relative',
          width: '100%',
          height: `min(${height}px, 72vh)`,
          overflow: 'hidden',
          border: `1px solid ${interactive ? token.colorWarning : token.colorBorder}`,
          borderRadius: token.borderRadius,
          background: '#000',
          cursor: interactive ? 'crosshair' : 'default',
          outline: 'none',
        }}
      >
        {src ? (
          <img
            ref={imgRef}
            src={src}
            alt="目标页投屏"
            draggable={false}
            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
            onMouseDown={(e) => {
              dragging.current = true;
              dispatchMouse('mousePressed', e);
            }}
            onMouseUp={(e) => {
              dragging.current = false;
              dispatchMouse('mouseReleased', e);
            }}
            onMouseMove={(e) => {
              if (dragging.current) dispatchMouse('mouseMoved', e);
            }}
          />
        ) : (
          <div
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#888' }}
          >
            {err ? `投屏不可用:${err}` : '加载画面…'}
          </div>
        )}
      </div>
      <Text type="secondary" style={{ fontSize: 11 }}>
        画面每 {POLL_MS}ms 刷新一帧;复杂操作可切到 byCLI 标签页(录制在真 tab 正常进行)。
      </Text>
    </div>
  );
}
