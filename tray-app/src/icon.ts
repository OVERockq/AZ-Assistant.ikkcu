/**
 * Pure Node.js PNG generator (no external deps)
 * Produces a 22×22 RGBA PNG tray icon at runtime.
 */
import * as zlib from "zlib";

// ─── CRC32 ────────────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
    }
    t[i] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (CRC_TABLE[(crc ^ buf[i]) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.allocUnsafe(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.allocUnsafe(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

// ─── PNG Builder ──────────────────────────────────────────────────────────────
/**
 * Returns a 22×22 RGBA PNG Buffer.
 *  - macOS  : white circle (setTemplateImage → adapts dark/light mode)
 *  - others : blue circle  (#4A90E2)
 */
export function createTrayIconBuffer(): Buffer {
  const SIZE = 22;
  const IS_MAC = process.platform === "darwin";

  // Color
  const R = IS_MAC ? 0 : 74;
  const G = IS_MAC ? 0 : 144;
  const B = IS_MAC ? 0 : 226;

  // Raw RGBA scanlines: filter-byte + SIZE×4 channels
  const rowStride = 1 + SIZE * 4;
  const raw = Buffer.alloc(rowStride * SIZE, 0); // all transparent

  const cx = SIZE / 2 - 0.5;
  const cy = SIZE / 2 - 0.5;
  const outerR = SIZE / 2 - 1.5; // circle radius
  const innerCx = cx - 1;        // slight "A" hint: inner cutout
  const innerCy = cy + 1;
  const innerR = outerR * 0.45;

  for (let y = 0; y < SIZE; y++) {
    raw[y * rowStride] = 0; // filter: None
    for (let x = 0; x < SIZE; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Outer circle with 1-px anti-alias edge
      let alpha = 0;
      if (dist < outerR - 1) {
        alpha = 255;
      } else if (dist < outerR) {
        alpha = Math.round((outerR - dist) * 255);
      }

      // Inner cutout (gives an "O" ring look → distinctive tray icon)
      const dxi = x - innerCx;
      const dyi = y - innerCy;
      const dInner = Math.sqrt(dxi * dxi + dyi * dyi);
      if (dInner < innerR - 0.5) alpha = 0;
      else if (dInner < innerR) alpha = Math.round((dInner - (innerR - 1)) * 255);

      if (alpha > 0) {
        const off = y * rowStride + 1 + x * 4;
        raw[off] = R;
        raw[off + 1] = G;
        raw[off + 2] = B;
        raw[off + 3] = alpha;
      }
    }
  }

  const compressed = zlib.deflateSync(raw, { level: 6 });

  // IHDR (color type 6 = RGBA)
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
