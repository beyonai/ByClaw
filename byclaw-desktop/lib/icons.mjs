/**
 * 纯 Node 生成简单 PNG 图标（托盘用）：中心圆点 + 状态色
 * - green: Agent 在线
 * - red: Agent 离线
 * - yellow: 执行中
 */
import zlib from "node:zlib";

// ── CRC32 ─────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * 生成 n×n 中心实心圆 PNG
 * @param {number} size 边长（像素）
 * @param {[number,number,number]} rgb 颜色
 * @param {number} [pad] 圆距边缘留白比例
 */
export function makeDotIcon(size, rgb, pad = 0.18) {
  const [r, g, b] = rgb;
  const radius = (size / 2) * (1 - pad);
  const cx = size / 2;
  const cy = size / 2;

  // 抗锯齿：边缘 1px 渐变
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // filter: None
    for (let x = 0; x < size; x++) {
      const dist = Math.sqrt((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2);
      let alpha = 0;
      if (dist <= radius - 1) alpha = 255;
      else if (dist <= radius + 1) alpha = Math.round(255 * (radius + 1 - dist) / 2);
      const o = rowStart + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = alpha;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    PNG_SIG,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

export const STATUS_COLORS = {
  online: [46, 204, 113],
  offline: [231, 76, 60],
  busy: [241, 196, 15],
};
