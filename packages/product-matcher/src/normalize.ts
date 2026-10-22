/**
 * Text normalisation for Palestinian Arabic, Hebrew and Latin product text.
 * Both catalog data and customer input go through the same functions so that
 * spelling variants (أ/ا, ة/ه, final Hebrew letters, niqqud...) compare equal.
 */

const ARABIC_DIACRITICS = /[ً-ٰٟۖ-ۭـ]/g;
const HEBREW_NIQQUD = /[֑-ׇ]/g;
const HEBREW_FINALS: Record<string, string> = { ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' };
const ARABIC_LETTER_MAP: Record<string, string> = {
  أ: 'ا',
  إ: 'ا',
  آ: 'ا',
  ٱ: 'ا',
  ى: 'ي',
  ة: 'ه',
  ؤ: 'و',
  ئ: 'ي',
  ک: 'ك',
  ی: 'ي',
};

const HEBREW_TO_ARABIC: Record<string, string> = {
  א: 'ا', ב: 'ب', ג: 'ج', ד: 'د', ה: 'ه', ו: 'و', ז: 'ز', ח: 'ح', ט: 'ط', י: 'ي', כ: 'ك',
  ל: 'ل', מ: 'م', נ: 'ن', ס: 'س', ע: 'ع', פ: 'ف', צ: 'ص', ק: 'ق', ר: 'ر', ש: 'ش', ת: 'ت',
};

export function toAsciiDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, '.')
    .replace(/٪/g, '%');
}

/** Normalise a full string: case, diacritics, letter variants, digits, punctuation. */
export function normalizeText(input: string): string {
  let s = toAsciiDigits(input.normalize('NFC')).toLowerCase();
  s = s.replace(ARABIC_DIACRITICS, '').replace(HEBREW_NIQQUD, '');
  s = s.replace(/[أإآٱىةؤئکی]/g, (c) => ARABIC_LETTER_MAP[c] ?? c);
  s = s.replace(/[ךםןףץ]/g, (c) => HEBREW_FINALS[c] ?? c);
  s = s.replace(/[׳״'"`]/g, '');
  // keep decimal points between digits and the percent sign; everything else separates tokens
  s = s.replace(/(\d)\.(\d)/g, '$1\u0000$2');
  s = s.replace(/[^\p{L}\p{N}%\u0000]+/gu, ' ');
  s = s.replace(/\u0000/g, '.');
  // "3 %" -> "3%"
  s = s.replace(/(\d)\s+%/g, '$1%');
  return s.replace(/\s+/g, ' ').trim();
}

export function tokenize(input: string): string[] {
  const n = normalizeText(input);
  return n ? n.split(' ') : [];
}

export function isHebrew(token: string): boolean {
  return /[א-ת]/.test(token);
}

export function isArabic(token: string): boolean {
  return /[ء-ي]/.test(token);
}

export function transliterateHebrewToArabic(token: string): string {
  return [...token].map((c) => HEBREW_TO_ARABIC[c] ?? c).join('');
}

const AR_PREFIXES = ['وال', 'بال', 'فال', 'كال', 'لل', 'ال'];
const HE_PREFIXES = ['וה', 'שה', 'ה'];

/**
 * Surface variants of a token: the token itself plus forms without a
 * definite-article/conjunction prefix (only when enough letters remain).
 */
export function tokenVariants(token: string): string[] {
  const out = new Set([token]);
  if (isArabic(token)) {
    for (const p of AR_PREFIXES) {
      if (token.startsWith(p) && token.length - p.length >= 3) {
        out.add(token.slice(p.length));
        break;
      }
    }
  } else if (isHebrew(token)) {
    for (const p of HE_PREFIXES) {
      if (token.startsWith(p) && token.length - p.length >= 3) {
        out.add(token.slice(p.length));
        break;
      }
    }
  }
  return [...out];
}
