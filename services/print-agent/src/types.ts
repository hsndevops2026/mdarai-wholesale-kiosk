/** Mirrors apps/api/src/printing/print.service.ts SlipPayload. No prices by design. */
export interface SlipPayload {
  jobId: string;
  kind: 'AUTO' | 'REPRINT';
  attempt: number;
  order: {
    orderNumber: string;
    createdAt: string;
    customer: { code: string; name: string; businessName: string };
    items: SlipItem[];
  };
}

export interface SlipItem {
  sku: string;
  barcode: string | null;
  nameAr: string;
  nameHe: string | null;
  unit: 'piece' | 'carton';
  quantity: number;
  piecesPerCarton: number;
  pieceLabel: string | null;
  aisle: string | null;
  shelf: string | null;
}

export interface RenderedSlip {
  /** 1-bit-ready grayscale image as RGBA pixels. */
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  png: Buffer;
  text: string;
}
