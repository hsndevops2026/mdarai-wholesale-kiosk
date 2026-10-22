import { createCanvas, GlobalFonts, type SKRSContext2D } from '@napi-rs/canvas';
import path from 'node:path';
import type { RenderedSlip, SlipItem, SlipPayload } from './types';

let fontsLoaded = false;
function loadFonts() {
  if (fontsLoaded) return;
  const dir = path.join(__dirname, '..', 'fonts');
  GlobalFonts.registerFromPath(path.join(dir, 'NotoSansArabic-Variable.ttf'), 'SlipArabic');
  GlobalFonts.registerFromPath(path.join(dir, 'NotoSansHebrew-Variable.ttf'), 'SlipHebrew');
  fontsLoaded = true;
}

const FONT = (px: number, bold = false) => `${bold ? 'bold ' : ''}${px}px SlipArabic, SlipHebrew, sans-serif`;

export function unitText(i: Pick<SlipItem, 'unit' | 'pieceLabel'>): string {
  return i.unit === 'carton' ? 'كرتونة' : (i.pieceLabel ?? 'قطعة');
}

function formatDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
}

/** Plain-text version (simulated printer, logs, stdout mode). */
export function slipText(job: SlipPayload, storeName: string, timeZone: string): string {
  const o = job.order;
  const lines = [
    storeName,
    'ورقة تحضير طلبية',
    ...(job.kind === 'REPRINT' ? ['*** نسخة إعادة طباعة ***'] : []),
    `رقم الطلبية: ${o.orderNumber}`,
    `التاريخ: ${formatDate(o.createdAt, timeZone)}`,
    `الزبون: ${o.customer.code} — ${o.customer.businessName}`,
    '-'.repeat(32),
  ];
  for (const i of o.items) {
    lines.push(`[ ] ${i.quantity} × ${unitText(i)}  ${i.nameAr}`);
    if (i.nameHe) lines.push(`    ${i.nameHe}`);
    lines.push(`    ${[[i.aisle, i.shelf].filter(Boolean).join('-'), i.sku, i.unit === 'carton' ? `الكرتونة ${i.piecesPerCarton} قطعة` : null].filter(Boolean).join(' | ')}`);
  }
  lines.push('-'.repeat(32), summaryLine(o.items), 'حضّر: ________   فحص: ________');
  return lines.join('\n') + '\n';
}

function summaryLine(items: SlipItem[]): string {
  const cartons = items.filter((i) => i.unit === 'carton').reduce((n, i) => n + i.quantity, 0);
  const pieces = items.filter((i) => i.unit === 'piece').reduce((n, i) => n + i.quantity, 0);
  return `أصناف: ${items.length} · كراتين: ${cartons} · قطع: ${pieces}`;
}

function wrap(ctx: SKRSContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > maxWidth && line) {
      out.push(line);
      line = w;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

/**
 * Render the picking slip as an image. Printing an image (ESC/POS raster)
 * works on any thermal printer, including ones without Arabic/Hebrew fonts.
 */
export function renderSlip(job: SlipPayload, opts: { width: number; storeName: string; timeZone: string }): RenderedSlip {
  loadFonts();
  const W = opts.width;
  const M = Math.round(W * 0.03);
  const right = W - M;
  const canvas = createCanvas(W, 6000);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, 6000);
  ctx.fillStyle = '#000';
  ctx.direction = 'rtl';
  ctx.textBaseline = 'top';
  let y = M;
  const s = W / 576; // scale fonts for 58 mm paper

  const text = (t: string, px: number, opt: { bold?: boolean; align?: 'right' | 'center' | 'left'; gap?: number } = {}) => {
    ctx.font = FONT(Math.round(px * s), opt.bold);
    ctx.textAlign = opt.align ?? 'right';
    const x = opt.align === 'center' ? W / 2 : opt.align === 'left' ? M : right;
    for (const line of wrap(ctx, t, W - 2 * M)) {
      ctx.fillText(line, x, y);
      y += Math.round(px * s * 1.45);
    }
    y += opt.gap ?? 0;
  };
  const rule = (thick = 2) => {
    ctx.fillRect(M, y, W - 2 * M, thick);
    y += thick + Math.round(10 * s);
  };

  const o = job.order;
  text(opts.storeName, 26, { align: 'center' });
  text('ورقة تحضير طلبية', 30, { bold: true, align: 'center', gap: 4 });
  if (job.kind === 'REPRINT') {
    const pad = Math.round(10 * s);
    const h = Math.round(28 * s * 1.45) + 2 * pad;
    ctx.fillRect(M, y, W - 2 * M, h);
    ctx.fillStyle = '#fff';
    y += pad;
    text('نسخة إعادة طباعة', 28, { bold: true, align: 'center' });
    ctx.fillStyle = '#000';
    y += pad + Math.round(8 * s);
  }
  ctx.direction = 'ltr';
  text(o.orderNumber, 48, { bold: true, align: 'center', gap: 4 });
  ctx.direction = 'rtl';
  text(formatDate(o.createdAt, opts.timeZone), 24, { align: 'center' });
  text(`${o.customer.code} — ${o.customer.businessName}`, 28, { bold: true, gap: 6 });
  rule(4);

  for (const i of o.items) {
    // checkbox for the picker
    const box = Math.round(34 * s);
    ctx.lineWidth = 3;
    ctx.strokeRect(right - box, y + 4, box, box);
    const saveRight = right;
    ctx.font = FONT(Math.round(40 * s), true);
    ctx.textAlign = 'right';
    ctx.fillText(`${i.quantity} × ${unitText(i)}`, saveRight - box - Math.round(14 * s), y);
    y += Math.round(40 * s * 1.4);
    text(i.nameAr, 30, { bold: true });
    if (i.nameHe) text(i.nameHe, 26);
    // Latin codes (location, SKU) and Arabic text are drawn separately so bidi never reorders them.
    const lineH = Math.round(26 * s * 1.45);
    ctx.font = FONT(Math.round(26 * s), true);
    ctx.direction = 'ltr';
    ctx.textAlign = 'left';
    const loc = [i.aisle, i.shelf].filter(Boolean).join('-');
    ctx.fillText(loc ? `${loc}   ${i.sku}` : i.sku, M, y);
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    ctx.font = FONT(Math.round(24 * s));
    if (i.unit === 'carton') ctx.fillText(`الكرتونة ${i.piecesPerCarton} قطعة`, right, y);
    y += lineH + 4;
    rule(1);
  }
  text(summaryLine(o.items), 26, { bold: true, gap: 10 });
  text('حضّر: ____________   فحص: ____________', 24, { gap: 30 });

  const height = Math.ceil(y / 8) * 8;
  const out = createCanvas(W, height);
  out.getContext('2d').drawImage(canvas, 0, 0);
  const img = out.getContext('2d').getImageData(0, 0, W, height);
  return { width: W, height, rgba: img.data, png: out.toBuffer('image/png'), text: slipText(job, opts.storeName, opts.timeZone) };
}
