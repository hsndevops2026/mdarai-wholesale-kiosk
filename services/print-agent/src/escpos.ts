/**
 * Minimal ESC/POS encoder: init, raster image (GS v 0), feed, partial cut.
 * Raster is sent in bands so printers with small buffers do not choke.
 */
const ESC = 0x1b;
const GS = 0x1d;
const BAND_ROWS = 256;

/** Pack RGBA pixels into 1-bit rows (1 = black), MSB first. */
export function toMonochrome(rgba: Uint8ClampedArray, width: number, height: number, threshold = 160): { bytesPerRow: number; bits: Buffer } {
  const bytesPerRow = Math.ceil(width / 8);
  const bits = Buffer.alloc(bytesPerRow * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = rgba[i + 3] / 255;
      const lum = (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) * a + 255 * (1 - a);
      if (lum < threshold) bits[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { bytesPerRow, bits };
}

export function encodeRaster(rgba: Uint8ClampedArray, width: number, height: number, opts: { cut?: boolean } = {}): Buffer {
  const { bytesPerRow, bits } = toMonochrome(rgba, width, height);
  const parts: Buffer[] = [Buffer.from([ESC, 0x40])]; // initialize
  for (let y0 = 0; y0 < height; y0 += BAND_ROWS) {
    const rows = Math.min(BAND_ROWS, height - y0);
    parts.push(Buffer.from([GS, 0x76, 0x30, 0x00, bytesPerRow & 0xff, bytesPerRow >> 8, rows & 0xff, rows >> 8]));
    parts.push(bits.subarray(y0 * bytesPerRow, (y0 + rows) * bytesPerRow));
  }
  parts.push(Buffer.from([ESC, 0x64, 0x04])); // feed 4 lines
  if (opts.cut !== false) parts.push(Buffer.from([GS, 0x56, 0x42, 0x00])); // feed + partial cut
  return Buffer.concat(parts);
}
