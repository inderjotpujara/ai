/** Wrap free-text as a delimited data block, neutralizing any embedded
 *  same-tag markup so the delimiter can't be closed/opened early
 *  (prompt-injection hardening). Shared by `delimitNeed` and by callers that
 *  need to fence other model-echoed text (e.g. retry validation feedback,
 *  which quotes the model's own previously-rejected field values). */
export function delimitData(tag: string, text: string): string {
  const closeOrOpen = new RegExp(`<\\/?${tag}>`, 'gi');
  const safe = text.replace(closeOrOpen, ' ');
  return `<${tag}>${safe}</${tag}>`;
}

/** Wrap free-text as a <need> data block, neutralizing any embedded need-tags
 *  so the delimiter can't be closed early (prompt-injection hardening). */
export function delimitNeed(need: string): string {
  return delimitData('need', need);
}
