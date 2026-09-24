// アプリアイコン（PNG）を生成する。依存なしで動くよう最小限のPNGエンコーダを内蔵している
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [0x25, 0x63, 0xeb];
const CARD_BACK = [0xbf, 0xd4, 0xff];
const CARD = [0xff, 0xff, 0xff];
const LINE = [0x25, 0x63, 0xeb];

function roundedRect(x, y, cx, cy, w, h, r) {
  const dx = Math.max(Math.abs(x - cx) - (w / 2 - r), 0);
  const dy = Math.max(Math.abs(y - cy) - (h / 2 - r), 0);
  return Math.hypot(dx, dy) <= r;
}

function rotate(x, y, cx, cy, deg) {
  const t = (deg * Math.PI) / 180;
  const ux = x - cx;
  const uy = y - cy;
  return [cx + ux * Math.cos(t) - uy * Math.sin(t), cy + ux * Math.sin(t) + uy * Math.cos(t)];
}

function pixel(u, v) {
  // u, v は 0〜1 の正規化座標
  const [bx, by] = rotate(u, v, 0.55, 0.47, 10);
  const [fx, fy] = rotate(u, v, 0.47, 0.53, -6);
  if (roundedRect(fx, fy, 0.47, 0.53, 0.5, 0.36, 0.05)) {
    const onLine = (ly, len) => Math.abs(fy - ly) < 0.018 && fx > 0.3 && fx < 0.3 + len;
    if (onLine(0.47, 0.3) || onLine(0.55, 0.22) || onLine(0.63, 0.26)) return LINE;
    return CARD;
  }
  if (roundedRect(bx, by, 0.55, 0.47, 0.5, 0.36, 0.05)) return CARD_BACK;
  return BG;
}

function png(size) {
  const ss = 4; // スーパーサンプリングでふちを滑らかにする
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = pixel((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size);
          acc[0] += c[0];
          acc[1] += c[1];
          acc[2] += c[2];
        }
      }
      const o = y * (size * 3 + 1) + 1 + x * 3;
      for (let i = 0; i < 3; i++) raw[o + i] = Math.round(acc[i] / (ss * ss));
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = new URL('../public/icons/', import.meta.url);
mkdirSync(out, { recursive: true });
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  writeFileSync(new URL(name, out), png(size));
}
console.log('icons written to public/icons/');
