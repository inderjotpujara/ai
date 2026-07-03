/** Wrap free-text as a <need> data block, neutralizing any embedded need-tags
 *  so the delimiter can't be closed early (prompt-injection hardening). */
export function delimitNeed(need: string): string {
  const safe = need.replace(/<\/?need>/gi, ' ');
  return `<need>${safe}</need>`;
}
