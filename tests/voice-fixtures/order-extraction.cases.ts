/**
 * Text-level acceptance cases for ORDER EXTRACTION (transcript -> commands).
 * Transcription accuracy is measured separately against recorded audio
 * (see tests/voice-fixtures/README.md); these cases assume a correct transcript.
 *
 * expected: list of [intent, spoken_product contains, quantity, unit, new_unit?]
 */
export type ExpectedItem = [string, string | null, number | null, 'piece' | 'carton' | null, ('piece' | 'carton' | null)?];

export interface ExtractionCase {
  id: string;
  category: string;
  text: string;
  lastProduct?: string;
  expected: ExpectedItem[];
}

export const EXTRACTION_CASES: ExtractionCase[] = [
  { id: 'A01', category: 'multi-item', text: 'بدي خمس كراتين حليب تنوفا، وعشر قطع طحينة، وثلاث كراتين زيت.', expected: [['ADD_ITEM', 'حليب تنوفا', 5, 'carton'], ['ADD_ITEM', 'طحينة', 10, 'piece'], ['ADD_ITEM', 'زيت', 3, 'carton']] },
  { id: 'A02', category: 'mixed-he', text: 'بدي خمس كراتين חלב תנובה وثلاث كراتين زيت', expected: [['ADD_ITEM', 'חלב תנובה', 5, 'carton'], ['ADD_ITEM', 'زيت', 3, 'carton']] },
  { id: 'A03', category: 'multi-step', text: 'ضيف ثلاث كراتين زيت', expected: [['ADD_ITEM', 'زيت', 3, 'carton']] },
  { id: 'A04', category: 'set-quantity', text: 'خلي الحليب سبع كراتين بدل خمس', expected: [['SET_QUANTITY', 'الحليب', 7, 'carton']] },
  { id: 'A05', category: 'dual', text: 'اعطيني كرتونتين سكر وحبتين طحينة', expected: [['ADD_ITEM', 'سكر', 2, 'carton'], ['ADD_ITEM', 'طحينة', 2, 'piece']] },
  { id: 'A06', category: 'missing-qty', text: 'بدي حليب تنوفا', expected: [['ADD_ITEM', 'حليب تنوفا', null, null]] },
  { id: 'A07', category: 'missing-unit', text: 'بدي عشرة زيت ذرة', expected: [['ADD_ITEM', 'زيت ذرة', 10, null]] },
  { id: 'A08', category: 'implicit-one', text: 'وكرتونة رز بسمتي', expected: [['ADD_ITEM', 'رز بسمتي', 1, 'carton']] },
  { id: 'A09', category: 'remove', text: 'شيل الزيت', expected: [['REMOVE_ITEM', 'الزيت', null, null]] },
  { id: 'A10', category: 'remove', text: 'ما بدي الطحينة', expected: [['REMOVE_ITEM', 'الطحينة', null, null]] },
  { id: 'A11', category: 'decrease', text: 'شيل كرتونة حليب', expected: [['DECREASE_QUANTITY', 'حليب', 1, 'carton']] },
  { id: 'A12', category: 'decrease', text: 'نقص الزيت كرتونتين', expected: [['DECREASE_QUANTITY', 'الزيت', 2, 'carton']] },
  { id: 'A13', category: 'increase', text: 'زيد الحليب تلات كراتين', expected: [['INCREASE_QUANTITY', 'الحليب', 3, 'carton']] },
  { id: 'A14', category: 'pronoun', text: 'خليهم سبعة', lastProduct: 'حليب تنوفا', expected: [['SET_QUANTITY', 'حليب تنوفا', 7, null]] },
  { id: 'A15', category: 'change-unit', text: 'خلي الطحينة بالكرتونة', expected: [['CHANGE_UNIT', 'الطحينة', null, null, 'carton']] },
  { id: 'A16', category: 'total', text: 'قديش صار المجموع؟', expected: [['REQUEST_TOTAL', null, null, null]] },
  { id: 'A17', category: 'total', text: 'כמה יוצא הכל', expected: [['REQUEST_TOTAL', null, null, null]] },
  { id: 'A18', category: 'search', text: 'في عندك زيت كانولا؟', expected: [['SEARCH_PRODUCT', null, null, null]] },
  { id: 'A19', category: 'hebrew', text: 'אני רוצה שלושה קרטונים שמן קנולה', expected: [['ADD_ITEM', 'שמן קנולה', 3, 'carton']] },
  { id: 'A20', category: 'hebrew', text: 'תוסיף שני קרטונים טחינה ועשר יחידות במבה', expected: [['ADD_ITEM', 'טחינה', 2, 'carton'], ['ADD_ITEM', 'במבה', 10, 'piece']] },
  { id: 'A21', category: 'size', text: 'بدي خمس كراتين حليب تنوفا 1% 1 لتر', expected: [['ADD_ITEM', 'حليب تنوفا 1% 1 لتر', 5, 'carton']] },
  { id: 'A22', category: 'size', text: 'ضيف كرتونة زيت عباد الشمس 4 لتر', expected: [['ADD_ITEM', 'زيت عباد الشمس 4 لتر', 1, 'carton']] },
  { id: 'A23', category: 'digits', text: 'بدي 12 كرتونة كولا', expected: [['ADD_ITEM', 'كولا', 12, 'carton']] },
  { id: 'A24', category: 'arabic-digits', text: 'بدي ٢٠ قطعة شوكولاتة', expected: [['ADD_ITEM', 'شوكولاتة', 20, 'piece']] },
  { id: 'A25', category: 'compound-number', text: 'بدي خمسة وعشرين كرتونة مي', expected: [['ADD_ITEM', 'مي', 25, 'carton']] },
  { id: 'A26', category: 'product-first', text: 'حليب خمس كراتين وزيت تلات كراتين', expected: [['ADD_ITEM', 'حليب', 5, 'carton'], ['ADD_ITEM', 'زيت', 3, 'carton']] },
  { id: 'A27', category: 'no-conjunction', text: 'خمس كراتين حليب عشر قطع طحينة', expected: [['ADD_ITEM', 'حليب', 5, 'carton'], ['ADD_ITEM', 'طحينة', 10, 'piece']] },
  { id: 'A28', category: 'mixed-intents', text: 'ضيف كرتونة سكر وشيل الزيت', expected: [['ADD_ITEM', 'سكر', 1, 'carton'], ['REMOVE_ITEM', 'الزيت', null, null]] },
  { id: 'A29', category: 'fillers', text: 'يا عمو لو سمحت اعطيني تنتين كرتونة لبنة', expected: [['ADD_ITEM', 'لبنة', 2, 'carton']] },
  { id: 'A30', category: 'waw-product', text: 'بدي عشر قطع ورق ألمنيوم ووافل', expected: [['ADD_ITEM', 'ورق ألمنيوم', 10, 'piece'], ['ADD_ITEM', 'وافل', null, null]] },
  { id: 'A31', category: 'set-multi', text: 'خلي الحليب سبعة والزيت أربعة', expected: [['SET_QUANTITY', 'الحليب', 7, null], ['SET_QUANTITY', 'الزيت', 4, null]] },
  { id: 'A32', category: 'mixed-he', text: 'ضيف عشر كراتين מים ושש קרטונים קוקה קולה', expected: [['ADD_ITEM', 'מים', 10, 'carton'], ['ADD_ITEM', 'קוקה קולה', 6, 'carton']] },
  { id: 'A33', category: 'price-question', text: 'قديش سعر الطحينة', expected: [['SEARCH_PRODUCT', null, null, null]] },
  { id: 'A34', category: 'hebrew-remove', text: 'תוריד את הקולה', expected: [['REMOVE_ITEM', 'הקולה', null, null]] },
];
