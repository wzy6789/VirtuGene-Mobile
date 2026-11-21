// A summary cursor covers these exact original segments. Transport must reject
// an invalid batch rather than clip it and later report full coverage.
export const SUMMARY_HISTORY_MAX_SEGMENTS = 12;
export const SUMMARY_HISTORY_SEGMENT_CHARS = 1200;

export function isCompleteSummaryHistory(history) {
  return Array.isArray(history) && history.length <= SUMMARY_HISTORY_MAX_SEGMENTS
    && history.every(item => {
      if (!item || typeof item.content !== 'string' || typeof item.role !== 'string') return false;
      const content = item.content;
      if (content.length <= SUMMARY_HISTORY_SEGMENT_CHARS) return true;
      // The segmenter extends by one UTF-16 unit only to finish a pair.
      return content.length === SUMMARY_HISTORY_SEGMENT_CHARS + 1
        && /[\uD800-\uDBFF]/.test(content[SUMMARY_HISTORY_SEGMENT_CHARS - 1])
        && /[\uDC00-\uDFFF]/.test(content[SUMMARY_HISTORY_SEGMENT_CHARS]);
    });
}
