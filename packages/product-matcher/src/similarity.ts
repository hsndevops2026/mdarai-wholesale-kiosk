export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  let prev = new Array<number>(bl + 1);
  let cur = new Array<number>(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    cur[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= bl; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[bl];
}

/**
 * Similarity in [0,1] between two normalised tokens. Short tokens must match
 * exactly ("زيت" must not match "زيتون"); longer ones tolerate 1-2 edits.
 * Numeric tokens (sizes like "1.5", "3%") always require an exact match.
 */
export function tokenSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (/\d/.test(a) || /\d/.test(b)) return 0;
  const maxLen = Math.max(a.length, b.length);
  const minLen = Math.min(a.length, b.length);
  if (minLen <= 3) return 0;
  const allowed = maxLen >= 7 ? 2 : 1;
  if (maxLen - minLen > allowed) return 0;
  const d = levenshtein(a, b);
  if (d > allowed) return 0;
  return 1 - d / maxLen;
}
