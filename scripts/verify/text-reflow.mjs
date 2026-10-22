// Browser-only verification helper. Measure fresh nodes against the original
// typography before restoring all test overrides together; inherited sizes must
// not accidentally double again when lazy panels mount.
export async function scaleTextFromBaseline(page, selector, exclude = '.sr-only,[aria-hidden="true"]') {
  await page.locator(selector).evaluate((root, exclude) => {
    window.__vgTextReflowBaseline ??= new Map();
    const baseline = window.__vgTextReflowBaseline;
    for (const [node, value] of baseline) {
      node.style.fontSize = value.originalFont;
      node.style.lineHeight = value.originalLine;
    }
    for (const node of [root, ...root.querySelectorAll('*')]) {
      if (!(node instanceof HTMLElement) || node.closest(exclude) || baseline.has(node)) continue;
      const style = getComputedStyle(node);
      baseline.set(node, { originalFont: node.style.fontSize, originalLine: node.style.lineHeight,
        font: parseFloat(style.fontSize), line: parseFloat(style.lineHeight) });
    }
    for (const [node, value] of baseline) {
      node.style.fontSize = `${value.font * 2}px`;
      if (Number.isFinite(value.line)) node.style.lineHeight = `${value.line * 2}px`;
    }
  }, exclude);
}
