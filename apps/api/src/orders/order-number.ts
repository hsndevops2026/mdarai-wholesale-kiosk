import type { Tx } from '../core/prisma.service';

/** Business day (YYYYMMDD) in the store's timezone. */
export function businessDay(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}${get('month')}${get('day')}`;
}

/** Allocate the next order number, e.g. W-20261022-0042, atomically inside the order transaction. */
export async function nextOrderNumber(tx: Tx, prefix: string, timeZone: string, now = new Date()): Promise<string> {
  const day = businessDay(now, timeZone);
  const rows = await tx.$queryRaw<Array<{ value: number }>>`
    INSERT INTO "DailyCounter" ("day", "value") VALUES (${day}, 1)
    ON CONFLICT ("day") DO UPDATE SET "value" = "DailyCounter"."value" + 1
    RETURNING "value"`;
  return `${prefix}-${day}-${String(rows[0].value).padStart(4, '0')}`;
}
