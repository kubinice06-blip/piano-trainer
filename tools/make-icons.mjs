/* 產生 PWA 圖示。沒有外部相依 —— 直接畫像素再用 zlib 包成 PNG。
   重新產生：node tools/make-icons.mjs */

import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../icons");

const INK   = [0x0E, 0x2A, 0x33];
const BRASS = [0xC8, 0x91, 0x2F];
const EMBER = [0xB4, 0x46, 0x2F];
const PAPER = [0xF6, 0xF1, 0xE4];

function png(width, height, rgba){
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++){
    raw[y * (width * 4 + 1)] = 0;                       // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, {level: 9})),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++){
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf){
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return c ^ -1;
}

/* 五線譜 + 一顆黃銅音符頭。maskable 版把圖形縮進安全區內。 */
function draw(size, maskable){
  const buf = Buffer.alloc(size * size * 4);
  const px = (x, y, c, a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    const na = a / 255, ia = 1 - na;
    buf[i]   = Math.round(c[0] * na + buf[i]   * ia);
    buf[i+1] = Math.round(c[1] * na + buf[i+1] * ia);
    buf[i+2] = Math.round(c[2] * na + buf[i+2] * ia);
    buf[i+3] = 255;
  };
  const rect = (x0, y0, w, h, c) => {
    for (let y = Math.round(y0); y < Math.round(y0 + h); y++)
      for (let x = Math.round(x0); x < Math.round(x0 + w); x++) px(x, y, c);
  };
  const ellipse = (cx, cy, rx, ry, c, tilt = 0) => {
    for (let y = Math.floor(cy - ry - 2); y <= Math.ceil(cy + ry + 2); y++)
      for (let x = Math.floor(cx - rx - 2); x <= Math.ceil(cx + rx + 2); x++){
        const dx = x - cx, dy = y - cy;
        const rxp = dx * Math.cos(tilt) + dy * Math.sin(tilt);
        const ryp = -dx * Math.sin(tilt) + dy * Math.cos(tilt);
        const d = (rxp * rxp) / (rx * rx) + (ryp * ryp) / (ry * ry);
        if (d <= 1) px(x, y, c);
        else if (d <= 1.25) px(x, y, c, 120);            // 粗略的邊緣柔化
      }
  };

  rect(0, 0, size, size, INK);

  // maskable 圖示外圍會被裁掉，所以內容縮到中央 ~64%
  const s = maskable ? size * 0.64 : size * 0.82;
  const ox = (size - s) / 2, oy = (size - s) / 2;

  // 五線譜
  const gap = s / 9;
  const lineW = Math.max(1, Math.round(s / 64));
  for (let i = 0; i < 5; i++){
    rect(ox, oy + s * 0.26 + i * gap, s, lineW, BRASS);
  }

  // 一顆落在第三線的音符：符頭 + 符桿
  const cy = oy + s * 0.26 + 2 * gap + lineW / 2;
  const cx = ox + s * 0.36;
  const rx = gap * 0.72, ry = gap * 0.52;
  ellipse(cx, cy, rx, ry, PAPER, -0.34);
  rect(cx + rx * 0.72, cy - gap * 3.1, Math.max(1, Math.round(s / 52)), gap * 3.1, PAPER);

  // 拍點：招牌的紅色重拍格
  const bw = s * 0.13, bh = s * 0.055, by = oy + s * 0.80;
  for (let i = 0; i < 4; i++){
    rect(ox + s * 0.10 + i * (bw + s * 0.035), by, bw, bh, i === 0 ? EMBER : BRASS);
  }

  return png(size, size, buf);
}

fs.mkdirSync(OUT, {recursive: true});
const jobs = [[180, false], [192, false], [512, false]];
for (const [size, mask] of jobs){
  const f = path.join(OUT, `icon-${size}.png`);
  fs.writeFileSync(f, draw(size, mask));
  console.log("寫出", path.basename(f), fs.statSync(f).size, "bytes");
}
fs.writeFileSync(path.join(OUT, "icon-512-maskable.png"), draw(512, true));
console.log("寫出 icon-512-maskable.png",
            fs.statSync(path.join(OUT, "icon-512-maskable.png")).size, "bytes");
