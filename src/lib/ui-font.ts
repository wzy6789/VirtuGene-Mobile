/** Intermediate weights are enabled only after the local variable face is usable. */
export function installUiFont() {
  const root = document.documentElement;
  root.dataset.vgFont = 'fallback';
  if (!document.fonts) return () => {};
  let disposed = false;
  let failed = false;
  const fallback = (event: FontFaceSetLoadEvent) => {
    if (event.fontfaces.some(face => face.family.replace(/["']/g, '') === 'VG Sans')) {
      failed = true;
      root.dataset.vgFont = 'fallback';
    }
  };
  document.fonts.addEventListener('loadingerror', fallback);
  // A short common-glyph probe loads one small subset, not the entire CJK font.
  void document.fonts.load('400 14px "VG Sans"', '设置聊天').then(faces => {
    if (!disposed && !failed && faces.some(face => face.status === 'loaded')) root.dataset.vgFont = 'variable';
  }).catch(() => { if (!disposed) root.dataset.vgFont = 'fallback'; });
  return () => { disposed = true; document.fonts.removeEventListener('loadingerror', fallback); };
}
