// Minimal RGBA PNG encoder for the node harness.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const CRC = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC[n] = c >>> 0;
}
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function writePNG(path: string, rgba: Uint8ClampedArray, w: number, h: number): void {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  writeFileSync(path, Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', new Uint8Array(0))]));
}

/** Tile several RGBA images horizontally (same height). */
export function tile(imgs: { data: Uint8ClampedArray; w: number; h: number }[], gap = 4): { data: Uint8ClampedArray; w: number; h: number } {
  const h = Math.max(...imgs.map((i) => i.h));
  const w = imgs.reduce((a, i) => a + i.w, 0) + gap * (imgs.length - 1);
  const out = new Uint8ClampedArray(w * h * 4).fill(30);
  let ox = 0;
  for (const im of imgs) {
    for (let y = 0; y < im.h; y++) out.set(im.data.subarray(y * im.w * 4, (y + 1) * im.w * 4), (y * w + ox) * 4);
    ox += im.w + gap;
  }
  return { data: out, w, h };
}
